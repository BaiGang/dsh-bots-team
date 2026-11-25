/**
 * DSH Bot Team, host backend: the durable roster of AI bots that the Team panel
 * and the agent tools share, plus the chief of staff's dispatch path.
 *
 * Each bot is a real DSH Session in a folder of its own, and the folder carries
 * the bot's persona as `AGENTS.md`, which `@deepseek-ai/dsh-agent-instructions`
 * already loads into that Session's system prompt. The host therefore owns only
 * what a browser cannot: the roster, the bot folders, one loopback JSON
 * endpoint, and the ability to wake one bot's Session with a task.
 *
 * Dispatch is gated: an agent-side call records a proposal, and only the panel's
 * confirmation (or the explicit `unattended` config) actually delivers it.
 *
 * Deliberately dependency-free: this module imports Node built-ins only, so it
 * resolves whatever profile installs it.
 *
 * @module dsh-bots-team
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/** Cordis plugin name. */
export const name = 'bots-team'
/** Services this plugin contributes to and drives. */
export const inject = ['webServer', 'tools', 'agents', 'systemPrompt', 'workspaceRegistry', 'sessions', 'sessionTitle']

/** Route prefix owned by this plugin. */
const API_PREFIX = '/bots-team/api'
/** Roster schema version written into `team.json`. */
const TEAM_VERSION = 2
/** Identifier of the built-in chief of staff. */
const CHIEF_ID = 'chief'
/** Title of the one Workspace the whole team shares. */
const WORKSPACE_TITLE = 'Bot team'
/** How many assignment records are kept. */
const ASSIGNMENT_LIMIT = 100
/** Default working posture appended to every persona. */
const BOT_RULES = [
  '## How you work',
  '- You are one bot on a small team of AI bots. The person talks to you like a contact: keep replies short, concrete, and in your own voice.',
  '- Your folder is yours. Keep files you make there, and say where you put them.',
  '- If a task clearly belongs to a teammate, say which bot should take it instead of guessing.',
  '- Prefer doing the work over describing how it could be done. Ask only when a wrong guess would waste real effort.',
].join('\n')

/** The built-in chief of staff: it dispatches and reports, it does not do the work. */
const CHIEF = {
  name: 'Chief',
  emoji: '🎖️',
  role: 'Chief of staff',
  color: '#6d7c95',
  persona: [
    'You are the chief of staff of this bot team. You do not do the work yourself.',
    'You do three things: turn a request into assignments for the right teammate, hand them over, and report what came back.',
    '- Name the teammate before the task, and say why that one.',
    '- Keep a proposal to at most three assignments, and merge work that belongs together.',
    '- You cannot send work yourself: `team_assign` records a proposal, and the person confirms it in the Team panel. Tell them that plainly once, then stop.',
    '- Never claim a bot is working, finished, or stuck unless `team_status` says so. When it does not know, say you do not know yet.',
    '- When several bots are involved, close with one line naming who is doing what.',
  ].join('\n'),
}

/** Team presets offered by the panel and by `team_hire`. */
const TEMPLATES = {
  scout: {
    name: 'Scout',
    emoji: '🧭',
    role: 'Researcher',
    color: '#5b8def',
    persona: 'You find things out. You search the web, read sources, and return a short brief with links: what is true, what is uncertain, what changed recently.',
  },
  forge: {
    name: 'Forge',
    emoji: '🛠️',
    role: 'Builder',
    color: '#e0743f',
    persona: 'You build. You write code and files in your folder, run them, and report what works with the exact command that proves it.',
  },
  ledger: {
    name: 'Ledger',
    emoji: '📊',
    role: 'Analyst',
    color: '#3f9e7a',
    persona: 'You make numbers legible. You read data, compute carefully, and answer with the figure, the method, and the caveat.',
  },
  quill: {
    name: 'Quill',
    emoji: '✍️',
    role: 'Writer',
    color: '#9a6ad6',
    persona: 'You write. You turn notes and results into clear prose in the person\'s own register, and you cut anything that does not earn its line.',
  },
}

/** Bots created on first run so the panel opens as a team, not a blank page. */
const STARTER_IDS = ['scout', 'forge', 'ledger']

/**
 * Resolve the harness home without importing `dsh-home-paths`.
 * @returns Absolute harness home directory.
 */
function harnessHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured)
  return path.join(os.homedir(), '.dsh')
}

/**
 * Collapse arbitrary text into a filesystem-safe slug.
 * @param value - raw text.
 * @returns Lowercase slug of `[a-z0-9-]`, never empty.
 */
function slugify(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40)
  return slug === '' ? `bot-${randomUUID().slice(0, 6)}` : slug
}

/**
 * Clamp a string field to a bounded, trimmed value.
 * @param value - candidate.
 * @param fallback - value used when the candidate is not a non-blank string.
 * @param limit - maximum length.
 * @returns Sanitized text.
 */
function text(value, fallback, limit) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed === '') return fallback
  return trimmed.slice(0, limit)
}

/**
 * Accept one `#rrggbb` colour or fall back.
 * @param value - candidate colour.
 * @param fallback - default colour.
 * @returns Safe CSS colour.
 */
function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() : fallback
}

/** Persona text is long-form and only rejects non-strings. */
function personaText(value) {
  return typeof value === 'string' ? value.trim().slice(0, 8000) : ''
}

/**
 * Render the `AGENTS.md` a bot folder carries.
 * @param bot - normalized bot record.
 * @returns Markdown instruction document.
 */
function renderAgentsMd(bot) {
  const lines = [
    `# ${bot.name}${bot.role === '' ? '' : ` — ${bot.role}`}`,
    '',
    `You are **${bot.name}**, one bot on a team of AI bots. You are talking to the person who owns the team.`,
    '',
  ]
  if (bot.persona !== '') lines.push(bot.persona, '')
  lines.push(BOT_RULES, '')
  return lines.join('\n')
}

/** Roster file, bot folders, and assignment records with serialized writes. */
class TeamStore {
  /**
   * @param {string} root - directory owning `team.json` and `bots/`.
   * @param {(message: string) => void} warn - diagnostic sink.
   */
  constructor(root, warn) {
    this.root = root
    this.file = path.join(root, 'team.json')
    this.botsDir = path.join(root, 'bots')
    this.warn = warn
    this.state = undefined
    this.loading = undefined
    this.queue = Promise.resolve()
    /** Set by `apply` once an Agent registry is available. */
    this.deliver = undefined
    /** In-flight wake-ups, so two dispatches cannot resume one session twice. */
    this.waking = new Map()
    /** Set by `apply` from the row configuration. */
    this.unattended = false
    /** The single Workspace every bot Session lives in. */
    this.workspace = undefined
  }

  /**
   * Serialize one roster mutation.
   * @param {(state: object) => Promise<T> | T} operation - mutation against the loaded state.
   * @returns The operation result after the file write.
   * @template T
   */
  mutate(operation) {
    const run = this.queue.then(async () => {
      const state = await this.load()
      return operation(state)
    })
    // A failed mutation must not poison the queue for later calls.
    this.queue = run.then(() => {}, () => {})
    return run
  }

  /**
   * Read the roster from disk once, seeding it on first run. Concurrent callers
   * share one load so a first run cannot race itself into two writes.
   */
  load() {
    if (this.state !== undefined) return Promise.resolve(this.state)
    if (this.loading !== undefined) return this.loading
    this.loading = this.readOrSeed().finally(() => { this.loading = undefined })
    return this.loading
  }

  /** The body of {@link load}. */
  async readOrSeed() {
    await mkdir(this.botsDir, { recursive: true })
    let parsed
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') this.warn(`bots-team: unreadable roster (${String(error?.message ?? error)}); starting a fresh one`)
    }
    const state = this.normalize(parsed)
    if (state.bots.length === 0) this.seed(state)
    this.ensureChief(state)
    this.state = state
    await this.write(state)
    for (const bot of state.bots) await this.ensureFolder(bot)
    return state
  }

  /**
   * Coerce a stored document into the current schema.
   * @param parsed - value read from disk, possibly absent or corrupt.
   * @returns Valid roster state.
   */
  normalize(parsed) {
    const bots = []
    const seen = new Set()
    const list = Array.isArray(parsed?.bots) ? parsed.bots : []
    for (const raw of list) {
      const bot = this.normalizeBot(raw, undefined)
      if (bot === undefined) continue
      if (seen.has(bot.id)) bot.id = `${bot.id}-${randomUUID().slice(0, 4)}`
      seen.add(bot.id)
      bot.chief = raw?.chief === true || bot.id === CHIEF_ID
      bots.push(bot)
    }
    const assignments = (Array.isArray(parsed?.assignments) ? parsed.assignments : [])
      .filter(record => record !== null && typeof record === 'object' && typeof record.id === 'string')
      .slice(-ASSIGNMENT_LIMIT)
    return {
      version: TEAM_VERSION,
      team: { name: text(parsed?.team?.name, 'My team', 80), createdAt: Number(parsed?.team?.createdAt) || Date.now() },
      bots,
      assignments,
    }
  }

  /**
   * Validate one bot record.
   * @param raw - untrusted record.
   * @param existing - record being updated, whose identity fields are preserved.
   * @returns Normalized bot, or undefined when the input carries no identity.
   */
  normalizeBot(raw, existing) {
    if (raw === null || typeof raw !== 'object') return undefined
    const name = text(raw.name, existing?.name ?? '', 60)
    if (name === '') return undefined
    const id = existing?.id ?? slugify(text(raw.id, name, 40))
    return {
      id,
      name,
      emoji: text(raw.emoji, existing?.emoji ?? '🤖', 8),
      role: text(raw.role, existing?.role ?? '', 60),
      color: color(raw.color, existing?.color ?? '#5b8def'),
      persona: personaText(raw.persona) || existing?.persona || '',
      // A stored record is a record, not a patch: reading `existing` alone here
      // dropped every Session binding on reload.
      folder: text(raw.folder, existing?.folder ?? '', 400) || path.join(this.botsDir, id),
      sessionId: typeof raw.sessionId === 'string' && raw.sessionId !== ''
        ? raw.sessionId
        : (typeof existing?.sessionId === 'string' && existing.sessionId !== '' ? existing.sessionId : null),
      chief: existing?.chief === true || raw?.chief === true,
      organized: raw?.organized === true || existing?.organized === true,
      workspaceId: text(raw.workspaceId, existing?.workspaceId ?? '', 200) || undefined,
      createdAt: Number(raw.createdAt) || existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    }
  }

  /**
   * Create the starter bots described by {@link TEMPLATES}.
   * @param state - roster being seeded.
   */
  seed(state) {
    for (const key of STARTER_IDS) {
      const template = TEMPLATES[key]
      if (template === undefined) continue
      state.bots.push({
        id: key,
        ...template,
        folder: path.join(this.botsDir, key),
        sessionId: null,
        chief: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  /**
   * Guarantee the chief of staff exists and leads the roster. A person may fire
   * it; the next activation hires it again so dispatch cannot be lost by
   * accident, and its folder keeps any conversation it had.
   */
  ensureChief(state) {
    const index = state.bots.findIndex(bot => bot.chief === true || bot.id === CHIEF_ID)
    if (index !== -1) {
      const [chief] = state.bots.splice(index, 1)
      chief.chief = true
      state.bots.unshift(chief)
      return
    }
    state.bots.unshift({
      id: CHIEF_ID,
      ...CHIEF,
      folder: path.join(this.botsDir, CHIEF_ID),
      sessionId: null,
      chief: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }

  /**
   * Write the roster atomically.
   * @param state - roster to persist.
   */
  async write(state) {
    await mkdir(this.root, { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }

  /**
   * Materialize a bot folder: the working directory, a `.git` marker that stops
   * instruction discovery from climbing out of it, and the persona file.
   * @param bot - bot whose folder is ensured.
   */
  async ensureFolder(bot) {
    await mkdir(bot.folder, { recursive: true })
    await mkdir(path.join(bot.folder, '.git'), { recursive: true })
    const target = path.join(bot.folder, 'AGENTS.md')
    const body = renderAgentsMd(bot)
    let current
    try {
      current = await readFile(target, 'utf8')
    } catch {}
    if (current !== body) await writeFile(target, body, 'utf8')
  }

  /**
   * Find the bot a Session belongs to.
   * @param sessionId - session identity.
   * @returns The owning bot, when one is bound to it.
   */
  botBySession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    return this.state?.bots.find(bot => bot.sessionId === sessionId)
  }

  /** Public, client-safe projection of the roster. */
  snapshot() {
    const state = this.state ?? { version: TEAM_VERSION, team: { name: 'My team', createdAt: 0 }, bots: [], assignments: [] }
    return {
      version: state.version,
      team: { name: state.team.name },
      dataDir: this.root,
      chiefId: state.bots.find(bot => bot.chief === true)?.id ?? CHIEF_ID,
      workspaceId: this.workspace?.id,
      workspacePath: this.root,
      workspaceTitle: WORKSPACE_TITLE,
      unattended: this.unattended === true,
      bots: state.bots.map(bot => ({ ...bot })),
      assignments: state.assignments.map(record => ({ ...record })),
      templates: Object.entries(TEMPLATES).map(([id, template]) => ({ id, ...template })),
    }
  }

  /**
   * Create one bot.
   * @param input - untrusted bot fields.
   * @returns The created bot.
   */
  async create(input) {
    return this.mutate(async (state) => {
      const template = typeof input.template === 'string' ? TEMPLATES[input.template] : undefined
      const bot = this.normalizeBot({ ...(template ?? {}), ...input }, undefined)
      if (bot === undefined) throw new Error('a bot needs a name')
      if (state.bots.some(existing => existing.id === bot.id)) bot.id = `${bot.id}-${randomUUID().slice(0, 4)}`
      bot.folder = path.join(this.botsDir, bot.id)
      bot.chief = false
      state.bots.push(bot)
      await this.write(state)
      await this.ensureFolder(bot)
      return bot
    })
  }

  /**
   * Update one bot in place and refresh its persona file.
   * @param botId - bot identity.
   * @param input - changed fields.
   * @returns The updated bot.
   */
  async update(botId, input) {
    return this.mutate(async (state) => {
      const index = state.bots.findIndex(bot => bot.id === botId)
      if (index === -1) throw new Error(`unknown bot "${botId}"`)
      const bot = this.normalizeBot({ ...state.bots[index], ...input }, state.bots[index])
      if (bot === undefined) throw new Error('a bot needs a name')
      bot.chief = state.bots[index].chief === true
      state.bots[index] = bot
      await this.write(state)
      await this.ensureFolder(bot)
      return bot
    })
  }

  /**
   * Record the Session a bot's conversation lives in.
   * @param botId - bot identity.
   * @param sessionId - DSH session identity.
   * @returns The updated bot.
   */
  async bind(botId, sessionId) {
    return this.mutate(async (state) => {
      const bot = state.bots.find(candidate => candidate.id === botId)
      if (bot === undefined) throw new Error(`unknown bot "${botId}"`)
      bot.sessionId = typeof sessionId === 'string' && sessionId !== '' ? sessionId : null
      bot.updatedAt = Date.now()
      await this.write(state)
      return bot
    }).then(async (bot) => {
      await this.organize(bot)
      return bot
    })
  }

  /**
   * Remove one bot from the roster; its folder is kept on disk.
   * @param botId - bot identity.
   * @returns The removed identity.
   */
  async remove(botId) {
    return this.mutate(async (state) => {
      const index = state.bots.findIndex(bot => bot.id === botId)
      if (index === -1) throw new Error(`unknown bot "${botId}"`)
      const [removed] = state.bots.splice(index, 1)
      await this.write(state)
      return { id: removed.id, folder: removed.folder, chief: removed.chief === true }
    })
  }

  /**
   * Record one or more proposed assignments without delivering them.
   * @param items - `{ botId, task }` records.
   * @param source - who proposed: `chief`, `agent`, or `panel`.
   * @returns The created records.
   */
  async propose(items, source) {
    return this.mutate(async (state) => {
      const created = []
      for (const item of items) {
        const bot = state.bots.find(candidate => candidate.id === String(item?.botId ?? ''))
        if (bot === undefined) throw new Error(`unknown bot "${String(item?.botId ?? '')}"`)
        const task = text(item?.task, '', 4000)
        if (task === '') throw new Error('an assignment needs a task')
        const record = {
          id: randomUUID().slice(0, 8),
          botId: bot.id,
          botName: bot.name,
          task,
          status: 'proposed',
          source: typeof source === 'string' ? source : 'chief',
          createdAt: Date.now(),
          sentAt: null,
          finishedAt: null,
          error: '',
        }
        state.assignments.push(record)
        created.push(record)
      }
      state.assignments = state.assignments.slice(-ASSIGNMENT_LIMIT)
      await this.write(state)
      return created
    })
  }

  /**
   * Deliver one proposed assignment into its bot's Session.
   * @param id - assignment identity.
   * @returns The updated record.
   */
  async dispatch(id) {
    const record = await this.findAssignment(id, ['proposed', 'failed'])
    const bot = this.state?.bots.find(candidate => candidate.id === record.botId)
    try {
      if (this.deliver === undefined) throw new Error('dispatch is unavailable in this profile')
      if (bot === undefined) throw new Error(`unknown bot "${record.botId}"`)
      if (typeof bot.sessionId !== 'string' || bot.sessionId === '') {
        throw new Error(`${bot.name} has no session yet; open its chat once, then dispatch`)
      }
      await this.deliver(bot, record)
    } catch (error) {
      return this.settle(record.id, 'failed', String(error?.message ?? error))
    }
    return this.settle(record.id, 'sent')
  }

  /**
   * Deliver every open proposal. One unreachable bot settles itself as failed
   * and the rest still go out.
   * @returns The records after delivery.
   */
  async dispatchAll() {
    await this.load()
    const open = (this.state?.assignments ?? []).filter(record => record.status === 'proposed')
    const results = []
    for (const record of open) results.push(await this.dispatch(record.id))
    return results
  }

  /**
   * Drop every open proposal without sending it.
   * @returns The records after cancellation.
   */
  async cancelAll() {
    await this.load()
    const open = (this.state?.assignments ?? []).filter(record => record.status === 'proposed')
    const results = []
    for (const record of open) results.push(await this.settle(record.id, 'cancelled'))
    return results
  }

  /**
   * Record a proposal and deliver it immediately (the panel's own click is the
   * confirmation).
   * @param botId - bot identity.
   * @param task - task text.
   * @returns The record after delivery.
   */
  async assignNow(botId, task) {
    const [record] = await this.propose([{ botId, task }], 'panel')
    return this.dispatch(record.id)
  }

  /**
   * Put a failed assignment back in the queue so it can be dispatched again.
   * @param id - assignment identity.
   * @returns The updated record.
   */
  async reopen(id) {
    await this.findAssignment(id, ['failed'])
    return this.mutate(async (state) => {
      const record = state.assignments.find(candidate => candidate.id === String(id))
      record.status = 'proposed'
      record.error = ''
      record.finishedAt = null
      await this.write(state)
      return record
    })
  }

  /**
   * Mark one proposal cancelled.
   * @param id - assignment identity.
   * @returns The updated record.
   */
  async cancel(id) {
    await this.findAssignment(id, ['proposed', 'failed'])
    return this.settle(id, 'cancelled')
  }

  /**
   * Resolve one assignment in a required state.
   * @param id - assignment identity.
   * @param allowed - statuses this operation accepts.
   * @returns The record.
   */
  async findAssignment(id, allowed) {
    await this.load()
    const record = this.state?.assignments.find(candidate => candidate.id === String(id ?? ''))
    if (record === undefined) throw new Error(`unknown assignment "${String(id ?? '')}"`)
    if (!allowed.includes(record.status)) throw new Error(`assignment is ${record.status}, not ${allowed.join(' or ')}`)
    return record
  }

  /**
   * Persist one status transition.
   * @param id - assignment identity.
   * @param status - next status.
   * @param error - failure reason for `failed`.
   * @returns The updated record.
   */
  settle(id, status, error) {
    return this.mutate(async (state) => {
      const record = state.assignments.find(candidate => candidate.id === id)
      if (record === undefined) throw new Error(`unknown assignment "${id}"`)
      record.status = status
      if (status === 'sent') record.sentAt = Date.now()
      if (status === 'done' || status === 'failed' || status === 'cancelled') record.finishedAt = Date.now()
      if (typeof error === 'string' && error !== '') record.error = error
      await this.write(state)
      return record
    })
  }

  /**
   * Wake a bot's Session with one task. The message is attributed to this
   * plugin's own source kind, which consumers fall through as an ordinary user
   * message, so the bot reads it as an instruction from its owner.
   * @param bot - target bot with a bound Session.
   * @param record - assignment being delivered.
   */
  async wake(bot, record) {
    const sessionId = bot.sessionId
    let agent = this.agentFor(sessionId)
    if (agent === undefined) {
      const pending = this.waking.get(sessionId)
      const handle = pending ?? this.resume(sessionId)
      this.waking.set(sessionId, handle)
      try {
        agent = await handle
      } finally {
        if (this.waking.get(sessionId) === handle) this.waking.delete(sessionId)
      }
    }
    if (agent === undefined || typeof agent.followup !== 'function') {
      throw new Error(`could not wake ${bot.name}`)
    }
    agent.followup({
      role: 'user',
      id: randomUUID(),
      content: [{ type: 'text', text: record.task }],
      source: { kind: 'team-assign' },
    })
    // A dispatched task settles when the bot stops working; waiting never blocks
    // the caller, and a completion is recorded for the panel to notice.
    void Promise.resolve(agent.whenIdle?.())
      .then(() => this.settle(record.id, 'done').catch(() => {}))
      .catch(error => this.settle(record.id, 'failed', String(error?.message ?? error)).catch(() => {}))
  }

  /**
   * Give a bound bot a home: a Workspace named after it over its own folder,
   * the Session attached to that Workspace, and the Session titled with the
   * bot's name. Without this a bot's Session lands in the sidebar's ungrouped
   * list as an untitled conversation.
   * @param bot - bot with a bound Session.
   */
  async organize(bot) {
    const sessionId = bot.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') return
    try {
      const workspace = await this.ensureWorkspace()
      if (workspace !== undefined) {
        const attached = Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)
        // A Session created before the team Workspace existed keeps its own cwd
        // and cannot be attached; it stays readable in the session list.
        if (!attached) await workspace.attachSession?.(sessionId)
      }
    } catch (error) {
      this.warn(`bots-team: could not group ${bot.name} (${String(error?.message ?? error)})`)
    }
    if (bot.organized === true) return
    try {
      let session = this.sessions?.get?.(sessionId)
      if (session === undefined) {
        await this.resume(sessionId)
        session = this.sessions?.get?.(sessionId)
      }
      if (session !== undefined) this.sessionTitle?.rename?.(session, bot.name)
      await this.mutate(async (state) => {
        const stored = state.bots.find(candidate => candidate.id === bot.id)
        if (stored !== undefined) stored.organized = true
        await this.write(state)
      })
    } catch (error) {
      this.warn(`bots-team: could not title ${bot.name}'s session (${String(error?.message ?? error)})`)
    }
  }

  /**
   * Resolve the one Workspace the team shares: the roster's own directory, so
   * every bot Session has the same working directory and the same home.
   * @returns The Workspace, when the profile has a registry.
   */
  async ensureWorkspace() {
    if (this.workspace !== undefined) return this.workspace
    const registry = this.workspaces
    if (registry === undefined || typeof registry.create !== 'function') return undefined
    const workspace = await registry.create(this.root, WORKSPACE_TITLE)
    if (workspace === undefined) return undefined
    if (workspace.title !== WORKSPACE_TITLE) await workspace.setTitle?.(WORKSPACE_TITLE)
    this.workspace = workspace
    return workspace
  }

  /**
   * Delete Workspaces that earlier versions created for a single bot folder.
   * Scoped to paths under this roster's own directory, so no other Workspace is
   * ever considered; the shared Workspace sits exactly at the root and is kept.
   */
  async prunePerBotWorkspaces() {
    const registry = this.workspaces
    if (registry === undefined || typeof registry.list !== 'function' || typeof registry.delete !== 'function') return
    const prefix = `${this.root}${path.sep}`
    for (const workspace of registry.list()) {
      const workspacePath = workspace?.path
      if (typeof workspacePath !== 'string') continue
      if (!workspacePath.startsWith(prefix)) continue
      try {
        await registry.delete(workspace.id)
      } catch (error) {
        this.warn(`bots-team: could not drop a per-bot workspace (${String(error?.message ?? error)})`)
      }
    }
  }

  /**
   * Group and title every bot that already has a Session, once. A bot hired
   * later is organized when its Session is bound.
   */
  async migrate() {
    await this.load()
    for (const bot of [...(this.state?.bots ?? [])]) {
      if (typeof bot.sessionId !== 'string' || bot.sessionId === '') continue
      if (bot.organized === true) continue
      await this.organize(bot)
    }
  }

  /**
   * Look up one live agent for a session.
   * @param sessionId - session identity.
   * @returns The agent, when one is running.
   */
  agentFor(sessionId) {
    try {
      return this.agents?.get?.(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * Resume a persisted Session into a live agent.
   * @param sessionId - session identity.
   * @returns The agent.
   */
  async resume(sessionId) {
    const handle = await this.agents.resume({ resumeSessionId: sessionId })
    const agent = handle?.agent ?? handle
    if (agent === undefined) throw new Error('resume returned no agent')
    return agent
  }
}

/**
 * Answer one API call.
 *
 * `dispatch` is transport-free so a test can call it directly; `handle` adapts
 * it to the raw Node request pair the web server hands a named route. A named
 * route's `resource` form only sees GET and HEAD, which is why roster writes and
 * delivery travel through a handler instead.
 *
 * @param request - method, pathname, header lookup, and raw body text.
 * @param store - roster store.
 * @returns status and JSON body.
 */
async function dispatchRequest(request, store) {
  const route = request.pathname.slice(API_PREFIX.length) || '/state'
  const reply = (status, body) => ({ status, body })
  const header = name => request.header(name) ?? ''
  // A page on another site must not reach this roster: reject a cross-site
  // fetch, and accept a body only as JSON so a plain form post cannot write.
  if (header('sec-fetch-site') === 'cross-site') return reply(403, { ok: false, error: 'cross-site request refused' })
  try {
    if (route === '/state' || route === '/state/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, { ok: false, error: 'GET only' })
      await store.load()
      return reply(200, { ok: true, state: store.snapshot() })
    }
    if (route === '/bots' || route === '/bots/') {
      if (request.method !== 'POST') return reply(405, { ok: false, error: 'POST only' })
      if (!header('content-type').includes('application/json')) return reply(415, { ok: false, error: 'expected application/json' })
      const origin = header('origin')
      const host = header('host')
      if (origin !== '' && host !== '' && origin !== `http://${host}` && origin !== `https://${host}`) {
        return reply(403, { ok: false, error: 'cross-origin write refused' })
      }
      let body
      try {
        body = request.body === '' ? {} : JSON.parse(request.body)
      } catch {
        return reply(400, { ok: false, error: 'malformed JSON body' })
      }
      await store.load()
      const op = String(body?.op ?? '')
      let result
      if (op === 'create') result = { bot: await store.create(body.bot ?? {}) }
      else if (op === 'update') result = { bot: await store.update(String(body.botId ?? ''), body.patch ?? {}) }
      else if (op === 'delete') result = { removed: await store.remove(String(body.botId ?? '')) }
      else if (op === 'bind') result = { bot: await store.bind(String(body.botId ?? ''), body.sessionId) }
      else if (op === 'propose') result = { assignments: await store.propose(normalizeItems(body), String(body.source ?? 'panel')) }
      else if (op === 'dispatch') result = { assignment: await store.dispatch(String(body.assignmentId ?? '')) }
      else if (op === 'assign') result = { assignment: await store.assignNow(String(body.botId ?? ''), String(body.task ?? '')) }
      else if (op === 'cancel') result = { assignment: await store.cancel(String(body.assignmentId ?? '')) }
      else if (op === 'dispatchAll') {
        const dispatched = await store.dispatchAll()
        result = {
          dispatched,
          sent: dispatched.filter(record => record.status === 'sent').length,
          failed: dispatched.filter(record => record.status === 'failed').length,
        }
      }
      else if (op === 'cancelAll') result = { cancelled: await store.cancelAll() }
      else if (op === 'reopen') result = { assignment: await store.reopen(String(body.assignmentId ?? '')) }
      else return reply(400, { ok: false, error: `unknown op "${op}"` })
      return reply(200, { ok: true, ...result, state: store.snapshot() })
    }
    return reply(404, { ok: false, error: `no route ${route}` })
  } catch (error) {
    return reply(500, { ok: false, error: String(error?.message ?? error) })
  }
}

/**
 * Accept either a single item or an `items` list from the panel.
 * @param body - parsed request body.
 * @returns Normalized proposals.
 */
function normalizeItems(body) {
  const items = Array.isArray(body?.items) ? body.items : [{ botId: body?.botId, task: body?.task }]
  return items.map(item => ({ botId: String(item?.botId ?? ''), task: String(item?.task ?? '') }))
}

/** Largest request body accepted, in bytes. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Read a request body as UTF-8 text, bounded so a stray client cannot grow the
 * process.
 * @param source - Node readable request.
 * @returns Body text.
 */
async function readBody(source) {
  const chunks = []
  let size = 0
  for await (const chunk of source) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Node handler for the whole API prefix.
 * @param req - incoming request.
 * @param res - server response.
 * @param store - roster store.
 */
async function handle(req, res, store) {
  const send = (status, payload) => {
    const text = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    if (req.method === 'HEAD') res.end()
    else res.end(text)
  }
  try {
    const body = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' ? await readBody(req) : ''
    const { status, body: payload } = await dispatchRequest({
      method: req.method ?? 'GET',
      pathname: new URL(req.url ?? '/', 'http://localhost').pathname,
      header: name => req.headers[name],
      body,
    }, store)
    send(status, payload)
  } catch (error) {
    send(500, { ok: false, error: String(error?.message ?? error) })
  }
}

/**
 * Describe the tools contributed to the calling agent.
 * @param store - roster store.
 * @param {() => boolean} unattended - whether a proposal may deliver itself.
 * @returns Tool definitions, ready for `ctx.tools.register`.
 */
function teamTools(store, unattended) {
  const textOutput = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  const summary = bots => bots.map(bot => ({
    id: bot.id,
    name: bot.name,
    role: bot.role,
    chief: bot.chief === true,
    persona: bot.persona,
    folder: bot.folder,
    hasChat: typeof bot.sessionId === 'string',
  }))
  const recent = state => state.assignments.slice(-12).map(record => ({
    id: record.id,
    botId: record.botId,
    botName: record.botName,
    status: record.status,
    task: record.task.length > 160 ? `${record.task.slice(0, 160)}…` : record.task,
    error: record.error,
  }))
  return [
    {
      name: 'team_roster',
      description: 'List the bot team: each bot\'s name, role, persona, folder, and whether it already has a conversation. Use it before hiring or briefing a bot.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput,
      async execute() {
        await store.load()
        const state = store.snapshot()
        return { team: state.team.name, chiefId: state.chiefId, bots: summary(state.bots) }
      },
    },
    {
      name: 'team_hire',
      description: 'Hire one new bot onto the team. The bot gets its own folder and its persona becomes that folder\'s AGENTS.md, which DSH loads into every Session started there.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Short display name, for example Scout.' },
          role: { type: 'string', description: 'One-line job title, for example Researcher.' },
          persona: { type: 'string', description: 'Its working instructions in second person: what it does, how it answers, what it refuses.' },
          emoji: { type: 'string', description: 'One emoji used as the bot avatar.' },
        },
        required: ['name', 'persona'],
      },
      output: textOutput,
      async execute(args) {
        await store.load()
        const bot = await store.create(args)
        return { bot: summary([bot])[0] }
      },
    },
    {
      name: 'team_brief',
      description: 'Rewrite one bot\'s persona or role. Use it after the person asks a bot to behave differently; the folder\'s AGENTS.md is rewritten for the next Session.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          botId: { type: 'string', description: 'Bot id from team_roster.' },
          persona: { type: 'string', description: 'The complete replacement persona.' },
          role: { type: 'string', description: 'Optional replacement role.' },
        },
        required: ['botId'],
      },
      output: textOutput,
      async execute(args) {
        await store.load()
        const bot = await store.update(String(args.botId), {
          ...(typeof args.persona === 'string' ? { persona: args.persona } : {}),
          ...(typeof args.role === 'string' ? { role: args.role } : {}),
        })
        return { bot: summary([bot])[0] }
      },
    },
    {
      name: 'team_fire',
      description: 'Remove one bot from the team roster. Its folder and files stay on disk.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { botId: { type: 'string', description: 'Bot id from team_roster.' } },
        required: ['botId'],
      },
      output: textOutput,
      async execute(args) {
        await store.load()
        const removed = await store.remove(String(args.botId))
        return { removed }
      },
    },
    {
      name: 'team_assign',
      description: 'Hand work to one or more bots. Records a proposal and returns it; the person confirms in the Team panel unless this profile runs unattended, in which case the task is delivered immediately. The task becomes a user message in the bot\'s own conversation, so write it as an instruction with its acceptance criteria.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assignments: {
            type: 'array',
            description: 'One entry per bot: who gets it, and the task they receive.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                botId: { type: 'string', description: 'Bot id from team_roster.' },
                task: { type: 'string', description: 'The instruction the bot receives, including what done looks like.' },
              },
              required: ['botId', 'task'],
            },
          },
        },
        required: ['assignments'],
      },
      output: textOutput,
      async execute(args) {
        await store.load()
        const items = (Array.isArray(args.assignments) ? args.assignments : [])
          .map(item => ({ botId: String(item?.botId ?? ''), task: String(item?.task ?? '') }))
        if (items.length === 0) throw new Error('team_assign needs at least one assignment')
        const created = await store.propose(items, 'chief')
        if (unattended()) {
          const delivered = []
          for (const record of created) delivered.push(await store.dispatch(record.id))
          return { mode: 'unattended', assignments: delivered }
        }
        return {
          mode: 'awaiting-confirmation',
          assignments: created.map(record => ({ id: record.id, botId: record.botId, botName: record.botName, task: record.task })),
          note: 'Proposed, not sent. The person confirms these in the Team panel; tell them so and do not claim the work has started.',
        }
      },
    },
    {
      name: 'team_status',
      description: 'Report what every bot is doing right now and the state of recent assignments. Use it before telling anyone that a bot is working, finished, or blocked.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput,
      async execute() {
        await store.load()
        const state = store.snapshot()
        const bots = state.bots.map(bot => {
          const agent = store.agentFor(bot.sessionId)
          return {
            id: bot.id,
            name: bot.name,
            role: bot.role,
            chief: bot.chief === true,
            hasChat: typeof bot.sessionId === 'string',
            agentLive: agent !== undefined,
            running: agent?.status === 'running',
          }
        })
        return {
          unattended: unattended(),
          bots,
          assignments: recent(state),
        }
      },
    },
  ]
}

/**
 * The text a bot Session receives as its own instructions. With one shared
 * Workspace the working directory no longer identifies the bot, so the persona
 * arrives through a section registered on that agent instead of `AGENTS.md`.
 * @param bot - the bot the Session belongs to.
 * @returns Prompt text.
 */
function botPersona(bot) {
  const lines = [
    `# ${bot.name}${bot.role === '' ? '' : ` — ${bot.role}`}`,
    '',
    `You are **${bot.name}**, one bot on a team of AI bots. You are talking to the person who owns the team.`,
  ]
  if (bot.persona !== '') lines.push('', bot.persona)
  lines.push(
    '',
    `The team shares one working directory. Where you write files is your own call, but keep them in \`bots/${bot.id}/\` under the current directory and prefer explicit paths; do not change the session's working directory.`,
    '',
    BOT_RULES,
    '',
  )
  return lines.join('\n')
}

/**
 * The standing team note every Session in the profile receives, so any
 * conversation knows the roster exists and who to hand work to.
 * @param store - roster store.
 * @returns Prompt text.
 */
function guidanceText(store) {
  const bots = store.snapshot().bots
  const chief = bots.find(bot => bot.chief === true)
  const roster = bots.map(bot => `${bot.name} (${bot.role === '' ? 'no role' : bot.role})`).join(', ')
  return [
    '## Bot team',
    `This profile runs a team of bots, each one a separate Session with its own folder and persona: ${roster}.`,
    chief === undefined
      ? 'Work is handed over with the `team_assign` tool.'
      : `${chief.name} is the chief of staff and hands work over with \`team_assign\`; the person confirms each assignment in the Team panel.`,
    'Use `team_roster` to see the team before naming a bot, and `team_status` before claiming what any bot is doing.',
  ].join('\n')
}

/**
 * Activate the roster, its loopback endpoint, the dispatch path, the agent
 * tools, and the standing team note.
 * @param ctx - Host context providing the web server, tools, and Agent registry.
 * @param config - row configuration; `dataDir` moves the roster, `unattended`
 *   lets a proposal deliver itself, `guidance` toggles the standing note.
 */
export function apply(ctx, config = {}) {
  const warn = message => {
    try {
      ctx.logger?.warn?.(message)
    } catch {}
    console.warn(message)
  }
  const root = typeof config?.dataDir === 'string' && config.dataDir.trim() !== ''
    ? path.resolve(config.dataDir)
    : path.join(harnessHome(), 'bots-team')
  const unattended = () => config?.unattended === true
  const store = new TeamStore(root, warn)
  store.unattended = unattended()
  store.agents = ctx.agents
  store.sessions = ctx.sessions
  store.sessionTitle = ctx.sessionTitle
  store.workspaces = ctx.workspaceRegistry
  store.deliver = (bot, record) => store.wake(bot, record)

  // Warm the roster (and its folders) without blocking activation, then give
  // every bot that already has a conversation its Workspace and title.
  void store.load()
    .then(() => store.ensureWorkspace())
    .then(() => store.prunePerBotWorkspaces())
    .then(() => store.migrate())
    .catch(error => warn(`bots-team: roster unavailable (${String(error?.message ?? error)})`))

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => handle(req, res, store),
  }), 'bots-team: roster endpoint')

  // One shared Workspace means the working directory no longer identifies the
  // bot, so each Session's persona is contributed by a section that reads the
  // Session being assembled and stays empty for anything that is not a bot.
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'bots-team/persona',
    order: 30,
    text: (context) => {
      try {
        const bot = store.botBySession(context?.agent?.session?.id)
        return bot === undefined ? '' : botPersona(bot)
      } catch {
        return ''
      }
    },
  }), 'bots-team: bot persona')

  if (config?.guidance !== false) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'bots-team',
      order: 520,
      text: () => {
        try {
          return guidanceText(store)
        } catch {
          return ''
        }
      },
    }), 'bots-team: standing team note')
  }

  if (typeof ctx.tools?.register !== 'function') return
  try {
    for (const tool of teamTools(store, unattended)) {
      ctx.effect(() => ctx.tools.register(tool), `bots-team: ${tool.name}`)
    }
  } catch (error) {
    warn(`bots-team: tools unavailable (${String(error?.message ?? error)})`)
  }
}

/** Internals exported for tests and for a future team-import path. */
export { TEMPLATES, CHIEF, CHIEF_ID, renderAgentsMd, TeamStore, dispatchRequest }

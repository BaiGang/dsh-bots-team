/**
 * DSH Bot Team, host backend: the durable roster of AI bots that the Team panel and the
 * agent tools share.
 *
 * Each bot is a real DSH Session in a folder of its own, and the folder carries
 * the bot's persona as `AGENTS.md`, which `@deepseek-ai/dsh-agent-instructions`
 * already loads into that Session's system prompt. The Host therefore owns only
 * what a browser cannot: the roster file, the bot folders, and a small loopback
 * JSON endpoint the panel reads and writes.
 *
 * Deliberately dependency-free: this module imports Node built-ins only, so it
 * resolves whatever profile installs it.
 *
 * @module dsh-bots-team
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/** Cordis plugin name. */
export const name = 'bots-team'
/** The route registry and the tool registry this plugin contributes to. */
export const inject = ['webServer', 'tools']

/** Route prefix owned by this plugin. */
const API_PREFIX = '/bots-team/api'
/** Roster schema version written into `team.json`. */
const TEAM_VERSION = 1
/** Default working posture appended to every persona. */
const BOT_RULES = [
  '## How you work',
  '- You are one bot on a small team of AI bots. The person talks to you like a contact: keep replies short, concrete, and in your own voice.',
  '- Your folder is yours. Keep files you make there, and say where you put them.',
  '- If a task clearly belongs to a teammate, say which bot should take it instead of guessing.',
  '- Prefer doing the work over describing how it could be done. Ask only when a wrong guess would waste real effort.',
].join('\n')

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

/** Roster file plus bot folders, with serialized writes. */
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
      bots.push(bot)
    }
    return {
      version: TEAM_VERSION,
      team: { name: text(parsed?.team?.name, 'My team', 80), createdAt: Number(parsed?.team?.createdAt) || Date.now() },
      bots,
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
      folder: existing?.folder ?? path.join(this.botsDir, id),
      sessionId: typeof existing?.sessionId === 'string' ? existing.sessionId : null,
      createdAt: existing?.createdAt ?? Date.now(),
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
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

  /** Public, client-safe projection of the roster. */
  snapshot() {
    const state = this.state ?? { version: TEAM_VERSION, team: { name: 'My team', createdAt: 0 }, bots: [] }
    return {
      version: state.version,
      team: { name: state.team.name },
      dataDir: this.root,
      bots: state.bots.map(bot => ({ ...bot })),
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
      return { id: removed.id, folder: removed.folder }
    })
  }
}

/**
 * Answer one API call.
 *
 * `dispatch` is transport-free so a test can call it directly; `handle` adapts
 * it to the raw Node request pair the web server hands a named route. A named
 * route's `resource` form only sees GET and HEAD, which is why the roster's
 * writes travel through a handler instead.
 *
 * @param request - method, pathname, header lookup, and raw body text.
 * @param store - roster store.
 * @returns status and JSON body.
 */
async function dispatch(request, store) {
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
      else return reply(400, { ok: false, error: `unknown op "${op}"` })
      return reply(200, { ok: true, ...result, state: store.snapshot() })
    }
    return reply(404, { ok: false, error: `no route ${route}` })
  } catch (error) {
    return reply(500, { ok: false, error: String(error?.message ?? error) })
  }
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
    const { status, body: payload } = await dispatch({
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
 * @returns Tool definitions, ready for `ctx.tools.register`.
 */
function teamTools(store) {
  const textOutput = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
  const summary = bots => bots.map(bot => ({
    id: bot.id,
    name: bot.name,
    role: bot.role,
    persona: bot.persona,
    folder: bot.folder,
    hasChat: typeof bot.sessionId === 'string',
  }))
  return [
    {
      name: 'team_roster',
      description: 'List the bot team: each bot\'s name, role, persona, folder, and whether it already has a conversation. Use it before hiring or briefing a bot.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput,
      async execute() {
        await store.load()
        return { team: store.snapshot().team.name, bots: summary(store.snapshot().bots) }
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
  ]
}

/**
 * Activate the roster, its loopback endpoint, and the agent tools.
 * @param ctx - Host context providing the web server.
 * @param config - row configuration; `dataDir` overrides the roster location.
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
  const store = new TeamStore(root, warn)

  // Warm the roster (and its folders) without blocking activation.
  void store.load().catch(error => warn(`bots-team: roster unavailable (${String(error?.message ?? error)})`))

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => handle(req, res, store),
  }), 'bots-team: roster endpoint')

  if (typeof ctx.tools?.register !== 'function') return
  try {
    for (const tool of teamTools(store)) {
      ctx.effect(() => ctx.tools.register(tool), `bots-team: ${tool.name}`)
    }
  } catch (error) {
    warn(`bots-team: tools unavailable (${String(error?.message ?? error)})`)
  }
}

/** Templates are exported for tests and for a future team-import path. */
export { TEMPLATES, renderAgentsMd, TeamStore, dispatch }

/**
 * Smoke tests for the bots-team bundle, run without a browser.
 *
 * The host backend is exercised through the route it registers (a fake Node
 * request pair over the real handler) and against a temporary data directory.
 * The browser client is loaded through a minimal `__ModuleLoader__` stub and a
 * very small React shim, so the real component functions run and their output
 * tree is inspected. This covers registration contracts, data flow, and
 * render-time references; it does not replace looking at the panel in a browser.
 *
 * Run: node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const results = []
const check = async (name, run) => {
  try {
    await run()
    results.push(`ok   ${name}`)
  } catch (error) {
    results.push(`FAIL ${name}\n     ${String(error?.message ?? error).split('\n').join('\n     ')}`)
    process.exitCode = 1
  }
}

/* ------------------------------------------------------------------ host backend */

const host = await import('../index.js')
const routes = []
const tools = []
const sections = []
/** One controllable fake agent per session id. */
const agents = new Map()
/** Messages handed to a bot through the dispatch path. */
const delivered = []
const workspaces = []
const titles = new Map()
const liveSessions = new Set(['sess-scout'])
const created = []
const archived = []
let releaseIdle = () => {}
const fakeAgent = (sessionId) => {
  if (agents.has(sessionId)) return agents.get(sessionId)
  const agent = {
    sessionId,
    session: { id: sessionId },
    status: 'idle',
    followup(message) {
      delivered.push({ sessionId, message })
      agent.status = 'running'
    },
    whenIdle: () => new Promise(resolve => { releaseIdle = () => { agent.status = 'idle'; resolve() } }),
  }
  agents.set(sessionId, agent)
  return agent
}
const hostCtx = {
  logger: { warn() {} },
  effect: (factory) => { const dispose = factory(); return dispose },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  tools: { register: (tool) => { tools.push(tool); return () => {} } },
  sessionController: {
    create: async (request) => {
      created.push({ via: 'sessionController', ...request })
      const id = `session-fake-${created.length}`
      liveSessions.add(id)
      return { sessionId: id }
    },
  },
  agents: {
    get: sessionId => agents.get(sessionId),
    resume: async ({ resumeSessionId }) => ({ agent: fakeAgent(resumeSessionId) }),
    create: async (options) => {
      created.push(options)
      liveSessions.add(options.sessionId)
      return { session: { id: options.sessionId } }
    },
  },
  systemPrompt: {
    section: (section) => { sections.push(section); return () => {} },
  },
  // Workspace + title fakes: record what the host does for a bound Session.
  workspaceRegistry: {
    archiveSession: async (sessionId) => { archived.push(sessionId) },
    list: () => workspaces,
    delete: async (id) => {
      const index = workspaces.findIndex(item => item.id === id)
      if (index === -1) return false
      workspaces.splice(index, 1)
      return true
    },
    create: async (folder, title) => {
      const existing = workspaces.find(item => item.path === folder)
      if (existing !== undefined) return existing
      const created = {
        id: `ws-${workspaces.length + 1}`,
        path: folder,
        title: title ?? folder,
        sessionIds: [],
        setTitle: async (next) => { created.title = next },
        attachSession: async (sessionId) => { if (!created.sessionIds.includes(sessionId)) created.sessionIds.push(sessionId) },
      }
      workspaces.push(created)
      return created
    },
  },
  sessions: { get: sessionId => (liveSessions.has(sessionId) ? { id: sessionId } : undefined) },
  sessionTitle: { rename: (session, title) => { titles.set(session.id, title); return { title } } },
}
const configDir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-wired-'))
host.apply(hostCtx, { dataDir: configDir })

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-test-'))
const store = new host.TeamStore(dataDir, () => {})

/**
 * Build the request shape `dispatch` consumes.
 * @param pathname - absolute path below the plugin prefix.
 * @param init - method, headers, and raw body.
 */
const request = (pathname, init = {}) => host.dispatchRequest({
  method: init.method ?? 'GET',
  pathname,
  header: (name) => init.headers?.[name],
  body: init.body ?? '',
}, store)
const post = (body, headers = { 'content-type': 'application/json' }) =>
  request('/bots-team/api/bots', { method: 'POST', headers, body: JSON.stringify(body) })

await check('registers one prefix route, six tools, and the standing team note', async () => {
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/bots-team/api')
  assert.equal(typeof routes[0].handler, 'function', 'writes need a handler; a resource only sees GET and HEAD')
  assert.deepEqual(tools.map(tool => tool.name),
    ['team_roster', 'team_hire', 'team_brief', 'team_fire', 'team_assign', 'team_status'])
  assert.doesNotThrow(() => JSON.stringify(tools[0].parameters))
  assert.deepEqual(sections.map(section => section.name), ['bots-team/persona', 'bots-team'])
})

await check('the wired route answers a real request pair', async () => {
  const chunks = []
  const headers = {}
  const req = {
    method: 'GET',
    url: '/bots-team/api/state',
    headers: {},
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield Buffer.from(chunk) },
  }
  const res = {
    writeHead: (status, values) => { headers.status = status; Object.assign(headers, values) },
    end: (text = '') => { headers.body = text },
  }
  await routes[0].handler(req, res)
  assert.equal(headers.status, 200)
  assert.match(headers['content-type'], /application\/json/u)
  const body = JSON.parse(headers.body)
  assert.equal(body.ok, true)
  assert.ok(body.state.bots.length >= 3, 'the wired route seeds its own roster')
})

/**
 * Speak to the route the Host actually serves, so the tool checks and the HTTP
 * checks drive one roster instead of two.
 */
const wire = async (pathname, { method = 'GET', headers = {}, body = '' } = {}) => {
  const chunks = body === '' ? [] : [body]
  const req = {
    method,
    url: pathname,
    headers,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield Buffer.from(chunk) },
  }
  const out = { status: undefined, headers: {}, body: undefined }
  const res = {
    writeHead: (status, values) => { out.status = status; Object.assign(out.headers, values) },
    end: (text = '') => { out.body = text },
  }
  await routes[0].handler(req, res)
  return { status: out.status, body: out.body === '' || out.body === undefined ? undefined : JSON.parse(out.body) }
}
const wirePost = (payload) => wire('/bots-team/api/bots', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

await check('seeds a team on first run', async () => {
  const { status, body } = await request('/bots-team/api/state')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.state.bots.map(bot => bot.id), ['chief', 'scout', 'forge', 'ledger'])
  assert.equal(body.state.chiefId, 'chief')
  assert.equal(body.state.bots[0].chief, true)
  assert.match(body.state.bots[0].persona, /chief of staff/iu)
  assert.deepEqual(body.state.assignments, [])
  assert.equal(body.state.templates.length, 4)
  assert.equal(body.state.dataDir, dataDir)
})

await check('writes a persona file and an instruction-root marker per bot', async () => {
  const agents = await readFile(path.join(dataDir, 'bots/scout/AGENTS.md'), 'utf8')
  assert.match(agents, /^# Scout — Researcher/mu)
  assert.match(agents, /You find things out/u)
  assert.equal((await stat(path.join(dataDir, 'bots/scout/.git'))).isDirectory(), true)
})

await check('creates a bot from a template and writes its persona', async () => {
  const { status, body } = await post({ op: 'create', bot: { template: 'quill', name: 'Scribe', role: 'Editor' } })
  assert.equal(status, 200)
  assert.equal(body.bot.name, 'Scribe')
  assert.equal(body.bot.id, 'scribe')
  assert.equal(body.bot.emoji, '✍️')
  const agents = await readFile(path.join(dataDir, 'bots/scribe/AGENTS.md'), 'utf8')
  assert.match(agents, /You are \*\*Scribe\*\*/u)
})

await check('updates persona and binds a session', async () => {
  const updated = await post({ op: 'update', botId: 'scribe', patch: { persona: 'You edit ruthlessly.' } })
  assert.equal(updated.body.bot.persona, 'You edit ruthlessly.')
  const bound = await post({ op: 'bind', botId: 'scribe', sessionId: 'sess-123' })
  assert.equal(bound.body.bot.sessionId, 'sess-123')
  const agents = await readFile(path.join(dataDir, 'bots/scribe/AGENTS.md'), 'utf8')
  assert.match(agents, /You edit ruthlessly\./u)
})

await check('rejects unknown operations, wrong methods, and unsafe requests', async () => {
  assert.equal((await post({ op: 'launch' })).status, 400)
  assert.equal((await request('/bots-team/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403)
  assert.equal((await request('/bots-team/api/bots')).status, 405)
  assert.equal((await post({ op: 'create' }, { 'content-type': 'text/plain' })).status, 415)
  const crossOrigin = { 'content-type': 'application/json', origin: 'http://evil.test', host: '127.0.0.1:58595' }
  assert.equal((await post({ op: 'create' }, crossOrigin)).status, 403)
  const sameOrigin = { 'content-type': 'application/json', origin: 'http://127.0.0.1:58595', host: '127.0.0.1:58595' }
  assert.equal((await post({ op: 'create' }, sameOrigin)).status, 500, 'same-origin is admitted and then fails validation')
  assert.equal((await request('/bots-team/api/nope')).status, 404)
})

await check('reports a bot it cannot find instead of throwing', async () => {
  const { status, body } = await post({ op: 'delete', botId: 'nobody' })
  assert.equal(status, 500)
  assert.match(body.error, /unknown bot/u)
})

await check('removes a bot from the roster but keeps its folder', async () => {
  const { body } = await post({ op: 'delete', botId: 'scribe' })
  assert.equal(body.removed.id, 'scribe')
  assert.equal(body.state.bots.some(bot => bot.id === 'scribe'), false)
  assert.match(await readFile(path.join(dataDir, 'bots/scribe/AGENTS.md'), 'utf8'), /You are \*\*Scribe\*\*/u)
})

await check('agent tools read and mutate the same roster', async () => {
  const roster = await tools[0].execute({}, {})
  assert.equal(roster.bots.length, 4)
  assert.equal(roster.chiefId, 'chief')
  assert.equal(typeof roster.bots[0].folder, 'string')
  const hired = await tools[1].execute({ name: 'Echo', persona: 'You repeat back what matters.', role: 'Challenger' }, {})
  assert.equal(hired.bot.name, 'Echo')
  const briefed = await tools[2].execute({ botId: hired.bot.id, role: 'Skeptic' }, {})
  assert.equal(briefed.bot.role, 'Skeptic')
  const fired = await tools[3].execute({ botId: hired.bot.id }, {})
  assert.equal(fired.removed.id, hired.bot.id)
})

await check('the chief proposes work but sends nothing', async () => {
  const assign = tools.find(tool => tool.name === 'team_assign')
  assert.equal(delivered.length, 0, 'a tool call must not deliver on its own')
  const proposal = await assign.execute({ assignments: [{ botId: 'scout', task: '复跑 3.2 的两条命令，回报数字是否一致。' }] }, {})
  assert.equal(proposal.mode, 'awaiting-confirmation')
  assert.equal(proposal.assignments.length, 1)
  assert.match(proposal.note, /confirm/u)
  assert.equal(delivered.length, 0)
})

await check('dispatch needs a session before it can wake a bot', async () => {
  const state = (await wire('/bots-team/api/state')).body.state
  const record = state.assignments.find(candidate => candidate.status === 'proposed')
  assert.ok(record, 'the chief proposal is on the served roster')
  const attempted = await wirePost({ op: 'dispatch', assignmentId: record.id })
  assert.equal(attempted.body.ok, true)
  assert.equal(attempted.body.assignment.status, 'failed')
  assert.match(attempted.body.assignment.error, /no session yet/u)
})

await check('a dispatched task lands as a user message in the bot session', async () => {
  await wirePost({ op: 'bind', botId: 'scout', sessionId: 'sess-scout' })
  const proposed = await wirePost({ op: 'propose', items: [{ botId: 'scout', task: '核对表 2 的数字。' }], source: 'chief' })
  const record = proposed.body.assignments[0]
  const dispatched = await wirePost({ op: 'dispatch', assignmentId: record.id })
  assert.equal(dispatched.status, 200)
  assert.equal(dispatched.body.assignment.status, 'sent')
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].sessionId, 'sess-scout')
  assert.equal(delivered[0].message.role, 'user')
  assert.equal(delivered[0].message.content[0].text, '核对表 2 的数字。')
  assert.equal(delivered[0].message.source.kind, 'team-assign')
  releaseIdle()
  await new Promise(resolve => setTimeout(resolve, 10))
  const after = (await wire('/bots-team/api/state')).body.state
  assert.equal(after.assignments.find(candidate => candidate.id === record.id).status, 'done')
})

await check('a dispatch can only be claimed once, even when two clicks race', async () => {
  await wirePost({ op: 'bind', botId: 'scout', sessionId: 'sess-scout' })
  const proposed = await wirePost({ op: 'propose', items: [{ botId: 'scout', task: '只有一次。' }], source: 'chief' })
  const id = proposed.body.assignments[0].id
  const before = delivered.length
  const [first, second] = await Promise.all([
    wirePost({ op: 'dispatch', assignmentId: id }),
    wirePost({ op: 'dispatch', assignmentId: id }),
  ])
  const codes = [first.status, second.status].sort()
  assert.deepEqual(codes, [200, 500], 'the second caller is refused instead of sending again')
  assert.equal(delivered.length - before, 1, 'the bot received exactly one task')
  releaseIdle()
})

await check('a record that already finished is not moved again by a late waiter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-terminal-'))
  const store = new host.TeamStore(dir, () => {})
  await store.load()
  const [record] = await store.propose([{ botId: 'scout', task: '先取消，再迟到一个 done。' }], 'panel')
  await store.cancel(record.id)
  const late = await store.settle(record.id, 'done')
  assert.equal(late.status, 'cancelled', 'a late settle cannot overwrite a decision')
  const state = await new host.TeamStore(dir, () => {}).load()
  assert.equal(state.assignments.find(entry => entry.id === record.id).status, 'cancelled')
  await rm(dir, { recursive: true, force: true })
})

await check('restarting or removing a bot stops reporting its in-flight work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-orphan-'))
  const store = new host.TeamStore(dir, () => {})
  store.workspaces = { archiveSession: async () => {} }
  await store.load()
  const [first] = await store.propose([{ botId: 'scout', task: '重启前在跑的活。' }], 'panel')
  await store.mutate(async (state) => {
    const entry = state.assignments.find(candidate => candidate.id === first.id)
    entry.status = 'sent'
    entry.sentAt = Date.now()
    await store.write(state)
  })
  await store.restart('scout')
  const afterRestart = (await store.load()).assignments.find(entry => entry.id === first.id)
  assert.equal(afterRestart.status, 'cancelled', 'the archived conversation took the task with it')
  assert.match(String(afterRestart.error), /archived/u)

  const [second] = await store.propose([{ botId: 'forge', task: '解雇前在跑的活。' }], 'panel')
  await store.mutate(async (state) => {
    const entry = state.assignments.find(candidate => candidate.id === second.id)
    entry.status = 'sent'
    await store.write(state)
  })
  await store.remove('forge')
  const afterRemove = (await store.load()).assignments.find(entry => entry.id === second.id)
  assert.equal(afterRemove.status, 'cancelled')
  await rm(dir, { recursive: true, force: true })
})

await check('one conversation cannot be bound to two bots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-bindu-'))
  const store = new host.TeamStore(dir, () => {})
  store.workspaces = { create: async () => undefined, list: () => [], delete: async () => false }
  store.sessions = { get: () => ({ id: 'sess-shared' }) }
  store.sessionTitle = { rename: () => ({}) }
  await store.load()
  await store.bind('scout', 'sess-shared')
  await store.bind('forge', 'sess-shared')
  const state = await new host.TeamStore(dir, () => {}).load()
  const holders = state.bots.filter(bot => bot.sessionId === 'sess-shared')
  assert.equal(holders.length, 1, 'only one bot owns the conversation')
  assert.equal(holders[0].id, 'forge', 'the newest binding wins')
  await rm(dir, { recursive: true, force: true })
})

await check('the roster endpoint refuses anything but a same-origin loopback JSON call', async () => {
  const crossSite = await wire('/bots-team/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', host: '127.0.0.1:57132' },
    body: JSON.stringify({ op: 'open', botId: 'scout' }),
  })
  assert.equal(crossSite.status, 403)

  const rebinding = await request('/bots-team/api/state', { headers: { host: 'evil.example:57132' } })
  assert.equal(rebinding.status, 403, 'a non-loopback Host is refused even when Origin matches')

  const badType = await wire('/bots-team/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', host: '127.0.0.1:57132' },
    body: JSON.stringify({ op: 'open', botId: 'scout' }),
  })
  assert.equal(badType.status, 415, 'a form post cannot write')

  const huge = await wire('/bots-team/api/bots', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:57132' },
    body: JSON.stringify({ op: 'create', bot: { name: 'x'.repeat(300_000) } }),
  })
  assert.equal(huge.status, 413, 'an oversized body is refused with 413')
})

await check('a binding cannot be pointed at an arbitrary folder', async () => {
  const patched = await wirePost({ op: 'update', botId: 'scout', patch: { folder: '/tmp/anywhere-at-all' } })
  assert.equal(patched.status, 200)
  assert.ok(patched.body.bot.folder.endsWith('/bots/scout'), 'the folder always follows the roster')
})

await check('a record left in flight by a restart is settled on activation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-reconcile-'))
  const first = new host.TeamStore(dir, () => {})
  await first.load()
  const [record] = await first.propose([{ botId: 'forge', task: '半路断电。' }], 'chief')
  await first.mutate(async (state) => {
    const entry = state.assignments.find(candidate => candidate.id === record.id)
    entry.status = 'sent'
    entry.sentAt = Date.now()
    await first.write(state)
  })
  await first.reconcileSent()
  const state = await new host.TeamStore(dir, () => {}).load()
  const settled = state.assignments.find(candidate => candidate.id === record.id)
  assert.equal(settled.status, 'failed')
  assert.match(String(settled.error), /restarted/u)
  await rm(dir, { recursive: true, force: true })
})

await check('a panel click dispatches directly, and cancel drops a proposal', async () => {
  const before = delivered.length
  const direct = await wirePost({ op: 'assign', botId: 'scout', task: '直接派一条。' })
  assert.equal(direct.body.assignment.status, 'sent')
  assert.equal(delivered.length, before + 1)
  const proposed = await wirePost({ op: 'propose', items: [{ botId: 'forge', task: '临时任务。' }] })
  const dropped = await wirePost({ op: 'cancel', assignmentId: proposed.body.assignments[0].id })
  assert.equal(dropped.body.assignment.status, 'cancelled')
  const stale = await wirePost({ op: 'dispatch', assignmentId: dropped.body.assignment.id })
  assert.equal(stale.status, 500)
  assert.match(stale.body.error, /cancelled/u)
})

await check('a failed delivery can be reopened and retried', async () => {
  const proposed = await wirePost({ op: 'propose', items: [{ botId: 'ledger', task: '需要一个会话。' }] })
  const id = proposed.body.assignments[0].id
  const failed = await wirePost({ op: 'dispatch', assignmentId: id })
  assert.equal(failed.body.assignment.status, 'failed')
  const reopened = await wirePost({ op: 'reopen', assignmentId: id })
  assert.equal(reopened.body.assignment.status, 'proposed')
  assert.equal(reopened.body.assignment.error, '')
  await wirePost({ op: 'bind', botId: 'ledger', sessionId: 'sess-ledger' })
  const retried = await wirePost({ op: 'dispatch', assignmentId: id })
  assert.equal(retried.body.assignment.status, 'sent', 'the same record dispatches after a retry')
  const bad = await wirePost({ op: 'reopen', assignmentId: id })
  assert.equal(bad.status, 500)
  assert.match(bad.body.error, /sent/u)
})

await check('the whole queue dispatches and cancels in one call', async () => {
  await wirePost({ op: 'bind', botId: 'forge', sessionId: 'sess-forge' })
  const loner = await wirePost({ op: 'create', bot: { name: 'Loner', role: 'QA', persona: 'Never opened.' } })
  const before = delivered.length
  await wirePost({ op: 'propose', items: [
    { botId: 'scout', task: 'A 组任务。' },
    { botId: 'forge', task: 'B 组任务。' },
    { botId: loner.body.bot.id, task: 'C 组任务。' },
  ], source: 'chief' })
  const all = await wirePost({ op: 'dispatchAll' })
  assert.equal(all.body.dispatched.length, 3)
  assert.equal(all.body.sent, 2, 'scout and forge have sessions')
  assert.equal(all.body.failed, 1, 'a bot nobody opened has none')
  assert.equal(delivered.length, before + 2)
  const open = (await wire('/bots-team/api/state')).body.state.assignments.filter(record => record.status === 'proposed')
  assert.equal(open.length, 0, 'dispatchAll leaves nothing proposed')

  await wirePost({ op: 'propose', items: [
    { botId: 'scout', task: '待取消 1。' },
    { botId: 'forge', task: '待取消 2。' },
  ] })
  const cancelled = await wirePost({ op: 'cancelAll' })
  assert.equal(cancelled.body.cancelled.length, 2)
  assert.equal(cancelled.body.state.assignments.filter(record => record.status === 'proposed').length, 0)
})

await check('a bot with no session can be given a conversation without a task', async () => {
  const hired = await wirePost({ op: 'create', bot: { name: 'Waiter', role: 'Waiter', persona: 'Wait for work.' } })
  const quiet = hired.body.bot.id
  const before = created.length
  const opened = await wirePost({ op: 'open', botId: quiet })
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  const bot = opened.body.bot
  assert.match(bot.sessionId, /^session-/u)
  assert.equal(bot.organized, true, 'the new conversation is titled and filed')
  assert.equal(created.length, before + 1)
  const workspacePath = (await wire('/bots-team/api/state')).body.state.workspacePath
  assert.equal(created.at(-1).cwd, workspacePath, 'created in the team Workspace')
  // Opening twice must not create a second conversation.
  const again = await wirePost({ op: 'open', botId: quiet })
  assert.equal(again.body.bot.sessionId, bot.sessionId)
  assert.equal(created.length, before + 1)
})

await check('starting a bot over archives its conversation and clears the binding', async () => {
  const restarted = await wirePost({ op: 'restart', botId: 'scout' })
  assert.equal(restarted.status, 200)
  assert.equal(restarted.body.bot.sessionId, null)
  assert.equal(restarted.body.bot.organized, false)
  assert.deepEqual(archived, ['sess-scout'], 'the old conversation is archived, not deleted')
  const state = (await wire('/bots-team/api/state')).body.state
  assert.equal(state.bots.find(bot => bot.id === 'scout').sessionId, null, 'the clear is persisted')
  // Put the fixture back for the checks that follow.
  await wirePost({ op: 'bind', botId: 'scout', sessionId: 'sess-scout' })
  archived.length = 0
})

await check('the chief dispatches directly while every other caller still proposes', async () => {
  const assign = tools.find(tool => tool.name === 'team_assign')

  // A call from the chief's own Session delivers.
  await wirePost({ op: 'bind', botId: 'chief', sessionId: 'sess-chief' })
  hostCtx.agents.currentInitiator = () => fakeAgent('sess-chief')
  const chiefRun = await assign.execute({ assignments: [{ botId: 'forge', task: 'Build the thing.' }] }, {})
  assert.equal(chiefRun.mode, 'dispatched')
  assert.equal(chiefRun.assignments[0].status, 'sent')

  // A call from anywhere else still waits for a click.
  hostCtx.agents.currentInitiator = () => fakeAgent('sess-somebody-else')
  const otherRun = await assign.execute({ assignments: [{ botId: 'ledger', task: 'Check the numbers.' }] }, {})
  assert.equal(otherRun.mode, 'awaiting-confirmation')
  assert.equal(otherRun.assignments[0].status, undefined)

  hostCtx.agents.currentInitiator = () => undefined
})

await check('team_status reports sessions, live agents, and recent assignments', async () => {
  const status = tools.find(tool => tool.name === 'team_status')
  const report = await status.execute({}, {})
  const scout = report.bots.find(bot => bot.id === 'scout')
  assert.equal(scout.hasChat, true)
  assert.equal(scout.agentLive, true)
  assert.equal(report.unattended, false)
  assert.ok(report.assignments.length >= 1)
  assert.ok(report.assignments.some(record => record.status === 'done'))
})

await check('every bot session lands in the one shared workspace', async () => {
  assert.equal(workspaces.length, 1, 'the team shares a single workspace')
  const team = workspaces[0]
  assert.equal(team.title, 'Bot team')
  const root = (await wire('/bots-team/api/state')).body.state.workspacePath
  assert.equal(team.path, root, 'the shared workspace sits at the roster directory itself')
  assert.ok(team.sessionIds.includes('sess-forge'), 'a bound bot session is attached to it')
  assert.equal(titles.get('sess-scout'), 'Scout', 'and the conversation is named after its bot')
  const perBot = workspaces.filter(item => item.path.includes('/bots/'))
  assert.equal(perBot.length, 0, 'no workspace is created per bot')
})

await check('the same bot is not renamed twice', async () => {
  // Count the renames instead of relying on a throwing stub: the migration skips
  // organised bots entirely, so a throw would never be reached and the check
  // would pass even if every load renamed the conversation again.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-rename-'))
  const first = new host.TeamStore(dir, () => {})
  first.workspaces = { create: async () => undefined, list: () => [], delete: async () => false }
  first.sessions = { get: () => ({ id: 'sess-counted' }) }
  first.sessionTitle = { rename: (session, title) => { titles.set(session.id, title); return { title } } }
  await first.load()
  await first.bind('scout', 'sess-counted')
  assert.equal(titles.get('sess-counted'), 'Scout', 'binding a conversation names it once')

  let renames = 0
  const second = new host.TeamStore(dir, () => {})
  second.workspaces = { create: async () => undefined, list: () => [], delete: async () => false }
  second.sessions = { get: () => undefined }
  second.sessionTitle = { rename: () => { renames += 1 } }
  second.agents = { get: () => undefined, resume: async () => ({ agent: {}, dispose() {} }), turnBoundaryOf: () => undefined }
  await second.migrate()
  await second.migrate()
  assert.equal(renames, 0, 'an already-organised bot is never renamed again')
  await rm(dir, { recursive: true, force: true })
})

await check('no workspace is created per bot folder', async () => {
  assert.equal(workspaces.length, 1, 'still exactly one workspace for the whole team')
  const perBot = workspaces.filter(item => item.path.includes('/bots/'))
  assert.deepEqual(perBot, [], 'no workspace points at a bot folder')
})

await check('a bot session receives its own persona, and nothing else does', async () => {
  const persona = sections.find(section => section.name === 'bots-team/persona')
  assert.ok(persona, 'the persona section is registered')
  const asSession = (id) => ({ agent: { session: { id } } })

  const text = persona.text(asSession('sess-scout'))
  assert.match(text, /You are \*\*Scout\*\*/u)
  assert.match(text, /bots\/scout/u)
  assert.equal(persona.text(asSession('sess-not-a-bot')), '', 'a session outside the roster gets nothing')
  assert.equal(persona.text({}), '', 'an assembly with no agent gets nothing')
})

await check('the standing note names the team and the confirmation gate', async () => {
  const guidance = sections.find(section => section.name === 'bots-team')
  const text = guidance.text({})
  assert.match(text, /Bot team/u)
  assert.match(text, /Scout/u)
  assert.match(text, /chief of staff/u)
  assert.match(text, /Team panel/u)
})

await check('a stale snapshot cannot resurrect a cleared binding', async () => {
  // Two instances over one file: the first one works from its cached state and
  // write from it; the second clears a binding. A later mutation on the first
  // must not bring the binding back.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-stale-'))
  const stale = new host.TeamStore(dir, () => {})
  await stale.load()
  await stale.bind('scout', 'sess-old')

  const other = new host.TeamStore(dir, () => {})
  await other.load()
  await other.bind('scout', '')

  await stale.mutate(async (state) => {
    const bot = state.bots.find(candidate => candidate.id === 'forge')
    bot.role = 'Builder'
    await stale.write(state)
  })

  const fresh = new host.TeamStore(dir, () => {})
  const state = await fresh.load()
  assert.equal(state.bots.find(bot => bot.id === 'scout').sessionId, null, 'the cleared binding stays cleared')
  assert.equal(state.bots.find(bot => bot.id === 'forge').role, 'Builder', 'and the newer change landed')
  await rm(dir, { recursive: true, force: true })
})

await check('a session binding survives a reload', async () => {
  // Regression: reloading used to rebuild each bot from defaults, which dropped
  // the bound Session and left a dispatched task with nowhere to go.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-reload-'))
  const first = new host.TeamStore(dir, () => {})
  await first.load()
  await first.bind('scout', 'sess-persisted')
  const second = new host.TeamStore(dir, () => {})
  const state = await second.load()
  const scout = state.bots.find(bot => bot.id === 'scout')
  assert.equal(scout.sessionId, 'sess-persisted')
  assert.equal(scout.folder, path.join(dir, 'bots/scout'))
  assert.ok(scout.createdAt > 0)
  assert.equal(state.bots[0].id, 'chief', 'the chief still leads after a reload')
  await rm(dir, { recursive: true, force: true })
})

await check('a corrupt roster is recovered from the backup, never silently wiped', async () => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bots-team-broken-'))

  // Half-written JSON with a good backup next to it: recover, do not re-seed.
  const store = new host.TeamStore(dir, () => {})
  await store.load()
  await store.bind('scout', 'sess-kept')
  await store.mutate(async (state) => { await store.write(state) })   // refreshes .bak
  await writeFile(path.join(dir, 'team.json'), '{not json', 'utf8')
  const recovered = await new host.TeamStore(dir, () => {}).load()
  assert.equal(recovered.bots.length, 4, 'the roster still has its bots')
  assert.ok(recovered.bots.some(bot => bot.sessionId === 'sess-kept'), 'and the binding survived')

  // No backup either: refuse to load rather than overwrite the file with a seed.
  const lonely = await mkdtemp(path.join(os.tmpdir(), 'bots-team-lonely-'))
  await writeFile(path.join(lonely, 'team.json'), '{not json', 'utf8')
  await assert.rejects(() => new host.TeamStore(lonely, () => {}).load(), /refusing to overwrite/u)
  assert.equal(await readFile(path.join(lonely, 'team.json'), 'utf8'), '{not json', 'the damaged file is left untouched')

  await rm(dir, { recursive: true, force: true })
  await rm(lonely, { recursive: true, force: true })
})

/* ---------------------------------------------------------------- browser client */

/** Minimal React surface used by the panel. */
function createReactShim() {
  const Fragment = Symbol('Fragment')
  class Component {
    constructor(props) { this.props = props; this.state = props?.state ?? {} }
    setState(next) { this.state = { ...this.state, ...next } }
  }
  return {
    Fragment,
    Component,
    createElement(type, props, ...children) {
      const kids = children.length === 0 ? undefined : (children.length === 1 ? children[0] : children)
      return { type, props: { ...(props ?? {}), children: kids } }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useRef(initial) { return { current: initial } },
    useEffect() {},
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
}

const react = createReactShim()
let captured
globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration } } }
await import('../client.js')
assert.equal(captured.id, 'dsh-bots-team')
const clientExports = captured.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`unexpected external import: ${specifier}`)
})

await check('both READMEs still describe the code that ships', async () => {
  const { readFileSync, existsSync } = await import('node:fs')
  const read = name => readFileSync(path.resolve(name), 'utf8')
  const en = read('README.md')
  const zh = read('README.zh.md')

  // Same section structure in both languages: a rewrite must not drop one.
  const sections = text => [...text.matchAll(/^## .+$/gmu)].length
  assert.equal(sections(en), sections(zh), 'both READMEs keep the same number of sections')

  // The numbers a reader trusts must match the suite and the tool registry.
  const checks = (read('test/smoke.mjs').match(/await check\(/gu) ?? []).length
  assert.match(en, new RegExp(`\\b${checks} checks?\\b`, 'u'), `the README names the real check count (${checks})`)
  assert.match(zh, new RegExp(`${checks} 项`, 'u'), 'the Chinese README names the same check count')

  const registered = [...read('index.js').matchAll(/name: '(team_[a-z]+)'/gu)].map(match => match[1])
  const documented = text => [...text.matchAll(/^\| `(team_[a-z]+)`/gmu)].map(match => match[1])
  assert.deepEqual(documented(en).sort(), registered.sort(), 'the English tool table lists exactly the registered tools')
  assert.deepEqual(documented(zh).sort(), registered.sort(), 'the Chinese tool table lists them too')

  // The English README speaks English: only the language label may be Chinese.
  for (const line of en.split('\n')) {
    if (!/[\u4e00-\u9fff]/u.test(line)) continue
    assert.ok(/简体中文|README\.zh\.md/u.test(line), `English README carries stray Chinese: ${line.slice(0, 70)}`)
  }

  // The panel sketch is width-aligned; one stray character breaks the frame.
  // Terminal width: double for CJK and emoji, zero for a variation selector.
  const cells = (char) => {
    const code = char.codePointAt(0)
    if (code === 0xFE0E || code === 0xFE0F) return 0
    const wide = (code >= 0x1100 && code <= 0x115F)
      || (code >= 0x2E80 && code <= 0xA4CF)
      || (code >= 0xAC00 && code <= 0xD7A3)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0xFE30 && code <= 0xFE6F)
      || (code >= 0xFF00 && code <= 0xFF60)
      || (code >= 0xFFE0 && code <= 0xFFE6)
      || (code >= 0x1F000 && code <= 0x1FAFF)
      || (code >= 0x2600 && code <= 0x27BF)
    return wide ? 2 : 1
  }
  for (const [name, text] of [['README.md', en], ['README.zh.md', zh]]) {
    const block = /```\n(┌[\s\S]*?)```/u.exec(text)
    assert.ok(block, `${name} still sketches the panel`)
    const widths = new Set(block[1].trimEnd().split('\n').map(line => [...line].reduce((total, char) => total + cells(char), 0)))
    assert.equal(widths.size, 1, `${name}'s sketch lines share one width (got ${[...widths].join(',')})`)
  }

  // The detail page the plugin manager shows must not drift either.
  const detail = read('docs/DETAIL.md')
  const toolRows = [...detail.matchAll(/^\| `(team_[a-z]+)`/gmu)].map(match => match[1])
  assert.deepEqual(toolRows.sort(), registered.sort(), 'the detail page lists exactly the registered tools')
  assert.ok(!/four tools|三个工具/iu.test(detail), 'the detail page counts the tools correctly')
  assert.ok(!/deleting the bot and hiring|删掉这个 Bot 重新招/u.test(detail), 'it describes Start a new conversation, not re-hiring')

  // Relative links must point at files that exist.
  for (const [name, text] of [['README.md', en], ['README.zh.md', zh]]) {
    for (const match of text.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/gu)) {
      const target = match[1].split('#')[0]
      assert.ok(existsSync(path.resolve(target)), `${name} links to an existing file: ${target}`)
    }
  }
})

await check('client module declares its inject face', async () => {
  assert.equal(typeof clientExports.apply, 'function')
  assert.deepEqual(clientExports.inject, ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout'])
})

/** Fake Client context capturing slot registrations. */
const registrations = []
const localeDict = {}
const clientCtx = {
  effect: (factory) => { factory(); return () => {} },
  locale: {
    register: (ns, dictionaries) => { localeDict[ns] = dictionaries; return () => {} },
    bind: (ns) => (key, vars) => {
      const text = localeDict[ns]?.en?.[key] ?? key
      return vars === undefined ? text : Object.entries(vars).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), text)
    },
  },
  slots: {
    inject: (_key, callback) => { callback(); return () => {} },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
  sessions: { retain: () => { throw new Error('no live session in the smoke test') }, create: async () => 'sess-created' },
  uiWorkspace: { openSession: () => {} },
  layout: { panelInfo: { subscribe: () => () => {}, getSnapshot: () => ({ activePanelId: undefined }) } },
}
clientExports.apply(clientCtx)

await check('registers a sidebar entry and a main panel under one id', async () => {
  const sidebar = registrations.find(entry => entry.options.name === 'sidebar.panellist')
  const main = registrations.find(entry => entry.options.name === 'main')
  assert.ok(sidebar, 'sidebar.panellist registration missing')
  assert.ok(main, 'main registration missing')
  assert.equal(sidebar.options.id, 'bots-team')
  assert.equal(main.options.key, 'bots-team')
  assert.equal(sidebar.options.id, main.options.key, 'the entry id must address the panel key')
  assert.equal(sidebar.options.label(), 'Team')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof main.options.inject, 'function')
  assert.equal(localeDict.botsTeam.zh.panel, '团队')
})

const controller = registrations.find(entry => entry.options.name === 'main').options.inject().controller
const panel = registrations.find(entry => entry.options.name === 'main').component

/**
 * Expand a tree produced by the shim: function components are invoked so their
 * own output joins the tree, class components are left as elements, and strings
 * are collected as text. Hooks come from the shim, so expansion is a plain
 * depth-first walk with no scheduler.
 */
function walk(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (typeof node !== 'object') {
    out.push(node)
    return out
  }
  const { type, props } = node
  if (typeof type === 'function') {
    if (type.prototype instanceof react.Component) {
      out.push(node)
      return out
    }
    return walk(type(props), out)
  }
  out.push(node)
  walk(props?.children, out)
  return out
}

/** Render the registered panel through its error boundary. */
const render = () => {
  const wrapper = panel({ controller })
  const child = wrapper.props.children
  return walk(child.type(child.props))
}

await check('renders the loading state before the roster arrives', async () => {
  const nodes = render()
  assert.ok(nodes.some(node => node?.props?.className === 'bt-root bt-center'), 'expected the centered loading shell')
  assert.ok(nodes.includes('Loading the team…'), 'expected the loading copy')
})

await check('renders the roster and the selected bot once the Host answers', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/bots-team\/api\/state$/u)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        state: {
          dataDir,
          team: { name: 'My team' },
          bots: [
            { id: 'scout', name: 'Scout', emoji: '🧭', role: 'Researcher', color: '#5b8def', persona: 'Find things out.', folder: path.join(dataDir, 'bots/scout'), sessionId: null },
            { id: 'forge', name: 'Forge', emoji: '🛠️', role: 'Builder', color: '#e0743f', persona: 'Build things.', folder: path.join(dataDir, 'bots/forge'), sessionId: null },
          ],
          templates: [],
        },
      }),
    }
  }
  await controller.load()
  const nodes = render()
  assert.ok(nodes.includes('Scout'), 'roster should show Scout')
  assert.ok(nodes.includes('Forge'), 'roster should show Forge')
  assert.ok(nodes.includes('Researcher'), 'roster should show the role')
  assert.ok(nodes.includes('Your bot team'))
  assert.ok(nodes.includes('Not started'), 'a bot without a session reports not started')
  assert.equal(controller.getSnapshot().phase, 'ready')
  assert.equal(controller.getSnapshot().selectedId, 'scout')
})

await check('reports the endpoint failure instead of throwing', async () => {
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED') }
  const Fresh = Object.getPrototypeOf(controller).constructor
  const fresh = new Fresh(clientCtx, key => key)
  await fresh.load()
  assert.equal(fresh.getSnapshot().phase, 'error')
  assert.match(fresh.getSnapshot().error, /ECONNREFUSED/u)
  fresh.dispose()
})

await check('the editor renders template chips and a prefilled persona', async () => {
  controller.set({ templates: [{ id: 'scout', name: 'Scout', emoji: '🧭', role: 'Researcher', color: '#5b8def', persona: 'Find things out.' }] })
  controller.create('scout')
  const nodes = render()
  assert.equal(nodes.filter(node => node?.props?.className === 'bt-chip').length, 1)
  const textareas = nodes.filter(node => node?.props?.className === 'bt-textarea')
  assert.equal(textareas.length, 1)
  assert.equal(textareas[0].props.value, 'Find things out.')
  controller.cancelEdit()
})

let createdWith = {}
await check('sending the first message creates a session, binds it, and prompts it', async () => {
  const retained = []
  let prompted
  controller.ctx.sessions.retain = (sessionId) => {
    retained.push(sessionId)
    const binding = {
      session: {
        getSnapshot: () => ({ running: false }),
        subscribe: () => () => {},
        prompt: async (content, mode) => { prompted = { content, mode }; return { ok: true } },
      },
      eventSource: {
        getSnapshot: () => ({ entries: [{ type: 'event', event: { type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: 'hi scout' }] } } }] }),
        subscribe: () => () => {},
      },
    }
    return { sessionId, binding, ready: Promise.resolve(binding), release: () => retained.push(`released:${sessionId}`) }
  }
  const posts = []
  globalThis.fetch = async (url, init) => {
    posts.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        bot: { ...controller.getSnapshot().bots[0], sessionId: 'sess-created' },
        state: { bots: controller.getSnapshot().bots.map(bot => (bot.id === 'scout' ? { ...bot, sessionId: 'sess-created' } : bot)) },
      }),
    }
  }
  await controller.send('  hi scout  ')
  assert.equal(posts.length, 1, 'the bind call should run once')
  assert.deepEqual(posts[0], { op: 'bind', botId: 'scout', sessionId: 'sess-created' })
  assert.equal(createdWith.workspaceId ?? createdWith.cwd, controller.getSnapshot().workspaceId ?? controller.getSnapshot().workspacePath ?? createdWith.cwd)
  assert.deepEqual(prompted, { content: [{ type: 'text', text: 'hi scout' }], mode: 'queue' })
  assert.equal(controller.getSnapshot().draft, '')
  assert.deepEqual(retained, ['sess-created'])
  const nodes = render()
  assert.ok(nodes.some(node => node?.props?.className === 'bt-text'), 'the transcript row should render')
  assert.equal(controller.getSnapshot().rows[0].text, 'hi scout')
})

await check('a failed send restores the draft and reports the error', async () => {
  controller.ctx.sessions.retain = () => ({
    sessionId: 'sess-created',
    ready: Promise.resolve({
      session: { getSnapshot: () => ({}), subscribe: () => () => {}, prompt: async () => { throw new Error('rate limited') } },
      eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
    }),
    release: () => {},
  })
  controller.select('scout')
  await new Promise(resolve => setTimeout(resolve, 0))
  await controller.send('again')
  assert.equal(controller.getSnapshot().draft, 'again')
  assert.match(controller.getSnapshot().notice, /rate limited/u)
})

await check('opening the full chat navigates to the bot session', async () => {
  let opened
  controller.ctx.uiWorkspace.openSession = (sessionId) => { opened = sessionId }
  controller.openFull(controller.bot('scout'))
  assert.equal(opened, 'sess-created')
  controller.openFull({ ...controller.bot('scout'), sessionId: null })
  assert.equal(opened, 'sess-created', 'an unstarted bot must not navigate')
  assert.equal(controller.getSnapshot().notice, 'Not started')
})

await check('saving a bot from the editor posts, binds the roster, and reselects', async () => {
  const posts = []
  globalThis.fetch = async (url, init) => {
    posts.push(JSON.parse(init.body))
    const created = { id: 'echo', name: 'Echo', emoji: '🔁', role: 'Challenger', color: '#5b8def', persona: 'Push back.', folder: path.join(dataDir, 'bots/echo'), sessionId: null }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, bot: created, state: { bots: [...controller.getSnapshot().bots, created] } }),
    }
  }
  const saved = await controller.saveBot({ name: 'Echo', emoji: '🔁', role: 'Challenger', persona: 'Push back.' })
  assert.equal(saved, true)
  assert.deepEqual(posts[0], { op: 'create', bot: { name: 'Echo', emoji: '🔁', role: 'Challenger', persona: 'Push back.' } })
  assert.equal(controller.getSnapshot().editing, undefined)
  assert.equal(controller.getSnapshot().selectedId, 'echo')
  assert.ok(controller.getSnapshot().bots.some(bot => bot.id === 'echo'))
})

await check('deleting a bot falls back to a remaining one', async () => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(body.op, 'delete')
    const bots = controller.getSnapshot().bots.filter(bot => bot.id !== body.botId)
    return { ok: true, status: 200, json: async () => ({ ok: true, removed: { id: body.botId }, state: { bots } }) }
  }
  await controller.deleteBot('echo')
  assert.equal(controller.getSnapshot().bots.some(bot => bot.id === 'echo'), false)
  assert.ok(controller.getSnapshot().selectedId, 'a remaining bot is selected')
})

await check('disposal releases the retained session', async () => {
  let released = 0
  // Its own instance: disposing the shared controller would freeze the state the
  // later rendering checks still drive.
  const Fresh = Object.getPrototypeOf(controller).constructor
  const own = new Fresh(clientCtx, key => key)
  own.set({ bots: controller.getSnapshot().bots, selectedId: 'scout' })
  own.ctx.sessions.retain = () => ({
    sessionId: 'sess-created',
    ready: Promise.resolve({
      session: { getSnapshot: () => ({}), subscribe: () => () => {} },
      eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
    }),
    release: () => { released += 1 },
  })
  own.select('scout')
  await new Promise(resolve => setTimeout(resolve, 0))
  own.dispose()
  assert.equal(released, 1)
})

await check('a settled assignment is reported with its own wording', async () => {
  controller.set({ assignments: [{ id: 'r1', botId: 'scout', botName: 'Scout', task: 'x', status: 'sent' }] })
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      state: {
        bots: controller.getSnapshot().bots,
        assignments: [{ id: 'r1', botId: 'scout', botName: 'Scout', task: 'x', status: 'done' }],
      },
    }),
  })
  await controller.refresh()
  assert.match(controller.getSnapshot().toast, /Scout finished/u)
  assert.equal(controller.getSnapshot().assignments[0].status, 'done')
  controller.set({ assignments: [], toast: '' })
})

await check('a failed proposal stays in the queue with its reason and a retry', async () => {
  controller.set({
    assignments: [{ id: 'f1', botId: 'scout', botName: 'Scout', task: '需要会话。', status: 'failed', error: 'Scout has no session yet' }],
  })
  const nodes = render()
  assert.ok(nodes.some(node => String(node?.props?.className ?? '').includes('bt-proposal-failed')), 'the row is marked failed')
  const reason = nodes.find(node => node?.props?.className === 'bt-proposal-error')
  assert.equal(reason.props.children, 'Scout has no session yet')
  const retry = nodes.find(node => node?.props?.className === 'bt-primary' && node.props.children === 'Retry')
  assert.ok(retry, 'a failed row offers a retry')

  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body.op)
    if (body.op === 'reopen') {
      return { ok: true, status: 200, json: async () => ({ ok: true, assignment: { id: 'f1', status: 'proposed' }, state: { assignments: [] } }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assignment: { id: 'f1', status: 'sent' },
        state: { bots: controller.getSnapshot().bots, assignments: [{ id: 'f1', botId: 'scout', botName: 'Scout', task: '需要会话。', status: 'sent' }] },
      }),
    }
  }
  await controller.dispatchProposal('f1')
  assert.deepEqual(calls, ['reopen', 'dispatch'], 'a retry reopens first, then dispatches')
  assert.equal(controller.getSnapshot().assignments[0].status, 'sent')
})

await check('the panel dispatches every proposal at once', async () => {
  const virgoBot = { id: 'virgo2', name: 'Virgo', emoji: '🛰️', role: 'Spotter', color: '#5b8def', persona: 'Watch.', folder: path.join(dataDir, 'bots/virgo2'), sessionId: null }
  controller.set({
    bots: [...controller.getSnapshot().bots, virgoBot],
    assignments: [
      { id: 'q1', botId: 'scout', botName: 'Scout', task: 'one', status: 'proposed' },
      { id: 'q2', botId: 'virgo2', botName: 'Virgo', task: 'two', status: 'proposed' },
    ],
  })
  const nodes = render()
  const allButton = nodes.find(node => node?.props?.className === 'bt-primary bt-dispatch-all')
  assert.ok(allButton, 'more than one proposal offers a batch dispatch')
  assert.equal(allButton.props.children, 'Dispatch all (2)')

  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body === undefined ? {} : JSON.parse(init.body)
    calls.push(body.op ?? 'GET')
    if (body.op === 'bind') {
      return { ok: true, status: 200, json: async () => ({ ok: true, bot: { ...virgoBot, sessionId: 'sess-virgo' }, state: { bots: controller.getSnapshot().bots } }) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        sent: 2,
        failed: 0,
        dispatched: [],
        state: {
          bots: controller.getSnapshot().bots,
          assignments: [
            { id: 'q1', botId: 'scout', botName: 'Scout', task: 'one', status: 'sent' },
            { id: 'q2', botId: 'virgo2', botName: 'Virgo', task: 'two', status: 'sent' },
          ],
        },
      }),
    }
  }
  controller.ctx.sessions.create = async () => 'sess-virgo'
  await controller.dispatchAll()
  assert.equal(calls.filter(op => op === 'bind').length, 1, 'only the session-less bot is bound')
  assert.ok(calls.includes('dispatchAll'))
  assert.equal(controller.getSnapshot().assignments.filter(record => record.status === 'proposed').length, 0)
  assert.match(controller.getSnapshot().toast, /2 dispatched/u)
})

await check('the frame-wide notice opens the panel and disappears when empty', async () => {
  const overlay = registrations.find(entry => entry.options.name === 'shell.overlay')
  assert.ok(overlay, 'a shell.overlay registration should exist so proposals are visible outside the panel')
  controller.set({ assignments: [{ id: 'z1', botId: 'scout', botName: 'Scout', task: 'z', status: 'proposed' }] })
  let selected
  // The registered component is the wrapper that closes over apply()'s context,
  // so the spy belongs on that context's layout service.
  clientCtx.layout.selectPanel = (id) => { selected = id }
  const nodes = walk(overlay.component({ controller }))
  const pill = nodes.find(node => node?.props?.className === 'bt-pill')
  assert.ok(pill, 'the pill renders while something is pending')
  assert.equal(nodes.find(node => node?.props?.className === 'bt-pill-count').props.children, '1')
  pill.props.onClick()
  assert.equal(selected, 'bots-team', 'clicking the pill opens the team panel')
  controller.set({ assignments: [] })
  assert.equal(walk(overlay.component({ controller })).length, 0, 'nothing renders when the queue is empty')
})

await check('message text renders as markdown instead of raw characters', async () => {
  controller.set({
    rows: [{
      key: 'm1',
      role: 'assistant',
      text: [
        '两件事说清楚：',
        '',
        '1. **第一遍写得太糙**：任务文本只有一句话。',
        '2. 看 `team_assign` 的返回值，再决定。',
        '',
        '- 分工：Scout 查配额，Forge 建模。',
        '',
        '```sql',
        'select * from titles;',
        '```',
        '',
        '| 来源 | 许可 |',
        '|---|---|',
        '| OMDb | 免费档 |',
        '',
        '> 提案不等于已派出。',
      ].join('\n'),
      tools: [],
    }],
    assignments: [],
  })
  const nodes = render()
  const strings = nodes.filter(node => typeof node === 'string')
  assert.ok(!strings.some(text => text.includes('**')), 'no literal bold markers survive')
  assert.ok(!strings.some(text => text.includes('```')), 'no literal fences survive')
  assert.ok(nodes.some(node => node?.type === 'strong' && JSON.stringify(node.props.children).includes('第一遍写得太糙')))
  assert.ok(nodes.some(node => node?.type === 'code' && node.props.className === 'bt-md-code'), 'inline code')
  assert.ok(nodes.some(node => node?.type === 'ol'), 'ordered list')
  assert.ok(nodes.some(node => node?.type === 'ul'), 'unordered list')
  assert.ok(nodes.some(node => node?.type === 'pre'), 'fenced code block')
  assert.ok(nodes.some(node => node?.type === 'table'), 'pipe table')
  assert.ok(nodes.some(node => node?.type === 'blockquote'), 'block quote')
  const quoteText = JSON.stringify(nodes.find(node => node?.type === 'blockquote')).includes('提案不等于已派出')
  assert.ok(quoteText, 'the quote keeps its text')
  controller.set({ rows: [] })
})

await check('a deeply nested quote cannot take the panel down', async () => {
  controller.set({
    rows: [{
      key: 'deep',
      role: 'assistant',
      text: `${'> '.repeat(3000)}最深的一层。`,
      tools: [],
    }],
    assignments: [],
  })
  const nodes = render()
  const strings = []
  const collect = (node) => {
    if (typeof node === 'string') { strings.push(node); return }
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (node !== null && typeof node === 'object') collect(node.props?.children)
  }
  collect(nodes)
  assert.ok(strings.some(text => text.includes('最深的一层')), 'the message still shows its content')
  controller.set({ rows: [] })
})

await check('a message cannot inject markup through a link', async () => {
  controller.set({ rows: [{ key: 'm2', role: 'assistant', text: '[click](javascript:alert(1)) and [ok](https://example.com)', tools: [] }], assignments: [] })
  const nodes = render()
  const links = nodes.filter(node => node?.type === 'a')
  assert.equal(links.length, 2)
  assert.equal(links[0].props.href, undefined, 'a javascript: target is dropped')
  assert.equal(links[1].props.href, 'https://example.com')
  assert.equal(links[1].props.rel, 'noreferrer noopener')
  controller.set({ rows: [] })
})

await check('text on a brand fill follows the theme instead of staying white', async () => {
  // --dsw-alias-brand-primary is near-black in light mode and near-white in dark
  // mode, so a hardcoded white label disappears in dark mode. Everything filled
  // with the brand token must take its text colour from the inverting token.
  const css = /const CSS = `([\s\S]*?)`\n/u.exec((await import('node:fs')).readFileSync(path.resolve('client.js'), 'utf8'))[1]
  const rules = css.match(/[^{}\n]*\{[^}]*\}/gu) ?? []
  const brandRules = rules.filter(rule => /background(-color)?:\s*var\(--dsw-alias-brand-primary\)/u.test(rule))
  assert.ok(brandRules.length >= 3, 'the brand-filled controls are still there')
  for (const rule of brandRules) {
    assert.ok(!/#fff|#ffffff|white/iu.test(rule), `a brand-filled rule still hardcodes white text: ${rule.slice(0, 80)}`)
  }
})

await check('the sidebar icon draws without a background tile', async () => {
  const icon = registrations.find(entry => entry.options.name === 'sidebar.panellist').component
  const wrapper = icon({ size: 20, active: true })
  // Function components are expanded here so the assertion is about the drawn
  // SVG, not about which wrapper component happens to own the hook.
  const expand = (node) => (typeof node?.type === 'function' ? expand(node.type(node.props)) : node)
  const tree = expand(wrapper)
  assert.equal(tree.type, 'svg')
  const nodes = walk(tree)
  nodes.forEach(node => {
    assert.ok(!['style', 'script', 'image', 'foreignObject'].includes(node?.type), `${String(node?.type)} is not allowed in an icon`)
  })
  assert.ok(nodes.filter(node => node?.type === 'rect').length >= 2, 'two chat bubbles are drawn')
  assert.equal(nodes[0].props.stroke, 'currentColor', 'the glyph follows the theme text colour')
  assert.ok(nodes.every(node => node?.props?.fill === undefined || node.props.fill === 'none' || node.props.fill === 'currentColor'),
    'no hardcoded fill colours in the icon')
})

await check('the sidebar icon carries the pending-proposal count', async () => {
  controller.set({
    assignments: [
      { id: 'a1', botId: 'scout', botName: 'Scout', task: 'one', status: 'proposed' },
      { id: 'a2', botId: 'forge', botName: 'Forge', task: 'two', status: 'proposed' },
      { id: 'a3', botId: 'ledger', botName: 'Ledger', task: 'three', status: 'done' },
    ],
  })
  const icon = registrations.find(entry => entry.options.name === 'sidebar.panellist').component
  const wrapper = icon({ size: 20, active: false })
  const nodes = walk(wrapper.type(wrapper.props))
  const badge = nodes.find(node => node?.props?.className === 'bt-icon-badge')
  assert.ok(badge, 'a pending proposal should badge the sidebar entry')
  assert.equal(badge.props.children, '2')
  controller.set({ assignments: [] })
})

await check('the panel lists proposals and dispatches on a click', async () => {
  const chief = { id: 'chief', name: 'Chief', emoji: '🎖️', role: 'Chief of staff', color: '#6d7c95', persona: 'Dispatch.', folder: path.join(dataDir, 'bots/chief'), sessionId: 'sess-chief', chief: true }
  controller.set({
    bots: [chief, ...controller.getSnapshot().bots.filter(bot => bot.id !== 'chief')],
    selectedId: 'chief',
    assignments: [{ id: 'p1', botId: 'scout', botName: 'Scout', task: '核对表 2 的数字。', status: 'proposed', source: 'chief' }],
  })
  const nodes = render()
  assert.ok(nodes.includes('Proposals from the chief'), 'the queue renders its title')
  assert.ok(nodes.some(node => node?.props?.className === 'bt-proposal-task' && node.props.children === '核对表 2 的数字。'))
  const badge = nodes.find(node => node?.props?.className === 'bt-chief-badge')
  assert.equal(badge.props.children, 'Chief of staff', 'the chief is marked in the roster')
  const dispatchButton = nodes.find(node => node?.props?.className === 'bt-primary' && node.props.children === 'Dispatch')
  assert.ok(dispatchButton, 'a proposal offers dispatch')

  const posts = []
  globalThis.fetch = async (url, init) => {
    posts.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assignment: { id: 'p1', status: 'sent' },
        state: {
          bots: controller.getSnapshot().bots,
          assignments: [{ id: 'p1', botId: 'scout', botName: 'Scout', task: '核对表 2 的数字。', status: 'sent' }],
        },
      }),
    }
  }
  await controller.dispatchProposal('p1')
  assert.deepEqual(posts[0], { op: 'dispatch', assignmentId: 'p1' })
  assert.equal(controller.getSnapshot().assignments[0].status, 'sent')
  assert.match(controller.getSnapshot().toast, /Scout/u)
  const after = render()
  assert.equal(after.filter(node => node?.props?.className === 'bt-proposals').length, 0, 'the queue clears once sent')
})

await check('the panel can assign directly from a bot, creating its session first', async () => {
  const virgin = { id: 'virgin', name: 'Virgo', emoji: '🛰️', role: 'Spotter', color: '#5b8def', persona: 'Watch.', folder: path.join(dataDir, 'bots/virgin'), sessionId: null }
  controller.set({ bots: [...controller.getSnapshot().bots, virgin], selectedId: 'virgin', assignOpen: true })
  const posts = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    posts.push(body)
    if (body.op === 'bind') {
      assert.equal(body.sessionId, 'sess-virgin')
      return { ok: true, status: 200, json: async () => ({ ok: true, bot: { ...virgin, sessionId: 'sess-virgin' }, state: { bots: controller.getSnapshot().bots } }) }
    }
    assert.equal(body.op, 'assign')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assignment: { id: 'p2', status: 'sent' },
        state: { bots: controller.getSnapshot().bots, assignments: [{ id: 'p2', botId: 'virgin', botName: 'Virgo', task: '看着。', status: 'sent' }] },
      }),
    }
  }
  controller.ctx.sessions.create = async (options) => {
    createdWith = options
    return 'sess-virgin'
  }
  await controller.assignNow('看着。')
  assert.deepEqual(posts.map(body => body.op), ['bind', 'assign'], 'the panel creates the session, then dispatches')
  assert.equal(controller.getSnapshot().assignOpen, false)
  assert.equal(controller.getSnapshot().assignDraft, '')
})

await rm(dataDir, { recursive: true, force: true })
await rm(configDir, { recursive: true, force: true })

console.log(results.join('\n'))
console.log(process.exitCode === 1 ? '\nsome checks failed' : `\nall ${results.length} checks passed`)

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
const hostCtx = {
  logger: { warn() {} },
  effect: (factory) => { const dispose = factory(); return dispose },
  webServer: { register: (route) => { routes.push(route); return () => {} } },
  tools: { register: (tool) => { tools.push(tool); return () => {} } },
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
const request = (pathname, init = {}) => host.dispatch({
  method: init.method ?? 'GET',
  pathname,
  header: (name) => init.headers?.[name],
  body: init.body ?? '',
}, store)
const post = (body, headers = { 'content-type': 'application/json' }) =>
  request('/bots-team/api/bots', { method: 'POST', headers, body: JSON.stringify(body) })

await check('registers one prefix route with a raw handler and four tools', async () => {
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/bots-team/api')
  assert.equal(typeof routes[0].handler, 'function', 'writes need a handler; a resource only sees GET and HEAD')
  assert.deepEqual(tools.map(tool => tool.name), ['team_roster', 'team_hire', 'team_brief', 'team_fire'])
  assert.doesNotThrow(() => JSON.stringify(tools[0].parameters))
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

await check('seeds a team on first run', async () => {
  const { status, body } = await request('/bots-team/api/state')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.state.bots.map(bot => bot.id), ['scout', 'forge', 'ledger'])
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
  assert.equal(roster.bots.length, 3)
  assert.equal(typeof roster.bots[0].folder, 'string')
  const hired = await tools[1].execute({ name: 'Echo', persona: 'You repeat back what matters.', role: 'Challenger' }, {})
  assert.equal(hired.bot.name, 'Echo')
  const briefed = await tools[2].execute({ botId: hired.bot.id, role: 'Skeptic' }, {})
  assert.equal(briefed.bot.role, 'Skeptic')
  const fired = await tools[3].execute({ botId: hired.bot.id }, {})
  assert.equal(fired.removed.id, hired.bot.id)
})

await check('survives a corrupt roster file', async () => {
  const broken = await mkdtemp(path.join(os.tmpdir(), 'bots-team-broken-'))
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(broken, 'team.json'), '{not json', 'utf8')
  const repaired = new host.TeamStore(broken, () => {})
  const state = await repaired.load()
  assert.equal(state.bots.length, 3, 'a corrupt file is replaced by the starter team')
  await rm(broken, { recursive: true, force: true })
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
  controller.ctx.sessions.retain = () => ({
    sessionId: 'sess-created',
    ready: Promise.resolve({
      session: { getSnapshot: () => ({}), subscribe: () => () => {} },
      eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
    }),
    release: () => { released += 1 },
  })
  controller.select('scout')
  await new Promise(resolve => setTimeout(resolve, 0))
  controller.dispose()
  assert.equal(released, 1)
})

await check('the sidebar icon draws without a background tile', async () => {
  const icon = registrations.find(entry => entry.options.name === 'sidebar.panellist').component
  const tree = icon({ size: 20, active: true })
  assert.equal(tree.type, 'svg')
  walk(tree).forEach(node => {
    assert.ok(!['style', 'script', 'image', 'foreignObject'].includes(node?.type), `${String(node?.type)} is not allowed in an icon`)
  })
})

await rm(dataDir, { recursive: true, force: true })
await rm(configDir, { recursive: true, force: true })

console.log(results.join('\n'))
console.log(process.exitCode === 1 ? '\nsome checks failed' : `\nall ${results.length} checks passed`)

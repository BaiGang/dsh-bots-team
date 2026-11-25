/**
 * DSH Bot Team, browser client: the `Team` entry in the left sidebar and the roster
 * panel it opens.
 *
 * The panel is a messaging surface over real DSH Sessions. Every bot owns one
 * Session in its own folder; the folder's `AGENTS.md` (written by the host
 * backend) is the bot's persona, so the personality arrives through DSH's own
 * workspace-instruction loader rather than a private prompt hack. Sending a
 * message here is `session.prompt()`, exactly what the composer does, so the
 * reply streams into this panel and into the bot's own conversation alike.
 *
 * @module dsh-bots-team/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-bots-team',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Id shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'bots-team'
    /** Locale namespace owned by this plugin. */
    const NS = 'botsTeam'
    /** Roster endpoint served by this plugin's host backend. */
    const API = 'bots-team/api'

    const EN = {
      panel: 'Team',
      title: 'Your bot team',
      subtitle: 'Each bot is a real session with its own folder and its own instructions.',
      newBot: 'New bot',
      edit: 'Edit',
      open: 'Open chat',
      openHint: 'Open this bot in the full conversation',
      delete: 'Delete bot',
      deleteConfirm: 'Remove this bot from the team? Its folder and files stay on disk.',
      cancel: 'Cancel',
      save: 'Save',
      create: 'Hire bot',
      name: 'Name',
      emoji: 'Emoji',
      role: 'Role',
      persona: 'Instructions',
      personaHint: 'Written to the bot folder as AGENTS.md. This is the bot personality every conversation starts from.',
      templates: 'Start from a role',
      emptyTitle: 'No bots yet',
      emptyBody: 'Hire your first bot, give it a job, and talk to it like a contact.',
      pickTitle: 'Pick a bot',
      pickBody: 'Choose someone from the roster to see the conversation.',
      startTitle: 'Say hello',
      startBody: 'This bot has not been started yet. Your first message creates its session and loads its instructions.',
      composer: 'Message {name}…',
      send: 'Send',
      working: 'Working…',
      idle: 'Idle',
      folder: 'Folder',
      session: 'Session',
      notStarted: 'Not started',
      loading: 'Loading the team…',
      failed: 'Could not load the team',
      retry: 'Retry',
      sendFailed: 'Message not sent',
      createFailed: 'Could not create the bot',
      offline: 'The roster endpoint did not answer. The Team panel needs the Host plugin; reload after it is enabled.',
      you: 'You',
      bot: 'Bot',
      removeAction: 'Remove from team',
      emptyChat: 'No messages yet.',
      chiefBadge: 'Chief of staff',
      proposals: 'Proposals from the chief',
      proposalsHint: 'Nothing is sent until you dispatch it.',
      dispatch: 'Dispatch',
      dismiss: 'Dismiss',
      assign: 'Assign a task',
      assignHint: 'This arrives as a message in {name}\'s own conversation.',
      assignPlaceholder: 'What should {name} do, and what does done look like?',
      dispatched: 'Dispatched to {name}',
      dismissed: 'Proposal dismissed',
      unattendedOn: 'Unattended',
      pendingMany: '{n} proposals to confirm',
      pendingOne: '1 proposal to confirm',
    }

    const ZH = {
      panel: '团队',
      title: '你的机器人团队',
      subtitle: '每个机器人都是一个真实会话，拥有自己的文件夹和自己的指令。',
      newBot: '新建机器人',
      edit: '编辑',
      open: '打开完整对话',
      openHint: '在完整会话界面中打开这个机器人',
      delete: '删除机器人',
      deleteConfirm: '从团队中移除这个机器人？它的文件夹和文件会保留在磁盘上。',
      cancel: '取消',
      save: '保存',
      create: '雇佣机器人',
      name: '名字',
      emoji: '图标',
      role: '角色',
      persona: '工作指令',
      personaHint: '会写入机器人文件夹的 AGENTS.md，作为每次对话的出发点。',
      templates: '从角色模板开始',
      emptyTitle: '还没有机器人',
      emptyBody: '雇佣第一个机器人，给它一份工作，然后像联系人一样和它对话。',
      pickTitle: '选择一个机器人',
      pickBody: '从左侧名单里选一个人，查看你们的对话。',
      startTitle: '打个招呼',
      startBody: '这个机器人还没启动。你发出的第一条消息会创建它的会话并载入它的指令。',
      composer: '给 {name} 发消息…',
      send: '发送',
      working: '工作中…',
      idle: '空闲',
      folder: '文件夹',
      session: '会话',
      notStarted: '未启动',
      loading: '正在载入团队…',
      failed: '团队加载失败',
      retry: '重试',
      sendFailed: '消息未发送',
      createFailed: '机器人创建失败',
      offline: '团队名册接口没有响应。这个面板需要 Host 插件，启用后请刷新页面。',
      you: '你',
      bot: '机器人',
      removeAction: '移出团队',
      emptyChat: '还没有消息。',
      chiefBadge: '参谋长',
      proposals: '参谋长的派单建议',
      proposalsHint: '你点派发之前，什么都不会发出去。',
      dispatch: '派发',
      dismiss: '取消',
      assign: '派单',
      assignHint: '这条任务会作为消息进入 {name} 自己的会话。',
      assignPlaceholder: '{name} 要做什么？什么样算做完？',
      dispatched: '已派发给 {name}',
      dismissed: '已取消该建议',
      unattendedOn: '无人值守',
      pendingMany: '{n} 条待确认',
      pendingOne: '1 条待确认',
    }

    /**
     * Reach the roster endpoint, resolving it against the page's own base so a
     * mounted deployment keeps working.
     * @param {string} route - path below the plugin's API prefix.
     * @param {object} [init] - fetch options.
     * @returns {Promise<object>} parsed envelope.
     */
    async function call(route, init) {
      const base = typeof document === 'undefined' ? undefined : document.baseURI
      const url = new URL(`${API}${route}`, base ?? 'http://localhost/')
      const response = await fetch(url, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || body === undefined || body.ok === false) {
        throw new Error(body?.error ?? `HTTP ${response.status}`)
      }
      return body
    }

    /**
     * Read the text of one message payload without assuming one nesting.
     * @param {unknown} data - session event data.
     * @returns {{text: string, tools: string[]}} visible text and tool names.
     */
    function readMessage(data) {
      const message = data?.message ?? data ?? {}
      const blocks = Array.isArray(message.content) ? message.content : []
      const texts = []
      const tools = []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
        else if (typeof block.type === 'string' && block.type.startsWith('tool') && typeof block.name === 'string') tools.push(block.name)
      }
      return { text: texts.join('\n').trim(), tools }
    }

    /**
     * Fold a session's event window into the rows this panel renders.
     * @param {object} window - `SessionEventWindow`.
     * @returns {Array<{key: string, role: string, text: string, tools: string[]}>} transcript rows.
     */
    function readTranscript(window) {
      const rows = []
      const entries = Array.isArray(window?.entries) ? window.entries : []
      for (const entry of entries) {
        if (entry?.type !== 'event') continue
        const event = entry.event
        const type = event?.type
        if (type !== 'user/message' && type !== 'assistant/message') continue
        const { text, tools } = readMessage(event.data)
        if (text === '' && tools.length === 0) continue
        rows.push({
          key: `${event.seq ?? rows.length}-${type}`,
          role: type === 'user/message' ? 'user' : 'assistant',
          text,
          tools,
        })
      }
      return rows.slice(-200)
    }

    /** One panel's view state, shared by the roster and the chat. */
    class TeamController {
      /**
       * @param {object} ctx - Client context.
       * @param {(key: string, vars?: object) => string} t - locale translator.
       */
      constructor(ctx, t) {
        this.ctx = ctx
        this.t = t
        this.listeners = new Set()
        this.snapshot = {
          phase: 'loading',
          error: '',
          bots: [],
          templates: [],
          selectedId: undefined,
          draft: '',
          notice: '',
          rows: [],
          running: false,
          starting: false,
          editing: undefined,
          assignments: [],
          chiefId: undefined,
          unattended: false,
          assignOpen: false,
          assignDraft: '',
          toast: '',
        }
        this.conversation = undefined
        this.disposed = false
        this.toastTimer = undefined
      }

      subscribe = (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
      }

      getSnapshot = () => this.snapshot

      /**
       * Publish a partial update.
       * @param {object} patch - changed fields.
       */
      set(patch) {
        if (this.disposed) return
        this.snapshot = { ...this.snapshot, ...patch }
        for (const listener of [...this.listeners]) {
          try {
            listener()
          } catch (error) {
            console.error('[bots-team] listener failed', error)
          }
        }
      }

      /** Load the roster from the host backend. */
      async load() {
        this.set({ phase: 'loading', error: '' })
        try {
          const body = await call('/state')
          const state = body.state ?? {}
          const bots = Array.isArray(state.bots) ? state.bots : []
          this.set({
            phase: 'ready',
            bots,
            templates: Array.isArray(state.templates) ? state.templates : [],
            dataDir: state.dataDir ?? '',
            assignments: Array.isArray(state.assignments) ? state.assignments : [],
            chiefId: typeof state.chiefId === 'string' ? state.chiefId : bots.find(bot => bot.chief === true)?.id,
            unattended: state.unattended === true,
            selectedId: this.snapshot.selectedId ?? bots[0]?.id,
          })
          this.select(this.snapshot.selectedId ?? bots[0]?.id)
        } catch (error) {
          this.set({
            phase: 'error',
            error: `${this.t('failed')}: ${String(error?.message ?? error)}. ${this.t('offline')}`,
          })
        }
      }

      /** Find one bot in the current roster. */
      bot(id) {
        return this.snapshot.bots.find(candidate => candidate.id === id)
      }

      /**
       * Re-read the roster without disturbing the open conversation, so a bot
       * hired from another window or by an agent shows up here.
       */
      async refresh() {
        try {
          const body = await call('/state')
          const state = body.state
          const bots = state?.bots
          if (Array.isArray(bots)) {
            const assignments = Array.isArray(state.assignments) ? state.assignments : this.snapshot.assignments
            // A dispatch that settled since the last poll is worth saying out loud.
            const finished = assignments.find(record => record.status === 'done'
              && this.snapshot.assignments.some(previous => previous.id === record.id && previous.status !== 'done'))
            this.set({
              bots,
              templates: state.templates ?? this.snapshot.templates,
              assignments,
              unattended: state.unattended === true,
            })
            if (finished !== undefined) this.notify(this.t('dispatched').replace('{name}', finished.botName))
          }
        } catch {
          // A transient failure keeps the roster already on screen.
        }
      }

      /** Proposals waiting for a human click. */
      pending() {
        return this.snapshot.assignments.filter(record => record.status === 'proposed')
      }

      /**
       * Show one short message, then clear it.
       * @param text - text to show.
       */
      notify(text) {
        if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
        this.set({ toast: text })
        this.toastTimer = setTimeout(() => this.set({ toast: '' }), 4000)
      }

      /**
       * Deliver one proposal into its bot's Session. This click is the
       * confirmation the agent-side tool never has.
       * @param id - assignment identity.
       */
      async dispatchProposal(id) {
        const record = this.snapshot.assignments.find(candidate => candidate.id === id)
        try {
          if (record !== undefined) await this.ensureSession(this.bot(record.botId))
          const body = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'dispatch', assignmentId: id }) })
          this.set({ assignments: body.state?.assignments ?? this.snapshot.assignments, bots: body.state?.bots ?? this.snapshot.bots, notice: '' })
          if (body.assignment?.status === 'failed') {
            this.set({ notice: `${this.t('dispatch')}: ${String(body.assignment.error ?? '')}` })
            return
          }
          this.notify(this.t('dispatched').replace('{name}', record?.botName ?? ''))
        } catch (error) {
          this.set({ notice: `${this.t('dispatch')}: ${String(error?.message ?? error)}` })
        }
      }

      /**
       * Drop one proposal without sending it.
       * @param id - assignment identity.
       */
      async dismissProposal(id) {
        try {
          const body = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'cancel', assignmentId: id }) })
          this.set({ assignments: body.state?.assignments ?? this.snapshot.assignments, notice: '' })
          this.notify(this.t('dismissed'))
        } catch (error) {
          this.set({ notice: `${this.t('dismiss')}: ${String(error?.message ?? error)}` })
        }
      }

      /**
       * Give a bot a Session, creating and binding one when it has none. A bot
       * cannot receive work before its first conversation exists.
       * @param bot - roster record.
       * @returns The bot with a session id, or undefined when creation failed.
       */
      async ensureSession(bot) {
        if (bot === undefined) return undefined
        if (typeof bot.sessionId === 'string' && bot.sessionId !== '') return bot
        const sessionId = await this.ctx.sessions.create({ cwd: bot.folder })
        const body = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'bind', botId: bot.id, sessionId }) })
        const bots = this.snapshot.bots.map(candidate => (candidate.id === bot.id ? body.bot : candidate))
        this.set({ bots })
        return body.bot
      }

      /** Open or close the panel's own assignment composer. */
      toggleAssign() {
        this.set({ assignOpen: !this.snapshot.assignOpen, assignDraft: '' })
      }

      /** Track the panel's assignment draft. */
      setAssignDraft(text) {
        this.set({ assignDraft: text })
      }

      /**
       * Send a task from the panel directly to the selected bot. The click is
       * the confirmation, so this bypasses the proposal queue.
       * @param text - task body.
       */
      async assignNow(text) {
        const body = text.trim()
        const bot = this.bot(this.snapshot.selectedId)
        if (body === '' || bot === undefined) return
        this.set({ assigning: true, notice: '' })
        try {
          await this.ensureSession(bot)
          const result = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'assign', botId: bot.id, task: body }) })
          this.set({
            assigning: false,
            assignOpen: false,
            assignDraft: '',
            bots: result.state?.bots ?? this.snapshot.bots,
            assignments: result.state?.assignments ?? this.snapshot.assignments,
          })
          this.notify(this.t('dispatched').replace('{name}', bot.name))
          if (result.assignment?.status === 'failed') {
            this.set({ notice: `${this.t('assign')}: ${String(result.assignment.error ?? '')}` })
          }
        } catch (error) {
          this.set({ assigning: false, notice: `${this.t('assign')}: ${String(error?.message ?? error)}` })
        }
      }

      /** Keep the composer draft for the bot the person is looking at. */
      drafts = new Map()

      /**
       * Select a bot and open its conversation, closing the previous one.
       * @param {string | undefined} id - bot identity.
       */
      select(id) {
        if (id === undefined) return
        const previous = this.snapshot.selectedId
        if (previous !== undefined) this.drafts.set(previous, this.snapshot.draft)
        this.closeConversation()
        const bot = this.bot(id)
        this.set({
          selectedId: id,
          draft: this.drafts.get(id) ?? '',
          notice: '',
          rows: [],
          running: false,
        })
        if (bot === undefined || typeof bot.sessionId !== 'string' || bot.sessionId === '') return
        this.openConversation(bot)
      }

      /** Release the retained session and its subscriptions. */
      closeConversation() {
        const current = this.conversation
        this.conversation = undefined
        if (current === undefined) return
        try { current.offEvents?.() } catch {}
        try { current.offSession?.() } catch {}
        try { current.reference?.release() } catch {}
      }

      /**
       * Retain one bot session and mirror its events and lifecycle into state.
       * @param {object} bot - roster record carrying `sessionId`.
       */
      async openConversation(bot) {
        let reference
        try {
          reference = this.ctx.sessions.retain(bot.sessionId, { source: 'botsTeam' })
        } catch (error) {
          this.set({ notice: String(error?.message ?? error) })
          return
        }
        const conversation = { reference }
        this.conversation = conversation
        const publish = () => {
          if (this.conversation !== conversation) return
          const session = conversation.session
          if (session === undefined) return
          let snapshot
          try { snapshot = session.getSnapshot() } catch { snapshot = undefined }
          const window = conversation.eventSource?.getSnapshot?.()
          this.set({
            rows: readTranscript(window),
            running: snapshot?.running === true || snapshot?.status === 'running' || snapshot?.engaging === true,
          })
        }
        try {
          const binding = await reference.ready
          if (this.conversation !== conversation || this.disposed) {
            reference.release()
            return
          }
          conversation.session = binding.session
          conversation.eventSource = binding.eventSource
          conversation.offSession = binding.session.subscribe(publish)
          conversation.offEvents = binding.eventSource.subscribe(publish)
          publish()
        } catch (error) {
          if (this.conversation === conversation) {
            this.set({ notice: String(error?.message ?? error) })
            this.closeConversation()
          }
        }
      }

      /** Keep typing out of React state churn beyond the draft itself. */
      setDraft(text) {
        const id = this.snapshot.selectedId
        if (id !== undefined) this.drafts.set(id, text)
        this.set({ draft: text })
      }

      /**
       * Send one message to the selected bot, creating its session on the first
       * message so that a bot's instructions are loaded before it speaks.
       * @param {string} text - message body.
       */
      async send(text) {
        const body = text.trim()
        const bot = this.bot(this.snapshot.selectedId)
        if (body === '' || bot === undefined) return
        this.set({ draft: '', notice: '', starting: true })
        this.drafts.set(bot.id, '')
        try {
          if (typeof bot.sessionId !== 'string' || bot.sessionId === '') {
            const sessionId = await this.ctx.sessions.create({ cwd: bot.folder })
            const bound = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'bind', botId: bot.id, sessionId }) })
            const bots = this.snapshot.bots.map(candidate => (candidate.id === bot.id ? bound.bot : candidate))
            this.set({ bots })
            await this.openConversation(bound.bot)
            const ready = this.conversation
            if (ready !== undefined) await ready.reference.ready
          }
          const conversation = this.conversation
          if (conversation?.session === undefined) throw new Error('the bot session is not ready')
          const result = await conversation.session.prompt([{ type: 'text', text: body }], 'queue')
          if (result !== undefined && result.ok === false) {
            throw new Error(result.error?.message ?? this.t('sendFailed'))
          }
          this.set({ starting: false, running: true })
        } catch (error) {
          this.set({ starting: false, notice: `${this.t('sendFailed')}: ${String(error?.message ?? error)}`, draft: body })
        }
      }

      /**
       * Create or update a bot, then refresh the roster.
       * @param {object} input - bot fields.
       * @param {string | undefined} botId - update target; omit to hire.
       */
      async saveBot(input, botId) {
        try {
          const op = botId === undefined ? 'create' : 'update'
          const payload = botId === undefined
            ? { op, bot: input }
            : { op, botId, patch: input }
          const body = await call('/bots', { method: 'POST', body: JSON.stringify(payload) })
          const bots = body.state?.bots ?? this.snapshot.bots
          this.set({ bots, editing: undefined, notice: '' })
          this.select(body.bot?.id ?? botId)
          return true
        } catch (error) {
          this.set({ notice: `${this.t('createFailed')}: ${String(error?.message ?? error)}` })
          return false
        }
      }

      /**
       * Remove one bot from the roster.
       * @param {string} botId - bot identity.
       */
      async deleteBot(botId) {
        try {
          const body = await call('/bots', { method: 'POST', body: JSON.stringify({ op: 'delete', botId }) })
          const bots = body.state?.bots ?? []
          const selected = this.snapshot.selectedId === botId ? bots[0]?.id : this.snapshot.selectedId
          this.closeConversation()
          this.set({ bots, editing: undefined, selectedId: undefined, rows: [], running: false })
          this.select(selected ?? bots[0]?.id)
        } catch (error) {
          this.set({ notice: String(error?.message ?? error) })
        }
      }

      /** Open the bot editor for an existing bot. */
      edit(id) {
        this.set({ editing: id })
      }

      /** Open the editor for a new bot, optionally from a template. */
      create(templateId) {
        this.set({ editing: templateId === undefined ? '' : `template:${templateId}` })
      }

      /** Close the editor. */
      cancelEdit() {
        this.set({ editing: undefined })
      }

      /** Open the bot's own conversation in the main column. */
      openFull(bot) {
        if (typeof bot?.sessionId !== 'string' || bot.sessionId === '') {
          this.set({ notice: this.t('notStarted') })
          return
        }
        try {
          this.ctx.uiWorkspace.openSession(bot.sessionId)
        } catch (error) {
          this.set({ notice: String(error?.message ?? error) })
        }
      }

      /** Stop every owned subscription and reference. */
      dispose() {
        this.disposed = true
        if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
        this.closeConversation()
        this.listeners.clear()
      }
    }

    /**
     * Avatar tile: the bot's emoji on a tinted rounded square.
     * @param {{bot: object, size?: number}} props - bot and edge length.
     */
    function Avatar({ bot, size = 32 }) {
      return h('span', {
        className: 'bt-avatar',
        style: {
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${Math.round(size * 0.52)}px`,
          background: `${bot.color}22`,
          borderColor: `${bot.color}55`,
          borderRadius: `${Math.round(size * 0.3)}px`,
        },
        'aria-hidden': true,
      }, bot.emoji)
    }

    /**
     * Status pill for one bot: running, idle, or not started.
     * @param {{bot: object, running: boolean, t: Function}} props - bot and live state.
     */
    function Status({ bot, running, t }) {
      if (typeof bot.sessionId !== 'string' || bot.sessionId === '') {
        return h('span', { className: 'bt-status bt-status-idle' }, t('notStarted'))
      }
      return h('span', { className: running ? 'bt-status bt-status-busy' : 'bt-status bt-status-idle' },
        h('span', { className: 'bt-dot', 'aria-hidden': true }),
        running ? t('working') : t('idle'))
    }

    /** The bot editor dialog. */
    function Editor({ controller, snapshot, onClose }) {
      const t = controller.t
      const editing = snapshot.editing
      const isTemplate = typeof editing === 'string' && editing.startsWith('template:')
      const existingId = isTemplate ? undefined : (snapshot.editing === '' ? undefined : snapshot.editing)
      const existing = existingId === undefined ? undefined : controller.bot(existingId)
      const template = isTemplate
        ? snapshot.templates.find(candidate => candidate.id === editing.slice('template:'.length))
        : undefined
      const seed = existing ?? template ?? {}
      const [form, setForm] = React.useState({
        name: seed.name ?? '',
        emoji: seed.emoji ?? '🤖',
        role: seed.role ?? '',
        persona: seed.persona ?? '',
      })
      const [busy, setBusy] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const field = key => event => setForm(current => ({ ...current, [key]: event.target.value }))
      const submit = async () => {
        if (form.name.trim() === '' || busy) return
        setBusy(true)
        const saved = await controller.saveBot(form, existing?.id)
        setBusy(false)
        if (saved) onClose()
      }
      const remove = async () => {
        if (existing === undefined) return
        setBusy(true)
        await controller.deleteBot(existing.id)
        setBusy(false)
        onClose()
      }
      const templates = existing === undefined ? (snapshot.templates ?? []) : []
      return h('div', { className: 'bt-mask', role: 'dialog', 'aria-modal': 'true', 'aria-label': existing ? t('edit') : t('newBot') },
        h('div', { className: 'bt-dialog' },
          h('div', { className: 'bt-dialog-head' },
            h('h2', undefined, existing ? t('edit') : t('newBot')),
            h('button', { className: 'bt-icon-btn', onClick: onClose, 'aria-label': t('cancel'), type: 'button' }, '✕')),
          templates.length > 0
            ? h('div', { className: 'bt-templates' },
                h('span', { className: 'bt-label' }, t('templates')),
                h('div', { className: 'bt-chips' }, templates.map(candidate =>
                  h('button', {
                    key: candidate.id,
                    type: 'button',
                    className: 'bt-chip',
                    onClick: () => setForm({ name: candidate.name, emoji: candidate.emoji, role: candidate.role, persona: candidate.persona }),
                  }, h('span', { 'aria-hidden': true }, candidate.emoji), ` ${candidate.name}`))))
            : null,
          h('label', { className: 'bt-field' },
            h('span', { className: 'bt-label' }, t('name')),
            h('input', { className: 'bt-input', value: form.name, onChange: field('name'), maxLength: 60, autoFocus: true })),
          h('label', { className: 'bt-field bt-field-row' },
            h('span', { className: 'bt-label' }, t('emoji')),
            h('input', { className: 'bt-input bt-input-emoji', value: form.emoji, onChange: field('emoji'), maxLength: 8 })),
          h('label', { className: 'bt-field' },
            h('span', { className: 'bt-label' }, t('role')),
            h('input', { className: 'bt-input', value: form.role, onChange: field('role'), maxLength: 60 })),
          h('label', { className: 'bt-field' },
            h('span', { className: 'bt-label' }, t('persona')),
            h('textarea', { className: 'bt-textarea', value: form.persona, onChange: field('persona'), rows: 6 }),
            h('span', { className: 'bt-hint' }, t('personaHint'))),
          snapshot.notice !== '' ? h('p', { className: 'bt-error' }, snapshot.notice) : null,
          h('div', { className: 'bt-dialog-actions' },
            existing !== undefined
              ? h('button', {
                  className: 'bt-danger',
                  type: 'button',
                  disabled: busy,
                  onClick: () => (confirming ? remove() : setConfirming(true)),
                }, confirming ? t('deleteConfirm') : t('removeAction'))
              : null,
            h('span', { className: 'bt-spacer' }),
            h('button', { className: 'bt-btn', type: 'button', onClick: onClose, disabled: busy }, t('cancel')),
            h('button', { className: 'bt-primary', type: 'button', onClick: submit, disabled: busy || form.name.trim() === '' },
              existing ? t('save') : t('create')))))
    }

    /** The roster row for one bot. */
    function RosterRow({ bot, active, running, onSelect, t }) {
      return h('button', {
        type: 'button',
        className: active ? 'bt-row bt-row-active' : 'bt-row',
        onClick: onSelect,
        'aria-current': active ? 'true' : undefined,
      },
      h(Avatar, { bot, size: 28 }),
      h('span', { className: 'bt-row-text' },
        h('span', { className: 'bt-row-name' },
          bot.name,
          bot.chief === true ? h('span', { className: 'bt-chief-badge' }, t('chiefBadge')) : null),
        h('span', { className: 'bt-row-role' }, bot.role === '' ? '—' : bot.role)),
      running
        ? h('span', { className: 'bt-dot bt-dot-live', 'aria-label': 'working' })
        : null)
    }

    /**
     * The chief's pending assignments. Nothing here has been sent yet; each row
     * is the human confirmation gate.
     */
    function Proposals({ controller, snapshot }) {
      const t = controller.t
      const pending = snapshot.assignments.filter(record => record.status === 'proposed')
      if (pending.length === 0) return null
      return h('section', { className: 'bt-proposals', 'aria-label': t('proposals') },
        h('div', { className: 'bt-proposals-head' },
          h('span', { className: 'bt-proposals-title' },
            t('proposals'),
            h('span', { className: 'bt-count' }, String(pending.length))),
          h('span', { className: 'bt-proposals-hint' }, t('proposalsHint'))),
        pending.map(record => h('div', { key: record.id, className: 'bt-proposal' },
          h('div', { className: 'bt-proposal-text' },
            h('span', { className: 'bt-proposal-to' }, record.botName),
            h('span', { className: 'bt-proposal-task' }, record.task)),
          h('div', { className: 'bt-proposal-actions' },
            h('button', {
              type: 'button',
              className: 'bt-primary',
              onClick: () => { void controller.dispatchProposal(record.id) },
            }, t('dispatch')),
            h('button', {
              type: 'button',
              className: 'bt-btn',
              onClick: () => { void controller.dismissProposal(record.id) },
            }, t('dismiss'))))))
    }

    /** Transcript row. */
    function Bubble({ row, t }) {
      const mine = row.role === 'user'
      return h('div', { className: mine ? 'bt-msg bt-msg-user' : 'bt-msg' },
        h('div', { className: 'bt-bubble' },
          row.text === '' ? null : h('div', { className: 'bt-text' }, row.text),
          row.tools.length === 0 ? null : h('div', { className: 'bt-tools' },
            row.tools.map((tool, index) => h('span', { key: `${tool}-${index}`, className: 'bt-tool' }, tool)))))
    }

    /** The chat column for the selected bot. */
    function Chat({ controller, snapshot }) {
      const t = controller.t
      const bot = controller.bot(snapshot.selectedId)
      const listRef = React.useRef(null)
      React.useEffect(() => {
        const node = listRef.current
        if (node === null) return
        node.scrollTop = node.scrollHeight
      }, [snapshot.rows.length, snapshot.selectedId, snapshot.running])
      if (bot === undefined) {
        return h('div', { className: 'bt-blank' },
          h('h2', undefined, t('pickTitle')),
          h('p', undefined, t('pickBody')))
      }
      const started = typeof bot.sessionId === 'string' && bot.sessionId !== ''
      const send = () => { void controller.send(snapshot.draft) }
      const keydown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
          event.preventDefault()
          send()
        }
      }
      return h(React.Fragment, undefined,
        h('header', { className: 'bt-chat-head' },
          h(Avatar, { bot, size: 40 }),
          h('div', { className: 'bt-chat-title' },
            h('div', { className: 'bt-chat-name' }, bot.name),
            h('div', { className: 'bt-chat-role' }, bot.role === '' ? bot.folder : `${bot.role} · ${bot.folder}`)),
          h(Status, { bot, running: snapshot.running, t }),
          h('button', {
            className: snapshot.assignOpen ? 'bt-btn bt-btn-on' : 'bt-btn',
            type: 'button',
            onClick: () => controller.toggleAssign(),
          }, t('assign')),
          h('button', { className: 'bt-btn', type: 'button', onClick: () => controller.edit(bot.id) }, t('edit')),
          h('button', {
            className: 'bt-btn',
            type: 'button',
            disabled: !started,
            title: t('openHint'),
            onClick: () => controller.openFull(bot),
          }, t('open'))),
        snapshot.assignOpen
          ? h('div', { className: 'bt-assign' },
              h('div', { className: 'bt-assign-hint' }, t('assignHint').replace('{name}', bot.name)),
              h('textarea', {
                className: 'bt-textarea bt-assign-input',
                rows: 3,
                value: snapshot.assignDraft,
                placeholder: t('assignPlaceholder').replace('{name}', bot.name),
                onChange: event => controller.setAssignDraft(event.target.value),
              }),
              h('div', { className: 'bt-assign-actions' },
                h('button', {
                  className: 'bt-primary',
                  type: 'button',
                  disabled: snapshot.assigning || snapshot.assignDraft.trim() === '',
                  onClick: () => { void controller.assignNow(snapshot.assignDraft) },
                }, snapshot.assigning ? '…' : t('dispatch')),
                h('button', { className: 'bt-btn', type: 'button', onClick: () => controller.toggleAssign() }, t('dismiss'))))
          : null,
        snapshot.notice !== '' ? h('div', { className: 'bt-banner' }, snapshot.notice) : null,
        h('div', { className: 'bt-log', ref: listRef },
          started
            ? (snapshot.rows.length === 0
                ? h('p', { className: 'bt-log-empty' }, t('emptyChat'))
                : snapshot.rows.map(row => h(Bubble, { key: row.key, row, t })))
            : h('div', { className: 'bt-start' },
                h(Avatar, { bot, size: 56 }),
                h('h2', undefined, t('startTitle')),
                h('p', undefined, t('startBody')),
                bot.persona === '' ? null : h('p', { className: 'bt-persona' }, bot.persona)),
          snapshot.running ? h('div', { className: 'bt-typing' }, h('span', { className: 'bt-dot bt-dot-live' }), t('working')) : null),
        h('div', { className: 'bt-composer' },
          h('textarea', {
            className: 'bt-textarea bt-composer-input',
            value: snapshot.draft,
            rows: 2,
            placeholder: t('composer').replace('{name}', bot.name),
            onChange: event => controller.setDraft(event.target.value),
            onKeyDown: keydown,
          }),
          h('button', {
            className: 'bt-primary',
            type: 'button',
            onClick: send,
            disabled: snapshot.draft.trim() === '' || snapshot.starting,
          }, snapshot.starting ? '…' : t('send'))))
    }

    /** The panel body. */
    function TeamPanel(props) {
      const controller = props.controller
      const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
      const t = controller.t
      React.useEffect(() => { void controller.load() }, [controller])
      // Keep the roster current while it is on screen; a background change
      // (another window, or an agent using team_hire) then appears here too.
      React.useEffect(() => {
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') void controller.refresh()
        }, 15000)
        return () => clearInterval(timer)
      }, [controller])
      if (snapshot.phase === 'loading') {
        return h('div', { className: 'bt-root bt-center' }, h('style', undefined, CSS), h('p', undefined, t('loading')))
      }
      if (snapshot.phase === 'error') {
        return h('div', { className: 'bt-root bt-center' },
          h('style', undefined, CSS),
          h('h2', undefined, t('failed')),
          h('p', { className: 'bt-error' }, snapshot.error),
          h('button', {
            className: 'bt-primary',
            type: 'button',
            onClick: () => { void controller.load() },
          }, t('retry')))
      }
      return h('div', { className: 'bt-root' },
        h('style', undefined, CSS),
        h('header', { className: 'bt-head' },
          h('div', undefined,
            h('h1', undefined, t('title')),
            h('p', undefined, t('subtitle'))),
          h('div', { className: 'bt-head-actions' },
            snapshot.unattended
              ? h('span', { className: 'bt-mode', title: t('unattendedOn') }, t('unattendedOn'))
              : null,
            h('button', { className: 'bt-primary', type: 'button', onClick: () => controller.create() }, t('newBot')))),
        h('div', { className: 'bt-body' },
          h('aside', { className: 'bt-roster', 'aria-label': t('title') },
            snapshot.bots.length === 0
              ? h('div', { className: 'bt-roster-empty' },
                  h('p', { className: 'bt-row-name' }, t('emptyTitle')),
                  h('p', { className: 'bt-row-role' }, t('emptyBody')))
              : snapshot.bots.map(bot => h(RosterRow, {
                  key: bot.id,
                  bot,
                  active: bot.id === snapshot.selectedId,
                  running: bot.id === snapshot.selectedId && snapshot.running,
                  onSelect: () => controller.select(bot.id),
                  t,
                }))),
          h('section', { className: 'bt-chat' },
            h(Proposals, { controller, snapshot }),
            h(Chat, { controller, snapshot }))),
        snapshot.toast === ''
          ? null
          : h('div', { className: 'bt-toast', role: 'status' }, snapshot.toast),
        snapshot.editing === undefined
          ? null
          : h(Editor, { controller, snapshot, onClose: () => controller.cancelEdit() }))
    }

    /** Sidebar glyph: two bot heads, the nearer one outlined. */
    function TeamIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      const active = props.active === true
      const controller = props.controller
      const snapshot = controller === undefined
        ? undefined
        : React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
      const pending = snapshot === undefined
        ? 0
        : snapshot.assignments.filter(record => record.status === 'proposed').length
      const glyph = h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: active ? 2 : 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      },
      h('rect', { x: 9.2, y: 2.6, width: 11.6, height: 9.4, rx: 3, opacity: 0.55 }),
      h('circle', { cx: 12.8, cy: 7.3, r: 0.95, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 17.2, cy: 7.3, r: 0.95, fill: 'currentColor', stroke: 'none' }),
      h('rect', { x: 3.2, y: 9.6, width: 13.6, height: 11, rx: 3.4 }),
      h('circle', { cx: 7.6, cy: 14.6, r: 1.15, fill: 'currentColor', stroke: 'none' }),
      h('circle', { cx: 12.4, cy: 14.6, r: 1.15, fill: 'currentColor', stroke: 'none' }),
      h('path', { d: 'M8 17.8h4.2' }))
      if (pending === 0) return glyph
      return h('span', { className: 'bt-icon-wrap' },
        glyph,
        h('span', { className: 'bt-icon-badge', 'aria-label': String(pending) }, pending > 9 ? '9+' : String(pending)))
    }

    /** Keeps a throwing panel from blanking the slot. */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: undefined }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error !== undefined) {
          return h('div', { className: 'bt-root bt-center' },
            h('style', undefined, CSS),
            h('h2', undefined, 'Team panel failed'),
            h('p', { className: 'bt-error' }, String(this.state.error?.message ?? this.state.error)))
        }
        return this.props.children
      }
    }

    const CSS = `
.bt-root {
  position: relative;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  color: var(--dsw-alias-label-primary);
  padding: var(--dsh-frame-top-clearance, 0px) 0 0 var(--dsh-frame-leading-clearance, 0px);
  box-sizing: border-box;
}
.bt-center { align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 40px; }
.bt-center h2 { font-size: 15px; font-weight: 600; margin: 0; }
.bt-center p { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 0; max-width: 460px; line-height: 1.6; }
.bt-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  padding: 18px 20px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.bt-head h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
.bt-head p { font-size: 12.5px; margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.bt-body { display: grid; grid-template-columns: 248px minmax(0, 1fr); flex: 1; min-height: 0; }
.bt-roster {
  border-right: 1px solid var(--dsw-alias-border-l1); overflow-y: auto; padding: 10px 8px;
  display: flex; flex-direction: column; gap: 2px;
}
.bt-roster-empty { padding: 14px 10px; display: flex; flex-direction: column; gap: 6px; }
.bt-row {
  display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 8px; border: 0;
  border-radius: 8px; background: transparent; cursor: pointer; text-align: left;
  color: inherit; font: inherit;
}
.bt-row:hover { background: var(--dsw-alias-bg-layer-2); }
.bt-row-active { background: var(--dsw-alias-bg-layer-2); }
.bt-row-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.bt-row-name { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bt-row-role { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bt-avatar {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  border: 1px solid var(--dsw-alias-border-l1); line-height: 1;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}
.bt-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); display: inline-block; flex: none; }
.bt-dot-live { background: var(--dsw-alias-brand-primary); animation: bt-pulse 1.15s ease-in-out infinite; }
@keyframes bt-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
.bt-chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.bt-chat-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.bt-chat-title { flex: 1; min-width: 0; }
.bt-chat-name { font-size: 14px; font-weight: 600; }
.bt-chat-role {
  font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.bt-status {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px;
  color: var(--dsw-alias-label-secondary); padding: 3px 8px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); flex: none;
}
.bt-status-busy { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.bt-log { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
.bt-log-empty { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 0; }
.bt-msg { display: flex; }
.bt-msg-user { justify-content: flex-end; }
.bt-bubble {
  max-width: min(620px, 82%); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 9px 12px;
}
.bt-msg-user .bt-bubble { background: var(--dsw-alias-bg-layer-1); }
.bt-text { font-size: 13px; line-height: 1.62; white-space: pre-wrap; word-break: break-word; }
.bt-tools { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.bt-tool {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px;
  padding: 2px 6px; border-radius: 5px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1);
}
.bt-typing {
  display: flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--dsw-alias-label-secondary); padding: 0 20px 10px;
}
.bt-start { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 48px 24px; }
.bt-start h2 { font-size: 14px; font-weight: 600; margin: 4px 0 0; }
.bt-start p { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 0; max-width: 460px; line-height: 1.6; }
.bt-start .bt-persona {
  margin-top: 6px; text-align: left; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px;
  max-width: 520px; white-space: pre-wrap;
}
.bt-composer {
  display: flex; gap: 10px; align-items: flex-end; padding: 12px 20px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.bt-composer-input { flex: 1; resize: none; }
.bt-input, .bt-textarea {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 10px;
  outline: none; resize: vertical;
}
.bt-input:focus, .bt-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.bt-input-emoji { width: 72px; }
.bt-btn, .bt-primary, .bt-danger {
  font: inherit; font-size: 12.5px; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); white-space: nowrap; flex: none;
}
.bt-btn:hover, .bt-primary:hover { background: var(--dsw-alias-bg-layer-2); }
.bt-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; font-weight: 500; }
.bt-primary:hover { background: var(--dsw-alias-brand-primary); opacity: 0.9; }
.bt-primary:disabled, .bt-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.bt-danger { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-border-l1); background: transparent; }
.bt-danger:hover { background: var(--dsw-alias-bg-layer-2); }
.bt-blank { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 40px; }
.bt-blank h2 { font-size: 14px; font-weight: 600; margin: 0; }
.bt-blank p { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 0; max-width: 420px; line-height: 1.6; }
.bt-banner {
  margin: 10px 20px 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}
.bt-error { font-size: 12px; color: var(--dsw-alias-state-error-primary); margin: 0; line-height: 1.5; }
.bt-mask {
  position: absolute; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / 32%); padding: 24px;
}
.bt-dialog {
  width: min(520px, 100%); max-height: 100%; overflow-y: auto; box-sizing: border-box;
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px; padding: 16px 18px 14px; display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 18px 48px rgb(0 0 0 / 24%);
}
.bt-dialog-head { display: flex; align-items: center; justify-content: space-between; }
.bt-dialog-head h2 { font-size: 14px; font-weight: 600; margin: 0; }
.bt-icon-btn {
  border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 13px; cursor: pointer; padding: 4px 6px; border-radius: 6px;
}
.bt-icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.bt-field { display: flex; flex-direction: column; gap: 5px; }
.bt-field-row { flex-direction: row; align-items: center; gap: 10px; }
.bt-label { font-size: 11.5px; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.bt-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.bt-templates { display: flex; flex-direction: column; gap: 6px; }
.bt-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bt-chip {
  font: inherit; font-size: 12px; padding: 4px 9px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.bt-chip:hover { border-color: var(--dsw-alias-brand-primary); }
.bt-dialog-actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.bt-spacer { flex: 1; }
.bt-chief-badge {
  margin-left: 6px; padding: 1px 5px; border-radius: 4px; font-size: 9.5px; font-weight: 600;
  letter-spacing: 0.02em; color: var(--dsw-alias-brand-primary);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
  vertical-align: 1px; white-space: nowrap;
}
.bt-btn-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.bt-proposals {
  margin: 10px 20px 0; padding: 10px 12px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1);
  display: flex; flex-direction: column; gap: 8px; flex: none;
}
.bt-proposals-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.bt-proposals-title { font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.bt-count {
  font-size: 10.5px; font-weight: 600; padding: 0 5px; border-radius: 999px; line-height: 16px;
  color: #fff; background: var(--dsw-alias-brand-primary);
}
.bt-proposals-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.bt-proposal {
  display: flex; gap: 10px; align-items: flex-start; justify-content: space-between;
  padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.bt-proposal-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.bt-proposal-to { font-size: 11px; font-weight: 600; color: var(--dsw-alias-brand-primary); }
.bt-proposal-task { font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.bt-proposal-actions { display: flex; gap: 6px; flex: none; }
.bt-assign {
  margin: 10px 20px 0; display: flex; flex-direction: column; gap: 6px; flex: none;
}
.bt-assign-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.bt-assign-input { resize: vertical; }
.bt-assign-actions { display: flex; gap: 8px; justify-content: flex-end; }
.bt-toast {
  position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 70;
  padding: 7px 14px; border-radius: 999px; font-size: 12px; pointer-events: none;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2); box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
}
.bt-head-actions { display: flex; align-items: center; gap: 8px; }
.bt-mode {
  font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
  color: var(--dsw-alias-state-warn-primary);
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
.bt-icon-wrap { position: relative; display: inline-flex; }
.bt-icon-badge {
  position: absolute; top: -4px; right: -6px; min-width: 13px; height: 13px; padding: 0 3px;
  border-radius: 999px; font-size: 9px; font-weight: 700; line-height: 13px; text-align: center;
  color: #fff; background: var(--dsw-alias-brand-primary);
}
`

    /** Required Client services. */
    const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']

    /**
     * Register the sidebar entry and the panel it opens.
     * @param {object} ctx - Client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'bots-team: dictionaries')
      const t = ctx.locale.bind(NS)
      const controller = new TeamController(ctx, t)
      ctx.effect(() => () => controller.dispose(), 'bots-team: controller')

      ctx.effect(() => ctx.slots.inject('main', () => {
        const dispose = ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ controller }),
        }, props => h(Boundary, undefined, h(TeamPanel, props)))
        // Leaving the panel releases the retained session copy of the transcript.
        const off = ctx.layout.panelInfo.subscribe(() => {
          if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) controller.closeConversation()
        })
        return () => {
          off()
          dispose()
        }
      }), 'bots-team: panel')

      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 6,
        label: () => t('panel'),
        locale: NS,
      }, props => h(TeamIcon, { ...props, controller }))), 'bots-team: sidebar entry')
    }

    return { inject, apply }
  },
})

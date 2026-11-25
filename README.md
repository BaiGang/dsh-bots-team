# DSH Bot Team

A roster of AI bots in the [DeepSeek Harness](https://github.com/deepseek-ai) left sidebar.
Every bot is a real DSH Session with its own folder, its own persona, and its own
conversation — talk to one like a contact instead of hunting the session list.

<img src="icon.svg" width="72" alt="Bot team icon" align="right" />

**English** | [中文](README.zh.md)

```
┌ Your bot team ───────────────────────── [ + New bot ] ┐
│ 🧭 Scout        │  🧭 Scout · Researcher   ● Idle     │
│    Researcher   │  ┌ transcript ────────────────────┐ │
│ 🛠️ Forge        │  │                                │ │
│    Builder      │  └────────────────────────────────┘ │
│ 📊 Ledger       │  [ Message Scout… ]          [Send]  │
└───────────────────────────────────────────────────────┘
```

## Why

DSH already runs agents well. What a chat-shaped team adds is a place to keep them:
a stable identity per bot (name, emoji, role), a stable folder, and a stable
conversation, reachable in one click.

The panel is a messenger over real Sessions, not a separate runtime. Sending a
message here calls `session.prompt()` — the same path the composer uses — so the
reply streams into this panel and into the bot's own conversation alike, and
**Open chat** hands you the full DSH surface (tools, approvals, files, terminals).

## Every bot gets a folder, and the folder is the persona

When a bot is created, the Host half writes its instructions to
`<bot folder>/AGENTS.md`. DSH's own workspace-instruction loader reads that file
for every Session started in the folder, so:

- the character arrives through a supported mechanism rather than a private
  prompt hack;
- it survives restarts and is readable, diffable, and editable on disk;
- a `.git` marker inside each bot folder makes that folder its own instruction
  root, so guidance from parent directories never leaks in.

## Features

- **Sidebar entry** — a global panel icon (two bot heads) next to the other
  panels; the same id opens the roster page in the main column.
- **Roster** — avatar, name, role, and a live working/idle dot; the roster
  refreshes itself while open, so a bot hired from another window appears.
- **Per-bot conversation** — transcript, tool-call chips, working indicator, and
  a composer that queues into the same Session as the native chat.
- **First message starts the bot** — the Session is created lazily in the bot's
  folder, bound to the roster entry, and prompted, so its instructions are loaded
  before it speaks.
- **Role templates** — Scout (researcher), Forge (builder), Ledger (analyst),
  Quill (writer); three starters are hired on first run.
- **Agent tools** — the same roster is editable by an agent.
- **Bilingual UI** — English and 简体中文, following the DSH locale.

## Install

Requires a DSH profile with the Web GUI (the panel is a browser plugin) and DSH
`0.2.x` or newer.

```sh
git clone https://github.com/BaiGang/dsh-bots-team.git
```

Then open **Plugins → Add plugin** in DSH and choose the cloned directory. The
bundle activates immediately; reload the page so the new browser bundle joins the
boot graph, and **Team** appears in the left sidebar.

The plugin row accepts one optional config field:

```yaml
- id: bots-team
  name: 'dsh-bots-team'
  config:
    dataDir: /absolute/path/to/team-data   # default: $DSH_HOME/bots-team
```

## Use it

1. Open **Team** in the left sidebar.
2. Pick a bot, or **New bot** and start from a role template.
3. Type a message. The first message creates the bot's Session in its own folder;
   later messages continue the same conversation.
4. **Open chat** switches to that Session in the main column.
5. **Edit** changes name, emoji, role, or instructions; instructions are rewritten
   to `AGENTS.md` for the next message.

## Agent tools

| Tool | What it does |
|---|---|
| `team_roster` | Lists every bot with its role, persona, folder, and whether it has a conversation. |
| `team_hire` | Adds a bot with a name, role, persona, and emoji, and writes its folder. |
| `team_brief` | Rewrites one bot's persona or role. |
| `team_fire` | Removes a bot from the roster; its folder and Session stay on disk. |

So "hire a reviewer bot that is harsh about tests" works from a chat, and the new
bot shows up in the panel on its next refresh.

## Where the data lives

- Roster: `$DSH_HOME/bots-team/team.json` (`~/.dsh/bots-team/team.json` by default).
- Bot folders: `$DSH_HOME/bots-team/bots/<bot-id>/`, each with `AGENTS.md` and the
  `.git` instruction-root marker.
- The panel talks to the Host half over a loopback endpoint, `/bots-team/api`.

Removing a bot drops it from the roster only. The folder, its files, and its
Session are left alone, so a removal is recoverable.

## Layout

| File | Role |
|---|---|
| [`index.js`](index.js) | Host half: roster store, bot folders and `AGENTS.md`, `/bots-team/api`, agent tools. |
| [`client.js`](client.js) | Browser half: the `sidebar.panellist` entry and the `main` panel, as one `__ModuleLoader__` factory. |
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle patch that inserts the Host row. |
| [`locale/`](locale) | Plugin-manager title, description, and detail document path. |
| [`docs/DETAIL.md`](docs/DETAIL.md) | The page DSH shows inside the plugin manager. |
| [`test/smoke.mjs`](test/smoke.mjs) | 24 checks over both halves, without a browser. |

The Host half imports Node built-ins only, so it resolves from whatever profile
installs it. The Client half imports nothing but React from the browser module
table.

## Development

```sh
node test/smoke.mjs      # all checks; exits non-zero on failure
```

The suite drives the registered HTTP route through a fake Node request pair,
exercises create/update/bind/delete and the four tools against a temporary data
directory, then loads `client.js` through a `__ModuleLoader__` stub and a small
React shim to run the real panel components and inspect their output tree. It
covers contracts and data flow, not pixels.

## Limits

- The panel needs the Host half; a desktop shell that serves the client from
  `file://` cannot reach the loopback endpoint, and the panel says so.
- One roster per profile; bots are not per-project.
- A bot owns one conversation. Starting over means hiring a new bot; forking a
  conversation is still done from the session list.
- Bots inherit the profile's model. Per-bot model selection is not implemented.
- Deleting a bot does not archive its Session; that stays in the session list.

## License

[MIT](LICENSE) © 2026 BaiGang

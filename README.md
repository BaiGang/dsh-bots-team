<img src="icon.svg" width="72" alt="DSH Bot Team icon" align="right" />

# DSH Bot Team

A persistent roster of AI bots in the [DeepSeek Harness](https://github.com/deepseek-ai) sidebar.

Every bot is a real DSH Session backed by its own folder, persona, and conversation history — talk to one like a teammate in a contact list instead of hunting through the session log.

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

## Why?

DSH already runs agents well. What a chat-style roster adds is **persistence and organization**: a stable identity per bot (name, emoji, role), a dedicated workspace folder, and an ongoing conversation reachable in one click.

The roster has a **chief of staff**: one bot whose job is to take a request, name the right teammate, and hand the work over. It never does the work itself, and it cannot send anything without your click.

The panel acts as a messenger interface over native DSH Sessions rather than a separate runtime. Sending a message here invokes `session.prompt()` — the exact same path used by the main composer — so replies stream into both this panel and the bot's native session simultaneously. Clicking **Open chat** hands you the full DSH workspace (tools, approvals, files, and terminals) whenever you need deeper control.

## How It Works: One Workspace, One Persona per Session

The whole team lives in **one Workspace** — the roster's own directory — so the sidebar shows a single group with one conversation per bot, named after that bot. Inside it:

- **A persona per Session** — the host backend contributes a prompt section that reads the bot the Session belongs to and stays empty for any other conversation, so no other Session picks up a bot's character.
- **Plain-text persistence** — the same instructions are written to `<bot-folder>/AGENTS.md`, readable, diffable, and editable on disk.
- **A folder of its own for files** — each bot keeps `bots/<id>/` for the files it makes; the plugin tells it that path in its persona.

## How Work Gets Handed Out

Ask the chief for something and it answers with a proposal, not with a claim that work started:

1. The chief calls `team_assign`, which **records** the assignment for each named bot and returns `awaiting-confirmation`. Nothing has been sent.
2. The Team panel lists them in a queue, the sidebar entry carries a count badge, and a small pill follows you across panels — click it to come back.
3. You dispatch one, or **Dispatch all** to send the whole queue at once — that click is the confirmation. The task arrives in the target bot's own conversation as a user message, attributed to this plugin, and the bot starts working.
4. When that bot goes idle again, the assignment settles and the panel says so.

You can also dispatch directly: select any bot, press **Assign a task**, and type it. The click is the confirmation, so the chief is not involved.

A delivery that could not start — usually because a bot has no conversation yet — stays in the queue with its reason and a **Retry** button instead of vanishing.

**Unattended mode** is the explicit switch for the case where nobody is watching. Set `unattended: true` and `team_assign` delivers immediately; leave it off and an agent can only propose. The panel shows the mode, so it is always clear which one is in force.

## Features

- **Sidebar integration** — Adds a global **Team** icon (two bot heads) to the left sidebar and opens the roster view in the main column.
- **A chief of staff** — a built-in bot, pinned first in the roster, that decomposes a request and proposes assignments. Fired by accident, it is hired again on the next start, and its folder keeps the conversation.
- **A confirmation gate** — proposals wait in the panel until you dispatch them; the sidebar entry shows how many are waiting, and each dispatch lands in the target bot's own session.
- **Named in the sidebar** — one **Bot team** Workspace holds every bot conversation, each titled with its bot's name, instead of an untitled chat in an ungrouped bucket.
- **Live roster** — Displays each bot's avatar, name, role, and real-time working/idle indicator. Auto-refreshes while open, so bots hired from other windows or chats appear automatically.
- **Inline chat** — Includes a message transcript, tool-call chips, live status indicator, and a composer wired directly into the underlying DSH Session.
- **Lazy session startup** — A bot's Session is created on its first message inside its dedicated folder, ensuring `AGENTS.md` instructions are loaded before its first turn.
- **Built-in role templates** — Ships with **Scout** (Researcher), **Forge** (Builder), **Ledger** (Analyst), and **Quill** (Writer). Three starter bots are pre-hired on first launch.
- **Agent-manageable** — Built-in agent tools let any DSH chat hire, brief, or fire bots conversationally.
- **Bilingual UI** — Supports English and Simplified Chinese (`简体中文`), automatically matching your DSH locale.

## Team Recipes

You do not have to design a roster from scratch. Two shapes work well, and you can edit either into your own after one conversation.

**Research desk** — a paper or an experiment goes in, a reviewed judgement comes out:

| Bot | Role | Persona you can paste |
|---|---|---|
| Reviewer | 审稿人 | Read like a hostile but fair referee: is the claim supported by the evidence, is the baseline fair, what would falsify this? |
| Replicator | 实验复现 | Re-run the method in your folder, on the data you have, and report exactly what reproduces and what does not, with the command that shows it. |
| Librarian | 论文检索 | Find related work, read it, and return a short brief with links: what is new, what is contested, what to read next. |

**Shipping desk** — code and operations:

| Bot | Role | Persona you can paste |
|---|---|---|
| Builder | 实现 | Write the smallest working change, run it, and report the command that proves it. |
| Reviewer | 评审 | Read the diff before it ships: correctness, tests that would have caught the bug, anything that breaks a caller. |
| Operator | 运维 | Watch what runs, reproduce failures from the logs, and hand back a fix or a precise question. |

Create them in the panel (**New bot**, then type the role and persona), or just ask in a chat: *"hire a reviewer bot that reads like a hostile but fair referee, and a librarian that returns briefs with links."* Names, emoji, and roles are yours — the persona is what the bot actually follows, and you can rewrite it any time.

## Installation

**Prerequisites:** DSH `0.2.x` or newer with the Web GUI enabled.

1. Clone this repository:

   ```sh
   git clone https://github.com/BaiGang/dsh-bots-team.git
   ```

2. In DSH, navigate to **Plugins → Add plugin** and select the cloned directory.
3. Reload the browser page so the client bundle joins the boot graph. **Team** will appear in the left sidebar.

### Configuration (Optional)

You can customize the storage directory in your plugin configuration:

```yaml
- id: bots-team
  name: 'dsh-bots-team'
  config:
    dataDir: /absolute/path/to/team-data   # default: $DSH_HOME/bots-team
    unattended: false                      # true lets team_assign deliver without a panel click
    guidance: true                         # standing "## Bot team" note in every Session's prompt
```

## Quick Start

1. Click **Team** in the left sidebar.
2. Select a starter bot, or click **+ New bot** to create one from a template.
3. Send a message. The first message initializes the bot's Session in its folder; subsequent messages continue the same thread.
4. Click **Open chat** anytime to jump into the full DSH session view in the main column.
5. Click **Edit** to update a bot's name, emoji, role, or instructions (`AGENTS.md` updates immediately for the next turn).

## Agent Tools

Other agents in DSH can inspect and manage your roster programmatically:

| Tool | Description |
|---|---|
| `team_roster` | Lists all bots along with their role, persona, folder path, and session status. |
| `team_hire` | Creates a new bot (name, role, persona, emoji) and initializes its workspace folder. |
| `team_brief` | Updates an existing bot's persona instructions or role. |
| `team_fire` | Removes a bot from the roster while leaving its folder and Session intact on disk. |
| `team_assign` | Records one or more assignments for named bots. Delivers them only in unattended mode; otherwise the person confirms in the panel. |
| `team_status` | Reports each bot's session, whether its agent is live and running, and the state of recent assignments. |

> **Example:** Ask any DSH chat to *"Hire a reviewer bot that is strict about unit tests"* — the new bot will appear in your Team panel on the next refresh.

## Data & Storage

- **Roster manifest:** `$DSH_HOME/bots-team/team.json` (defaults to `~/.dsh/bots-team/team.json`), which also holds the last 100 assignment records.
- **Bot workspaces:** `$DSH_HOME/bots-team/bots/<bot-id>/`, each containing `AGENTS.md` and a `.git` root marker.
- **API transport:** The browser panel communicates with the host backend over the loopback endpoint `/bots-team/api`.

**Safe deletion:** Firing or deleting a bot only removes its entry from `team.json`. Its workspace folder, files, and DSH Session remain untouched on disk for easy recovery.

## Project Structure

| Path | Purpose |
|---|---|
| [`index.js`](index.js) | **Host backend:** Roster store, workspace/`AGENTS.md` provisioning, `/bots-team/api` routes, and agent tools. |
| [`client.js`](client.js) | **Browser client:** Registers the `sidebar.panellist` icon and `main` panel via a single `__ModuleLoader__` factory. |
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle patch that registers the host plugin row. |
| [`locale/`](locale) | Localized plugin metadata (titles, descriptions, and detail doc paths). |
| [`docs/DETAIL.md`](docs/DETAIL.md) | Plugin overview displayed inside the DSH Plugin Manager. |
| [`assets/`](assets) | Storefront tile for the plugin catalog, and the framed SVG it is rendered from. |
| [`test/smoke.mjs`](test/smoke.mjs) | Headless test suite (24 checks covering both host and client). |

**Zero external dependencies:** The host backend uses only Node.js built-ins so it runs cleanly across any DSH profile. The browser client imports only React from DSH's runtime module table.

## Development

Run the smoke test suite:

```sh
node test/smoke.mjs      # runs 24 checks; exits non-zero on failure
```

The test suite exercises the HTTP routes via mocked Node request/response pairs, verifies CRUD operations and all four agent tools against a temporary directory, and loads `client.js` through a `__ModuleLoader__` stub with a lightweight React shim to assert component trees and data flow — no browser required.

## Known Limitations

- **One shared working directory:** every bot Session runs in the roster directory, so a bot that changes its own working directory leaves the group.
- **Requires HTTP loopback:** Desktop shells serving the UI over `file://` cannot reach `/bots-team/api` (the panel displays an explicit notice in this environment).
- **Profile-scoped:** One roster is shared across the active DSH profile rather than scoped per project.
- **Single thread per bot:** Each bot maintains one continuous conversation. Starting fresh requires hiring a new bot, while conversation forking must be done from the main session list.
- **Shared model config:** Bots inherit the active profile's model; per-bot model overrides are not yet supported.
- **Manual session cleanup:** Removing a bot from the roster does not delete or archive its underlying Session in DSH's main session list.
- **A bot needs a conversation before it can be dispatched to:** the panel creates and binds one on the first dispatch, and a bot nobody has opened yet fails with that reason rather than silently doing nothing.
- **Completion is polled, not pushed:** the panel notices a finished assignment on its next refresh and shows a short notice; there is no notification outside the panel yet.

## License

[MIT](LICENSE) © 2026 BaiGang

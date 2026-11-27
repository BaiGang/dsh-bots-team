<img src="icon.svg" width="72" alt="DSH Bot Team icon" align="right" />

# DSH Bot Team

A persistent roster of AI bots in the [DeepSeek Harness](https://github.com/deepseek-ai) sidebar.

Every bot is a real DSH Session with its own persona, a dedicated folder for the files it produces, and an ongoing conversation reachable in one click. The whole team shares a single Workspace, so the sidebar reads like a contact list instead of a pile of untitled chats.

[![latest release](https://img.shields.io/github/v/release/BaiGang/dsh-bots-team?sort=semver&label=release)](https://github.com/BaiGang/dsh-bots-team/releases) [![license](https://img.shields.io/github/license/BaiGang/dsh-bots-team)](LICENSE)

**English** | [中文](README.zh.md)

```
┌ Your bot team ──────────────────────────────────────── [ New bot ] ┐
├────────────────┬───────────────────────────────────────────────────┤
│ 🧭 Scout       │ The chief's proposals (2)    [ Dispatch all (2) ] │
│    Researcher  │ Nothing is sent yet.              [ Dismiss all ] │
│ 🛠️ Forge       │ Scout                         [Dispatch] [Cancel] │
│    Builder     │  research OMDb quotas, write a brief              │
│ 📊 Ledger      │ Forge                         [Dispatch] [Cancel] │
│    Analyst     │  build a runnable prototype                       │
│                │                                                   │
│                │ Scout · Researcher                         ● Idle │
│                │ [ Assign a task ]  [ Edit ]  [ Open chat ]        │
│                │ … transcript …                                    │
│                │ [ Message Scout… ]                       [ Send ] │
└────────────────────────────────────────────────────────────────────┘
```

*A sketch of the panel, not a pixel spec: the roster on the left, the chief's proposals above the conversation, and the composer at the bottom.*

## Why?

DSH already runs agents well. What a chat-style roster adds is **persistence and organization**: a stable identity per bot (name, emoji, role), a dedicated workspace folder, and an ongoing conversation reachable in one click.

The roster includes a **chief of staff** — a dedicated bot that breaks down a request, picks the right teammate, and proposes the handoff. It never does the work itself, and it cannot send anything without your click.

The panel is a messenger interface over native DSH Sessions, not a separate runtime. Sending a message invokes `session.prompt()` — the same path used by the main composer — so replies stream into both this panel and the bot's native Session at the same time. Clicking **Open chat** opens the full DSH workspace (tools, approvals, files, and terminals) whenever you need deeper control.

## How It Works: One Workspace, One Persona per Session

The whole team lives in **one Workspace** — the roster's own directory — so the sidebar shows a single group with one conversation per bot, named after that bot. Inside it:

* **One persona per Session** — The host backend contributes a prompt section that identifies which bot owns the current Session and stays empty for all other conversations, preventing personas from leaking outside the roster.
* **Plain-text persistence** — The same instructions are written to `<bot-folder>/AGENTS.md`, making them readable, diffable, and editable on disk.
* **Dedicated output folders** — Each bot keeps `bots/<id>/` for the files it produces; the plugin includes this path in its persona.

## How Work Gets Handed Out

The chief of staff is the dispatcher: you ask it once and the work goes out.

1. The chief calls `team_assign` with one assignment per named bot. Because the call comes from the chief, it **delivers immediately** — the tool answers `dispatched`, and each task lands in the target bot's Session as a user message attributed to this plugin.
2. When that bot returns to idle, the assignment settles and the panel updates.

Every other Session — this chat, another window, a subagent — is not the chief. Its `team_assign` only **records a proposal**: the Team panel queues it, the sidebar entry shows a count badge, and a small pill follows you across panels. Your click, or **Dispatch all** for the whole queue, is what sends it.

You can also dispatch to one bot yourself: select it, click **Assign a task**, and enter the prompt.

If a delivery cannot start — usually because the bot has no Session yet — the item stays in the queue with the failure reason and a **Retry** button instead of disappearing silently.

**Unattended mode** (`unattended: true`) widens that: every caller delivers, not just the chief. The panel displays the active mode, so it is always clear which behaviour is in force.

## Features

* **Sidebar integration** — Adds a global **Team** entry to the left sidebar (two chat bubbles and a small spark for the chief) that opens the roster view in the main column.
* **Built-in chief of staff** — Pinned first in the roster to decompose requests and propose assignments. If fired by accident, it is hired again on the next launch; the old conversation stays in DSH's session list, and the new chief starts a fresh one.
* **The chief dispatches, everyone else proposes** — the chief's `team_assign` sends the work as you asked; another Session can only queue a proposal, which the panel badge counts until you dispatch it.
* **Named sidebar entries** — One **Bot team** Workspace holds every bot conversation, each titled with its bot's name instead of an untitled chat in an ungrouped list.
* **Live roster** — Shows each bot's avatar, name, role, and real-time working/idle status. Auto-refreshes while open so bots hired from other windows or chats appear automatically.
* **Inline chat** — Renders Markdown transcripts (headings, lists, tables, fenced code, quotes, links) as real elements rather than injected HTML, alongside tool-call chips, a live status indicator, and a composer wired directly to the underlying DSH Session.
* **Lazy Session startup** — A bot's Session is created on its first message inside the shared Workspace and titled with the bot's name. No manual folder setup is required beforehand.
* **Built-in role templates** — Ships with **Scout** (Researcher), **Forge** (Builder), **Ledger** (Analyst), and **Quill** (Writer). Three starter bots are pre-hired on first launch.
* **Start a bot over** — Archives a bot's current conversation and clears its binding so the next message opens a fresh Session in the team Workspace; the archived conversation remains recoverable in the session archive.
* **Agent-manageable** — Built-in agent tools let any DSH chat hire, brief, or fire bots conversationally.
* **Theme-aware UI** — Every color comes from a DSH theme token, keeping the panel legible in both light and dark modes.
* **Batch dispatch** — **Dispatch all** sends every waiting proposal in one click; failed rows remain in place with their reason and a **Retry** button.
* **Bilingual UI** — Supports English and Simplified Chinese (`简体中文`), automatically matching your DSH locale.

## Team Recipes

You do not need to design a roster from scratch. Two starting shapes work well, and you can adjust either after a single conversation.

**Research desk** — a paper or experiment goes in, a reviewed judgment comes out:

| Bot | Role | Persona you can paste |
| --- | --- | --- |
| Reviewer | Peer review | Read like a hostile but fair referee: is the claim supported by the evidence, is the baseline fair, what would falsify this? |
| Replicator | Replication | Re-run the method in your folder, on the data you have, and report exactly what reproduces and what does not, with the command that shows it. |
| Librarian | Literature search | Find related work, read it, and return a short brief with links: what is new, what is contested, what to read next. |

**Shipping desk** — code and operations:

| Bot | Role | Persona you can paste |
| --- | --- | --- |
| Builder | Implementation | Write the smallest working change, run it, and report the command that proves it. |
| Reviewer | Code review | Read the diff before it ships: correctness, tests that would have caught the bug, anything that breaks a caller. |
| Operator | Operations | Watch what runs, reproduce failures from the logs, and hand back a fix or a precise question. |

Create them in the panel (**New bot**, then enter the role and persona), or ask in any chat: *"hire a reviewer bot that reads like a hostile but fair referee, and a librarian that returns briefs with links."* Names, emoji, and roles are up to you — the persona is what governs the bot's behavior, and you can edit it at any time.

## Installation

**Prerequisites:** DSH `0.2.x` or newer with the Web GUI enabled.

1. Clone this repository:
   ```sh
   git clone https://github.com/BaiGang/dsh-bots-team.git
   ```
2. In DSH, go to **Plugins → Add plugin** and select the cloned directory.
3. Reload the browser page so the client bundle joins the boot graph. **Team** will appear in the left sidebar.

### Configuration (Optional)

Customize storage and dispatch behavior in your plugin configuration:

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
3. Send a message. The first message opens the bot's conversation in the team Workspace; subsequent messages continue the same thread.
4. Click **Open chat** anytime to switch to the full DSH Session view in the main column.
5. Click **Edit** to update a bot's name, emoji, role, or persona — changes are written to `AGENTS.md` and take effect on the next turn.
6. Click **Start a new conversation** in the same editor to archive the current Session and give the bot a clean slate; nothing is deleted.

## Agent Tools

Other agents in DSH can inspect and manage your roster programmatically:

| Tool | Description |
| --- | --- |
| `team_roster` | Lists all bots along with their role, persona, folder path, and Session status. |
| `team_hire` | Creates a new bot (name, role, persona, emoji) and initializes its workspace folder. |
| `team_brief` | Updates an existing bot's persona instructions or role. |
| `team_fire` | Removes a bot from the roster while leaving its folder and Session intact on disk. |
| `team_assign` | Records one or more assignments for named bots. Delivers immediately only in unattended mode; otherwise waits for confirmation in the panel. |
| `team_status` | Reports each bot's Session, whether its agent is live and running, and the state of recent assignments. |

> **Example:** Ask any DSH chat to *"Hire a reviewer bot that is strict about unit tests"* — the new bot appears in your Team panel on the next refresh.

## Data & Storage

* **Roster manifest:** `$DSH_HOME/bots-team/team.json` (defaults to `~/.dsh/bots-team/team.json`), which also stores the last 100 assignment records.
* **Team Workspace:** The roster directory itself is registered as a single Workspace named **Bot team**; every bot conversation is a Session inside it, titled with the bot's name.
* **Bot workspaces:** `$DSH_HOME/bots-team/bots/<bot-id>/`, each containing `AGENTS.md` and a `.git` root marker.
* **API transport:** The browser panel communicates with the host backend over the loopback endpoint `/bots-team/api`.

**Safe deletion:** Firing or deleting a bot only removes its entry from `team.json`. Its workspace folder, files, and DSH Session remain untouched on disk for recovery.

## Project Structure

| Path | Purpose |
| --- | --- |
| [`index.js`](index.js) | **Host backend:** Roster store, workspace/`AGENTS.md` provisioning, `/bots-team/api` routes, and agent tools. |
| [`client.js`](client.js) | **Browser client:** Registers the `sidebar.panellist` icon and `main` panel via a single `__ModuleLoader__` factory. |
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle patch that registers the host plugin row. |
| [`locale/`](locale/) | Localized plugin metadata (titles, descriptions, and detail doc paths). |
| [`docs/DETAIL.md`](docs/DETAIL.md) | Plugin overview displayed inside the DSH Plugin Manager. |
| [`assets/`](assets/) | Storefront tile (`icon-180.png`) and its SVG source (`tile.svg`). |
| [`icon.svg`](icon.svg) | Plugin icon, resolved through the `./icon` export. |
| [`test/smoke.mjs`](test/smoke.mjs) | Headless test suite (52 checks covering both host and client). |

**Zero external dependencies:** The host backend uses only Node.js built-ins so it runs across any DSH profile. The browser client imports only React from DSH's runtime module table.

## Development

Run the smoke test suite:

```sh
node test/smoke.mjs      # runs 52 checks; exits non-zero on failure
```

The suite drives HTTP routes through mocked Node request/response pairs, exercises roster operations and all six agent tools against a temporary directory, and loads `client.js` through a `__ModuleLoader__` stub with a lightweight React shim to assert rendered output and data flow — no browser required. It also guards against past regressions: a cleared Session binding cannot be resurrected by a stale snapshot, a persona never leaks to a Session outside the roster, and no brand-filled control hardcodes a white label.

## Known Limitations

* **One shared working directory:** Every bot Session runs in the roster directory; if a bot changes its own working directory, it leaves the group.
* **Requires HTTP loopback:** Desktop shells serving the UI over `file://` cannot reach `/bots-team/api` (the panel displays an explicit notice in this environment).
* **Profile-scoped:** One roster is shared across the active DSH profile rather than scoped per project.
* **Single thread per bot:** Each bot keeps one conversation. **Start a new conversation** archives it and opens a fresh one; forking still happens from the main session list.
* **Shared model config:** Bots inherit the active profile's model; per-bot model overrides are not yet supported.
* **Firing does not archive:** Removing a bot leaves its Session in DSH's list. Only **Start a new conversation** archives a Session, and the archive is recoverable.
* **Older conversations stay put:** A Session created before the shared Workspace keeps its own working directory and cannot join the group.
* **A bot needs a conversation before dispatch:** The panel creates and binds one on the first dispatch. If that fails, the queue keeps the row with the reason and a **Retry** button.
* **Completion is polled, not pushed:** The panel detects a finished assignment on its next refresh and shows a brief notice; notifications outside the panel are not yet supported.

## License

[MIT](LICENSE) © 2026 BaiGang

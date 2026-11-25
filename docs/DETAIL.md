# Bot team

A roster of AI bots in the left sidebar. Every bot on the roster is a real DSH
Session with its own working folder, its own persona, and its own conversation, so
talking to one feels like messaging a contact rather than opening a tool.

## Why it looks like this

DSH already runs agents well; what a chat-shaped team adds is a place to keep
them. The panel gives each bot a stable identity (name, emoji, role), a stable
folder, and a stable conversation, and lets you reach any of them in one click
instead of hunting the session list.

The persona is not a private prompt hack. When a bot is created, the Host half
writes its instructions to `<bot folder>/AGENTS.md`. DSH's own workspace
instruction loader reads that file for every Session started in the folder, so
the bot's character arrives through the same mechanism as any project guidance,
survives restarts, and stays readable and editable on disk.

## Use it

1. Open **Team** in the left sidebar.
2. Pick a bot, or choose **New bot** and start from one of the role presets.
3. Type a message. The first message creates the bot's session; later messages
   go into the same conversation.
4. **Open chat** switches to the bot's own conversation in the main column, where
   the full DSH surface (tools, approvals, files, terminals) is available.
5. **Edit** changes the name, emoji, role, or instructions. Instructions are
   rewritten to `AGENTS.md` for the next message.

Three starter bots (Scout, Forge, Ledger) are created on first run so the panel
opens as a team rather than a blank page. Delete them if you would rather start
empty.

## What the agent sees

The Host half also registers four tools, so an agent can manage the same roster:

| Tool | What it does |
|---|---|
| `team_roster` | Lists every bot with its role, persona, folder, and whether it has a conversation. |
| `team_hire` | Adds a bot with a name, role, persona, and emoji, and writes its folder. |
| `team_brief` | Rewrites one bot's persona or role. |
| `team_fire` | Removes a bot from the roster; its folder stays on disk. |

## Where the data lives

- Roster: `$DSH_HOME/bots-team/team.json` (`~/.dsh/bots-team/team.json` by default).
- Bot folders: `$DSH_HOME/bots-team/bots/<bot-id>/`, each with `AGENTS.md` and a
  `.git` directory that marks the folder as its own instruction root so guidance
  from parent directories does not leak in.
- Row config `dataDir` moves both elsewhere.

Removing a bot drops it from the roster only. The folder, its files, and its
session are left alone, so a removal is recoverable.

## Limits

- The panel talks to the Host half over a loopback HTTP endpoint
  (`/bots-team/api`). It answers same-origin browser requests on the machine that
  runs DSH; a page served from another origin is refused. A desktop shell that
  loads the client from `file://` cannot reach it, so the panel reports that the
  roster endpoint did not answer.
- The roster is shared by every session in the profile; bots are not per-project.
- A bot owns one conversation. Starting over means deleting the bot and hiring a
  fresh one; forking the conversation is still done from the session list.
- Deleting a bot does not archive its session; that stays in the session list.

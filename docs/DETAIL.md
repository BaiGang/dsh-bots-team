# Bot team

A roster of AI bots in the left sidebar. Every bot on the roster is a real DSH
Session with its own working folder, its own persona, and its own conversation, so
talking to one feels like messaging a contact rather than opening a tool.

## Why it looks like this

DSH already runs agents well; what a chat-shaped team adds is a place to keep
them. The panel gives each bot a stable identity (name, emoji, role), a stable
folder, and a stable conversation, and lets you reach any of them in one click
instead of hunting the session list.

The persona is not a private prompt hack. When a bot is created, the host backend
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

Four bots exist on first run: **Chief** (chief of staff) pinned first, then the
starters Scout, Forge, and Ledger. Delete any of them if you would rather start
empty; the chief is hired again on the next start, with its folder kept.

## Handing work out

The chief takes a request, names the right bot, and calls `team_assign`. That
call **records** an assignment and sends nothing: it returns
`awaiting-confirmation`. The panel lists the proposals, the sidebar entry badges
the count, and your click on **Dispatch** is what delivers the task — it arrives
in the target bot's own conversation as a user message and the bot starts
working. When it goes idle, the assignment settles and the panel says so.

Selecting a bot and pressing **Assign a task** dispatches directly; that click is
its own confirmation.

`unattended: true` is the explicit switch for an unwatched profile: there
`team_assign` delivers immediately. The default is off.

## Teams to start from

The three starters are placeholders; a roster earns its keep when the jobs are
yours. Two shapes worth copying:

- **Research desk** — *Reviewer* (审稿人) reads like a hostile but fair referee;
  *Replicator* (实验复现) re-runs the method in its folder and says exactly what
  reproduces; *Librarian* (论文检索) returns short briefs with links.
- **Shipping desk** — *Builder* writes the smallest working change and proves it;
  *Reviewer* reads the diff before it ships; *Operator* reproduces failures from
  the logs.

Hiring them takes one sentence in a chat (*"hire a reviewer bot that reads like a
hostile but fair referee"*), or **New bot** in the panel with a name, role, and
persona. The persona is what the bot follows, and it can be rewritten any time.

## What the agent sees

The host backend also registers four tools, so an agent can manage the same roster:

| Tool | What it does |
|---|---|
| `team_roster` | Lists every bot with its role, persona, folder, and whether it has a conversation. |
| `team_hire` | Adds a bot with a name, role, persona, and emoji, and writes its folder. |
| `team_brief` | Rewrites one bot's persona or role. |
| `team_fire` | Removes a bot from the roster; its folder stays on disk. |
| `team_assign` | Records assignments for named bots; delivers them only in unattended mode. |
| `team_status` | Reports each bot's session, live agent, and recent assignments. |

## Where the data lives

- Roster: `$DSH_HOME/bots-team/team.json` (`~/.dsh/bots-team/team.json` by default),
  including the last 100 assignment records.
- Bot folders: `$DSH_HOME/bots-team/bots/<bot-id>/`, each with `AGENTS.md` and a
  `.git` directory that marks the folder as its own instruction root so guidance
  from parent directories does not leak in.
- Row config `dataDir` moves both elsewhere.

Removing a bot drops it from the roster only. The folder, its files, and its
session are left alone, so a removal is recoverable.

## Limits

- The panel talks to the host backend over a loopback HTTP endpoint
  (`/bots-team/api`). It answers same-origin browser requests on the machine that
  runs DSH; a page served from another origin is refused. A desktop shell that
  loads the client from `file://` cannot reach it, so the panel reports that the
  roster endpoint did not answer.
- The roster is shared by every session in the profile; bots are not per-project.
- A bot owns one conversation. Starting over means deleting the bot and hiring a
  fresh one; forking the conversation is still done from the session list.
- Deleting a bot does not archive its session; that stays in the session list.
- A bot needs a session before it can receive work. The panel creates and binds
  one on the first dispatch; when creation fails the assignment records that
  reason instead of doing nothing.
- Completion is noticed on the panel's next refresh, not pushed.

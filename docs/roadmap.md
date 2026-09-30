# Roadmap

Open tasks after 1.5.1, written 2026-09-23 so the work can start cold. The cockpit plan in
`cockpit.md` still stands; this file is the shorter list of what to build next and why.

## Decision: tmux and the terminal stay

Considered a native app wrapper (Tauri or Electron around xterm.js) for the review loop and
other multi-agent flows. Rejected.

- claude and codex are terminal apps. A wrapper ships a terminal emulator plus a sidebar around
  the same ptys. Same processes, same reboot death, no new capability. It loses detach, ssh, any
  terminal, npm install, the offline guarantee, and buys signing, notarization, updates and
  emulator bugs under heavy TUI redraws.
- The review flow is orchestration: spawn with flags, route text, read transcripts, link ids,
  persist state. All on disk and in processes. A sidebar does not change it.
- The real native route is a different product: drive the Agent SDK (`stream-json`) and render
  your own chat, permission prompts and tool output. That rebuilds Claude Code's frontend and
  loses its TUI (slash commands, skills, plan mode). Not for a one-person tool.
- What tmux costs, honestly: Terminal.app has no truecolor (swap the terminal, keep tmux),
  scrollback and mouse inside the agent TUI are fiddly, three key layers (tmux, agtc, agent),
  no rich diff with clickable lines, no images.

Revisit only for things a terminal cannot do: inline rendered diffs you click, screenshots from
agents, layouts across monitors, or dropping the agent TUI for an SDK-driven chat.

## Tasks

The first six shipped on 2026-09-23, the seventh a day later, all unreleased. What each left behind:

1. Notifications: `osascript` banner, default on, `--no-notify` / `AGTC_NOTIFY=0`. Fires on the
   poll that sees a session turn done or needs input while its terminal is off screen. The
   OSC 9 / 777 fallbacks are not built; osascript works in Terminal.app and inside tmux.
2. Reviewer beside the subject: `V` splits the subject's pane. The stage moves whole windows
   now (`focusTmuxPane`): a pane brings its siblings, several staged panes leave together.
   The one-pane case still swaps, so a resized stage keeps its width there and resets in the
   group case.
3. `f`: report popup (removed 2026-09-24, `V` on the reviewer row is the hand-back), `less`, numbered `path:line` references, `q` then the number opens it in
   the editor. Two keystrokes because `less` has no hook on the current line; a native report
   view would make it one.
4. Read-only resume: `readOnlyFlags` shared by the fresh command and `R` / `S` / `c`;
   `HubWindow.reviewOf` carries it across restarts.
5. Views: shipped first as a `tab`-cycled `ui.view` flag inside the TUI, rejected the same day:
   the overview needs no keys, and the TUI needs no second body renderer. Now `agtc graph`,
   a read-only subcommand with its own loop (`src/commands/graph.ts`, rendering in `src/tui/graph.ts`), polling with a read-only
   `SeenStore` so it never writes the hub's state file. Views with their own data (quno, ot)
   go the same way: a command each, not a mode. Meant for a full screen: families (a session
   with its children) flow across the width, as many per row as fit. Graph: one level deep. Subagents from `subagents/agent-*.meta.json` plus
   the log tail (`src/sources/claude/subagents.ts`); Codex from `thread_spawn_edges`.
   Verified 2026-09-23: agentId is unrelated to the `toolu_` id, the meta file carries
   `toolUseId`, `agentType`, `description`, `spawnDepth`; the parent's tool result says
   `async_launched` at launch and never changes, so the agent log's last entry is the only
   liveness signal. Not shown: depth-2 agents (an agent's agents), finished agents older than
   ten minutes. Codex child threads also appear as inactive sessions in the list; they have
   no process of their own.
6. Mouse: SGR 1000/1006, hit map per frame, click selects, double click stages, wheel moves
   the selection. Legacy X10 reports are consumed so a stray byte never reads as `q`.
7. Worktrees (2026-09-24): `agtc worktrees [DIR]`, `prune`, `rm NAME [--force]`, in
   `src/worktrees/`. A subcommand like graph, not a key: the list is long (104 on the
   platform repo) and removal wants a `y/N`, neither fits the hub. State per worktree from
   one `git worktree list --porcelain`, one `for-each-ref` with `%(upstream:track)` for gone
   and ahead, `git status --porcelain` in each (eight at a time; still ~12s for 104, so a
   progress line on stderr), sessions from the last 30 days for who ran there. Merged is
   read as "upstream gone" because squash merges leave no ancestry. A branch without an
   upstream counts commits no other ref holds (`rev-list --not --exclude=<own> --branches
   --remotes`), so a worktree parked on another branch's commit is `fresh` and says
   `in <ref>`. `prune` deletes the branch with `-D` only for gone, `-d` for fresh, so git
   still refuses when the count was wrong. Tried treating a gone branch with commits no
   other ref holds as unpushed: after `fetch --prune` every squash-merged branch looks like
   that (61 of 62), and git keeps no record of the last pushed tip, so gone is trusted. In a terminal the list is a picker (checkbox per
   row, removable ones pre-checked, enter then y): the plain table is what `--once` and a
   pipe get. Not built: pruning across every repo at once, `x` in the hub for a finished
   session's worktree, seeing a plain shell or Zed sitting in a worktree (only agents count
   as live).

## Next

Written 2026-09-29, after roomy rows, pane headers and subagent rows. Updated 2026-09-30:
the new popup (`n`, `option-n`) is in; `v` lists uncommitted work, the branch and every
commit, opens one in revdiff and hands the line comments to the agent. lazygit and `C` are gone.

Session messaging (2026-09-30, after 1.13.0): Claude Code sessions message each other over a
unix socket, `SendMessage` / `ListAgents` inside, `~/.claude/sessions/<pid>.json` names the
socket (`messagingSocketPath`) and the tmux pane, the `<pid>.<hash>.key` beside it holds the
token. Wire: one JSON line `{"type":"auth","token":…}`, then
`{"type":"user","message":{"role":"user","content":…}}`. An idle session wakes into a turn, a
busy one reads it between tool calls, the model sees `<cross-session-message from=…>`.
`src/sources/claude/inbox.ts` posts that way; `agtc send --message`, `v` comments, the spec
request and `V` on a reviewer use it for a Claude target and fall back to the paste for Codex.
A Claude reviewer is started `-n "<checkout> review"` and told the author's session name, so
its questions go to the author; the author is told to bring the user what it cannot answer.
Open: whether a message from agtc (not a session, no permission mode to compare) is delivered
or held for approval by the receiver; `peer_message_status` on the same connection is parsed
when it comes, a silent close counts as delivered. Not built: automatic hand-back when a
reviewer finishes (the user wants the verdict first), `notify_when_idle` (the poll sees it).

- Diff review with line comments: see the changes beside the agent or in a popup, comment on
  lines or hunks, send all of it to the agent in one go. The one that matters most.
- Peek and answer, taken out 2026-09-30 to revisit: `space` showed an agent's screen in a
  popup, `y` / `option-y` answered whichever agent needed input from there, keys typed into
  its pane while `~/.claude/sessions/` said it waited. Also out: waiting agents in the tmux
  status line with click to jump; the user found it a mess next to the window list. In git
  at 30e436c.
- Notifications through the terminal (OSC 9 / 777), so the banner needs no `osascript`.
- Dim the pane you are not typing in, the way the backdrop dims what is behind a popup.
- A click on a pane header opens that pane's menu.
- Command palette: one key anywhere, type to filter actions and sessions.
- Owed: the row diagram in `src/tui/layout.ts` shows neither the second line nor a subagent's.

- Depth-2 subagents as a third column, or indented under their agent, once a session with
  them is on screen often enough to matter.
- Notify on a reviewer finishing with the subject's title, not "review of …", if the banner
  reads worse than expected.
- Release 1.6.0 after a day of use.

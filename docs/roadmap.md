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

All six shipped on 2026-09-23, unreleased. What each left behind:

1. Notifications: `osascript` banner, default on, `--no-notify` / `AGTC_NOTIFY=0`. Fires on the
   poll that sees a session turn done or needs input while its terminal is off screen. The
   OSC 9 / 777 fallbacks are not built; osascript works in Terminal.app and inside tmux.
2. Reviewer beside the subject: `V` splits the subject's pane. The stage moves whole windows
   now (`focusTmuxPane`): a pane brings its siblings, several staged panes leave together.
   The one-pane case still swaps, so a resized stage keeps its width there and resets in the
   group case.
3. `f`: report popup, `less`, numbered `path:line` references, `q` then the number opens it in
   the editor. Two keystrokes because `less` has no hook on the current line; a native report
   view would make it one.
4. Read-only resume: `readOnlyFlags` shared by the fresh command and `R` / `S` / `c`;
   `HubWindow.reviewOf` carries it across restarts.
5. Views: shipped first as a `tab`-cycled `ui.view` flag inside the TUI, rejected the same day:
   the overview needs no keys, and the TUI needs no second body renderer. Now `agtc graph`,
   a read-only subcommand with its own loop (`src/tui/graph.ts`), polling with a read-only
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

## Next

- Depth-2 subagents as a third column, or indented under their agent, once a session with
  them is on screen often enough to matter.
- Notify on a reviewer finishing with the subject's title, not "review of …", if the banner
  reads worse than expected.
- Release 1.6.0 after a day of use.

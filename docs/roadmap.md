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

### 1. Notify when an agent needs me

`osascript -e 'display notification "…" with title "agtc"'` works from inside tmux in
Terminal.app on macOS 26 (tested and seen 2026-09-23, exit 0, banner shown). Zero deps.

- Fire on the transitions the refresh loop already sees: a session turns `done` unseen, a session
  turns `needs input`. `--bell` is the existing hook at the same spot; make it `--notify` or
  default on with macOS detection.
- Title is the session title, subtitle the status, no body. Skip when the agent's pane is the
  active tmux pane (I am looking at it).
- Fallbacks if osascript stops working: OSC 9 / OSC 777 escapes (Ghostty, Kitty, WezTerm,
  iTerm2, not Terminal.app; through tmux needs `allow-passthrough`), tmux `display-message`.

### 2. Reviewer beside the subject

`V` opens the reviewer in its own window. Open it as a split of the subject's window instead
(`split-window -h -t <subject pane>`), so the visual tie is literal and both are on screen.
The `╰ review` row stays. Jump keys target panes, so they keep working. `x` kills the pane
either way. Check `newTmuxWindow` for what a split variant needs (cwd, name, pane id return).

### 3. Findings popup

The reviewer's report is only read by pasting it into the subject. Add a popup that shows the
last report (`reviewerReport` already extracts it) in `less -R`, and a key that opens a
`file:line` from it in Zed. Same popup mechanism as `?`.

### 4. Restored reviewer must stay read-only

`S` and `R` run plain `claude --resume <id>`, so a restored reviewer gets Edit and Write back.
Re-add the reviewer flags (`reviewerCommand` knows them) when the session has `reviewOf`.
`HubWindow` needs `reviewOf`, or look the id up in the stored review links.

### 5. Views: list, then a graph

Switchable views of the same sessions. Per `cockpit.md` decision 2: a tab line in the header,
number keys or `tab` to cycle, zero width cost.

Graph view, the one that matters: nodes are sessions, edges are review links and subagents,
drawn like a CI pipeline (parent left, children right, status colour per node, live only).
Hand-rolled with box drawing like the list; there is no terminal graph lib worth a dep.

Subagent data exists on disk for Claude: `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`,
entries carry `isSidechain: true`, `agentId`, `parentUuid`. The parent transcript has the
`tool_use` block (name `Agent`, input has `description` and `subagent_type`). Still to verify:
how a `tool_use` id maps to the `agentId` file name, and whether a running subagent can be told
apart from a finished one (file mtime, or a matching `tool_result` in the parent). Codex:
unknown whether spawned agents leave files; check rollouts for spawn or collab events.

### 6. Mouse

Double click on a row opens it (same as enter), single click selects, wheel scrolls. Per
`cockpit.md` decision 3: SGR mouse (`?1000;1006`), events parsed in `splitKeys`, a hit map
per frame. tmux already has `mouse on` for the hub and forwards events to an app that asked
for them. Double click is two clicks on the same row within about 300 ms; nothing reports it
natively.

# Cockpit

agtc as my personal cockpit. Built for me only; npm is distribution, not audience. Agents do the
typing, I direct, review, note and clock. This file holds the decisions and the build order so the
work can start cold later. Nothing here is implemented yet (2026-09-17).

## Frame

- agtc stays one pane. tmux is the window manager, Zed the editor, lazygit the diff, quno the
  notes, ot the clock. agtc launches into popups or windows, never embeds a foreign TUI.
- No plugin API, no config layer. Apps live in this repo: `src/apps/quno.ts`, `src/apps/ot.ts`.
  "Plugin" is a folder convention.
- Events beat keys. Glue is where the value compounds: `N` creates a worktree and `ot start`
  fires with repo and branch; a session started by `quno start` shows its quest id on the row.
  `--bell` is already a hardcoded event hook; generalise to `session.started`, `session.done`,
  `worktree.created`.
- North star: one row is one unit of work. Session, checkout, branch, changes, quest, time.
  Every key acts on the row. No new panes needed for that.
- Not an IDE. No file tree, no editor pane, no embedded terminals. Zed has those.

## Decisions

Each one: what is decided, why it matters, the options with their cost, the pick. Picks are
defaults, revisit when the first implementation says otherwise.

### 1. View structure

Deciding how a second screen enters the code. `App` today is shell (stdin, draw loop, footer,
message, prompt) plus the agents view in one class; the choice sets the price of every next app.

- Mode flag. `ui.view = "agents" | "quno" | "ot"`, switch in `handleListKey` and `renderFrame`.
  Zero refactor now. One `UiState` for all views, key switch and render grow per app.
- Shell plus View interface. Shell owns terminal and loop. A view is `render(size)`,
  `handleKey`, `hints`, `refresh`. Agents view moves out of `App`. About a day, no behaviour
  change, regression risk in the most-used view.
- No native views. Apps are processes in tmux windows, agtc only launches. Kills custom UI.

Pick: shell plus view, before the second native view.

### 2. Switcher

Deciding how the active app is shown and changed inside a pane that is 30% of the hub. Width is
the scarce resource; the title column pays for every extra column.

- Sidebar column, 10-12 cols. Matches the mental picture, mouse-friendly. At a 200-col terminal
  the list drops from 60 to 48 cols.
- Tab line in the header: `1 agents  2 quno  3 ot`, number keys or `tab` cycles. Zero width.
- Leader key full swap (`space q`, `esc` back), no indicator. Zero everything, no affordance.
- Sidebar as its own tmux pane running a second agtc. Two processes plus IPC. No.

Pick: tab line. Can become a sidebar behind a width check once mouse lands.

### 3. Mouse

Deciding whether agtc parses mouse events and keeps a hit map per frame. Buttons only exist with
mouse; without it a button is a key hint.

- Keyboard only. Buttons rendered as `[s]tart [e]nd`. tmux `mouse on` still gives pane and
  window clicks.
- SGR mouse. Enable `?1000;1006`, parse in `splitKeys`, views register row/col ranges. 60-80
  lines in the shell plus per-view work. Text selection then needs shift-drag, wheel handling,
  every clickable thing registered.

Pick: keyboard now. Mouse when a native view has more actions than free keys.

### 4. quno TUI

Deciding whether the Bubble Tea TUI survives once agtc has quno views. Two renderers on the same
vault means features twice or drift.

- quno keeps its TUI, agtc stages it in a window. Zero port, no integration, two key
  vocabularies.
- quno becomes CLI plus skills, agtc owns the UI. quno adds porcelain for todo list, toggle,
  add, delete; `ls --porcelain` and `cat` exist. Port todo, then quests, delete `tui*.go`.
  Standalone quno TUI outside the hub is gone.
- Hybrid. agtc shows counts and the todo checklist, stages the quno TUI for deep work. Still two,
  drift limited to the summary.

Pick: CLI-only if agtc is really the cockpit, hybrid if unsure (reversible). Either way agtc
shells to `quno --porcelain`, never parses the vault itself; quno stays sole owner of the schema.

### 5. Renderer

Deciding whether hand-rolled ANSI stays or a library comes in before views multiply. Migration
cost grows with every view written.

- Hand-rolled (`render.ts`, `ansi.ts`, `layout.ts`). Lists, header widgets, key actions are
  trivial. Forms, per-view scroll regions, hit maps get written once in the shell.
- Ink. React model, Yoga flexbox, focus for free. React runtime in a 2 s poll loop, full rewrite.
- OpenTUI. Bun-native, flexbox and mouse built in. Young, Zig dependency, full rewrite; check
  its state before betting.

Pick: hand-rolled. Rewrite trigger: catching myself writing a nested box layout engine.

### 6. Surface per app

Deciding per app: staged window, popup, or native. Sets persistence and how keys reach it.

- Staged window: persistent, stateful, next to the list like an agent. quno TUI.
- Popup: modal, transient, `display-popup`, dies on exit. lazygit today, one-shot tools.
- Native: in-process, shares keys and footer. ot, later quno todo.

Pick: as listed. A wrong pick shows fast and is cheap to move.

### 7. ot data

Deciding whether agtc reads ot through its CLI or opens `data.db` with `bun:sqlite`. The codex
source reads sqlite directly, tempting precedent.

- CLI with a new `--porcelain` on `ot status`. ot owns the schema and rules ("later than now
  means yesterday"). One spawn per poll, ~40 ms every 2 s.
- Direct sqlite. No spawn, schema coupling, rules duplicated. The codex precedent exists because
  codex has no query CLI; ot has one.

Pick: CLI.

### 8. Distribution

Deciding whether the npm cycle stays now that nobody else installs it.

- Keep npm plus `agtc-dev`. Ceremony per change, stable global, `agtc update` works.
- Checkout symlinked as `agtc`. Zero ceremony, Zed tasks run dev code, a broken working tree
  breaks `cmd-shift-a` mid-edit.

Pick: keep as is. README stops pretending to be general.

## Apps

**quno.** Go, Bubble Tea TUI, own process. First step: window `quno` in the hub session running
`quno ui`, created on first select, staged on select via `focusTmuxPane`, back to its window when
something else is staged. Same mechanism as `enter` on an agent, ~100 lines. `quno start <quest>`
goes through `newTmuxWindow` so the claude session lands in the hub and is tracked. Later: header
count from `quno ls --porcelain -s ready`, native todo view, native quests view, quest id on
rows of sessions started by `quno start` (detect `--add-dir ~/dev/docs` in process args or the
prompt prefix).

**ot.** No TUI, three commands plus status. Skip the terminal step. Native: header widget with the
open session and elapsed time, keys for start and end using `ask()` for the message, repo and
branch of the selected row prefilled. Needs `ot status --porcelain`.

## Build order

Each step ships alone.

1. Shell/view split. Agents becomes the first view. No visible change.
2. Tab line switcher, staged-window app for quno.
3. ot native: `--porcelain` in ot, widget, start/end keys.
4. Event hooks: `session.started`, `session.done`, `worktree.created`, commands with `AGTC_*`
   env (`AGTC_DIR`, `AGTC_REPO`, `AGTC_BRANCH`, `AGTC_SESSION_ID`, `AGTC_TOOL`).
5. quno todo native (tiny, good first port), then quests.
6. Quest id on session rows.
7. Mouse, only if a view still wants buttons.

## Outside this repo

- ot: add `--porcelain` to `status`.
- quno: porcelain for todo (list, toggle, add, delete); decide the TUI's fate (decision 4).

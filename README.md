# agtc — Agent Traffic Control

Air traffic control for your coding agents.

A terminal dashboard for every Claude Code and Codex CLI session running on your Mac: which repo and worktree each one is in, whether it is busy, idle, waiting for input, or finished with output you have not looked at yet, and what it has changed so far. Run it inside tmux and it becomes a sidebar: `enter` puts the selected agent next to it, `v` opens the diff, `o` opens the checkout in Zed.

```
bunx @lilbunnyrabbit/agtc
```

Or install once and get the `agtc` command:

```
bun add -g @lilbunnyrabbit/agtc
agtc update          # later: pulls the newest version
```

Requires [Bun](https://bun.sh) and macOS (Terminal.app integration). Does not run under `npx`.

## Setup

The dashboard alone needs nothing else. The rest of this README, agents in tmux and Zed, needs:

1. `bun add -g @lilbunnyrabbit/agtc`, so `agtc` is on the PATH for Zed tasks and the hub (`~/.bun/bin`, which Bun's installer adds to the shell). `bunx` works for the plain dashboard only.
2. `brew install tmux`. Every key that starts, shows or resumes an agent (`enter`, `v`, `n`, `N`, `R`) and `agtc attach` / `agtc send` need it. `brew install lazygit` is optional, `v` falls back to `git diff`.
3. Optional, for Zed: the two tasks and two keys under [Agents inside Zed](#agents-inside-zed), and `"terminal": {"option_as_meta": true}` if you want `option-a` there.

Updating: `agtc update`, then quit agtc in the hub (`q`) and run `agtc tmux` again. Agents keep running through that. tmux and Zed configuration never change between versions unless the changelog says so.

## What you see

```
 agtc 1.5.0  ✳ 2  ⬡ 2   input 0   done 1   busy 1  idle 2  inactive 0

 acme-platform ────────────────────────────────────────────────  1 done  4 sessions
 ▌ 1    ✳   done     Settings page safe padding                                2m
   2 ⎇  ✳  busy      Sidebar header overflow on iOS                            5m
   3    ⬡  idle      ╰ review                                                  1m
   4    ⬡  idle      Can the chart legend be restyled                          1h
```

- `✳` Claude Code, `⬡` Codex, `⎇` session lives in a git worktree, `╰ review` a reviewer started with `V`, hanging off the session it reviews; the digit left of a running row is its `1`…`9` key
- **needs input** blocked on a permission or dialog
- **done** turn finished after your last prompt and you have not looked at it yet
- **busy** working, **idle** waiting for you, **inactive** not running (recent history)

Selected session gets a detail pane: working directory, worktree and branch, uncommitted changes (`3 files +120 −14   2 ahead of origin/main`, then the paths, most recently touched first), the last prompt with its age and, when the terminal is tall enough, the two before it. A Claude session that created a worktree mid-way and moved into it is tracked by where it edits files, not where it started; the other checkouts it touched are listed as well.

Sessions that want you, `input` and `done`, get a filled badge and a title in the same colour, and their group line counts them, so nothing waiting hides in a long list. The order is fixed: repos alphabetically, live sessions in the order they started, finished ones below them newest first. A status change recolours a row, it never moves it, and the selection stays on the session it was on.

`agtc graph`, full screen in a terminal of its own, is a read-only overview of what runs: the same sessions drawn like a pipeline, a box per running session on the left, what it spawned in boxes to its right, arrows between them. The border takes the status colour. It redraws on every poll and takes no key but `q`.

`agtc worktrees [DIR]` lists the worktrees of DIR's repository (default cwd) with what keeps each one around: the agent running or last seen there, uncommitted files, commits the remote lacks. Sorted most alive first. A `✓` marks the ones safe to remove: `fresh` (never committed to, no changes), `gone` (branch deleted on the remote, so merged or closed there; a squash merge leaves no trace in the base's history, which is why the remote is asked and not `git branch --merged`) and `missing` (directory already deleted, git still lists it). One caveat: a commit made in a `gone` worktree after its last push is invisible once the remote branch is pruned, so `prune` deletes it with the branch; check `dirty` and `unpushed` are what you expect, `gone` is trusted. In a terminal the list is interactive: the removable ones start checked, `space` toggles any row that is not live or locked (a `dirty` or `unpushed` one goes with `--force`, the branch stays), `a` checks all removable, `n` none, `enter` asks once and removes the checked, `q` quits; piped or with `--once` it prints the table. `agtc worktrees prune` skips the list and removes the removable ones after a `y`, deleting the branch of a `gone` or `fresh` one with it; `missing` only loses its registration. `agtc worktrees rm NAME` takes one by directory name or branch, refuses `dirty`, `unpushed`, `detached` and `locked` unless `--force`, and never removes one an agent is running in. `--force` keeps the branch.

```
 acme-platform ──────────────────────────────────────────────────────────────  4 sessions
 ┌─────────────────────────────────┐    ┌─────────────────────────────────┐
 │ ✳ ⎇  Sidebar header overflow    │─┬─▶│ ⬡ review                        │
 │   idle · 5m · fix/header        │ │  │   busy · 4m                     │
 └─────────────────────────────────┘ │  └─────────────────────────────────┘
                                     │  ┌─────────────────────────────────┐
                                     └─▶│ ◇ Explore: callers of Header    │
                                        │   busy · 1m                     │
                                        └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ ✳ Settings page safe padding    │
 │   busy · 2m · main              │
 └─────────────────────────────────┘
```

Children are the session's reviewers (`V`) and `◇` its subagents: agents it runs inside its own process (Claude's Agent tool, Codex collaborators), busy or finished in the last ten minutes, with their type and what they were asked. A session with its children is a family; families flow across the width, as many per row as fit, so a full screen holds them all. A terminal too narrow for two boxes side by side hangs the children under their parent. What does not fit ends in a dim `…`.

## Keys

| key | action |
| --- | --- |
| `j` `k` `↑↓` | move the selection up / down, inactive rows included |
| `J` `K` | the running session above / below, selected and jumped to in one key, wrapping around |
| `1`…`9` | the running session with that digit, drawn left of its row, selected and jumped to |
| `enter` | jump to that session: its Terminal.app tab, or its tmux pane (inside tmux it joins agtc's window, see below) |
| `o` | open the checkout in the editor (`AGTC_EDITOR`, default `zed`) at the most recently changed file |
| `v` | review the checkout in a tmux popup: `lazygit` if installed, else `git diff HEAD` |
| `V` | start a read-only reviewer agent for that session's work in a pane beside the session's (a window of its own when the session is not in tmux). Asks for the spec: `tab` walks the spec the session wrote (`~/.cache/agtc/specs/<checkout>--<branch>.md`, when it exists), `ask <tool> for a spec`, its first and last prompt; or type text or a `@path`. Then which tool reviews (the other one by default). It shows as a row under the session. On a reviewer's row, `V` pastes its report into the reviewed session's input, unsent |
| `x` | close a reviewer: its tmux pane and the agent in it. Refused while its report is unread (`V` hands it over, `m` drops it) |
| `n` | start another agent of the same kind in a new tmux window; asks where, starting from that checkout, `tab` walks the checkouts in the list |
| `N` | new worktree of that repository (asks for a branch name), then an agent in it |
| `R` | resume an inactive session in a new tmux window, so attach and send can reach it. A reviewer comes back read-only |
| `S` | restore the last hub: every agent window tmux held when agtc last looked, resumed in place, reviewers read-only |
| `/` | search across every prompt you ever typed in any session, plus worktree, branch, path, tool, status |
| `m` / `M` | mark selected / all as seen |
| `c` | copy a resume command (`claude --resume …` / `codex resume …`) |
| `a` | show inactive sessions |
| `d` | toggle detail pane |
| `?` | the whole key reference, tmux keys and the review loop included, in a popup (`q` closes); outside tmux, the footer shows every key instead of the ones for the selected session |
| `q` | quit |
| mouse | click selects a row, a double click stages it like `enter`, the wheel moves the selection. Inside tmux this needs `mouse on`, which agtc sets for its session |
| `prefix a`, `option-a` | tmux keys agtc binds at start: back to agtc's pane from any window in the session. `option-a` needs the terminal to send option as meta |
| `option-j`, `option-k`, `option-1`…`option-9` | tmux keys agtc binds at start: `J`, `K` or the digit, typed into agtc from whatever pane you are in, so you loop between agents without leaving the one you are typing in |

## Flows

Every flow assumes the hub is running: `agtc tmux` in any terminal, Zed's included. Pass `--base origin/staging` when new worktrees should branch from staging, and `--jump zed` when you look at agents from Zed rather than from the hub (see below).

**Start a task in a fresh worktree.** Select any session of that repository, `N`, type the branch name, enter. agtc adds the worktree under `.claude/worktrees/`, starts the agent there, shows it. Type the task.

**Start another agent in an existing checkout.** Select a session in that checkout, `n`.

**Continue a finished session.** `a` to show inactive ones, select it, `R`. It resumes in a tmux window with its whole transcript.

**Move a session that runs in Terminal.app into tmux.** `/exit` it in its tab, then the flow above. Sessions outside tmux are listed and can be jumped to, but attach, send, `v` and the stage cannot reach them.

**Check on agents.** The list: `input` needs you, `done` finished since you last looked, `busy`, `idle`. Detail pane: what changed, how far ahead of the base branch, last prompt. `enter` puts the agent next to agtc; `M-a` comes back. `m` or looking at it marks it seen.

**Review what an agent did.** Select it, `v`: lazygit over its checkout, `q` closes. For the diff in the editor, `o`.

**Get a second opinion.** Select the session, `V`. First time, take `ask <tool> for a spec`: a request lands in the session's input, enter, and the agent writes what was asked, what the result must do and what is out of scope to `~/.cache/agtc/specs/<checkout>--<branch>.md`, in its own words but without its reasoning; the file follows the checkout and branch, so a resumed or second session in the same worktree finds it. `V` again: the file is the default now (edit it in Zed first if you like), pick the reviewer. A fresh agent of the other tool starts in the same checkout, in a pane beside the session's, with the spec and the base branch, reads the diff, and reports findings, questions and a verdict. The verdict, `ready` or `not ready`, lands on the reviewer's row, in the detail pane with its first line, and in the banner when the reviewer finishes off screen. It cannot edit: Claude runs with every writing tool disallowed, Codex in its read-only sandbox. Its row hangs off the session's, so its status sits right under the work it judges. When it asks something, `enter` on its row and answer. When it is done, `V` on its row: the report lands in the reviewed session's input, unsent, and that session comes on stage. Read it, cut what you disagree with, enter. `x` on the reviewer closes it. The agent fixes, you `V` again on the session for a fresh pair of eyes, or `v` and commit.

**Ship it.** `v`, commit in lazygit, `q`, then tell the agent to push and open the pull request. agtc itself never sends anything off the machine.

**Edit by hand or point the agent at a line.** `o` opens the checkout in Zed as its own sidebar workspace, at the last changed file. In Zed, `cmd-shift-a` shows that agent in a terminal tab (`agtc attach`). Select code, `cmd-shift-enter` (`agtc send`): the agent's input gets `file:row` and the selection as a code block; type what should change, enter.

**Zed mode.** Start with `--jump zed`: `enter` opens the checkout in Zed instead of moving panes, so the Zed terminals attached to agents keep showing them. The hub is then just the list. Use this when you live in Zed; use the default when you live in the terminal.

**Resume after a restart.** Agents live in tmux, so closing Zed or the terminal loses nothing. `agtc tmux` attaches again; in Zed, `cmd-shift-a` again in each workspace. After a reboot or `tmux kill-server` the agents are gone too: `agtc tmux`, then `S` opens every window of the last hub again, same names, same directories, each running `claude --resume` (or `codex resume`) for its session. agtc notes the windows on every poll, and says on start when some are missing. Agents already running are skipped, so `S` twice does nothing extra.

**Never** archive or close a thread in Zed's sidebar for a worktree Zed itself created (paths under `../worktrees/`): that deletes the worktree. Worktrees from `N`, Claude or `git worktree add` are safe.

## Flags

```
agtc tmux            open (or attach to) a tmux session with agtc in a window named hub
agtc graph           read-only overview of what runs: a box per session, its reviewers and subagents to the right, live; q quits
agtc attach [DIR]    show the agent running in DIR (default cwd) in this terminal, live
agtc send [DIR] --file F --row N
                     type "F:N" plus $AGTC_SELECTION as a code block into that agent's input
agtc worktrees [DIR] the worktrees of DIR's repository: what runs or last ran in each, uncommitted and unpushed work, ✓ on the removable; a checkbox list in a terminal, a table when piped
agtc worktrees prune [DIR]
                     remove the removable ones after a y/N, with their branches
agtc worktrees rm NAME [DIR] [--force]
                     remove one by directory name or branch; --force takes uncommitted or unpushed work with it
agtc --jump zed      enter opens the checkout in the editor instead of pulling the pane next to agtc
agtc --days 7        list inactive sessions from the last 7 days (default 2)
agtc --interval 1000 poll every second (default 2000 ms)
agtc --stage 75      width of the agent pane next to agtc inside tmux, percent (default 70)
agtc --worktrees DIR where N creates worktrees, relative to the main checkout (default .claude/worktrees)
agtc --base staging  branch N starts worktrees from (default origin's default branch)
agtc --inactive      start with inactive sessions shown
agtc --bell          ring the terminal bell too when a session finishes or needs input while you are elsewhere
agtc --no-notify     no macOS notification when a session finishes or needs input off screen
agtc --json          print all sessions as JSON
agtc --once          print one frame and exit
agtc update          update this install to the newest version
agtc --help          usage
```

`AGTC_WORKTREES`, `AGTC_BASE`, `AGTC_JUMP` and `AGTC_NOTIFY=0` are the environment forms of `--worktrees`, `--base`, `--jump` and `--no-notify`. `AGTC_TMUX_SETUP=0` stops agtc from binding `prefix a` / `option-a`, turning the mouse on and setting `CLAUDE_CODE_TMUX_TRUECOLOR` in its tmux session. `AGTC_EDITOR` picks the editor for `o`. The default `zed` gets `--existing`: the checkout becomes its own workspace in the sidebar of the Zed window you already have open, or Zed switches to it if it is there already. This works regardless of the `cli_default_open_behavior` setting.

## tmux hub

The intended setup: one tmux session holds every agent, agtc sits in a narrow pane on the left, and the agent you selected sits on the right. Zed stays a single window for editing and browsing; you only open a checkout there when you need it, so its language servers do not run for every worktree at once.

```
brew install tmux lazygit    # lazygit is optional, v falls back to git diff
agtc tmux                    # creates the session "agtc" with agtc in window "hub", then attaches
```

Run that from any terminal you like, Zed's included. Inside the hub:

- `n` starts an agent in its own tmux window and shows it. It asks where first, prefilled with the selected session's checkout; `tab` cycles through every checkout in the list, or type a path. Windows are named after the checkout: `agtc`, or `agtc/feat+x` in a worktree.
- `N` asks for a branch name, adds a worktree from the main checkout (`git worktree add -b <name> <dir> <base>`, or the existing branch when there is one, after fetching a remote base) and starts an agent there. Directory `<main checkout>/.claude/worktrees/<name>` with `/` turned into `+`, like Claude Code's own worktrees; change it with `--worktrees`.
- `option-j` / `option-k` from any pane stage the running agent above / below; `option-1` to `option-9` stage the one with that digit in the list. Each is a tmux root binding that selects agtc's window and types `J`, `K` or the digit into agtc, so the list moves with you. Bound only when the key is free.
- `enter` moves the selected agent's pane into agtc's window as the stage; the agent that was there goes back to a window of its own. Windows keep their names. The first stage goes right of agtc, `--stage` percent wide; after that the two panes swap places, so the hub layout stays as you left it. Rearranging is tmux's job: `prefix space` flips to stacked, dragging the border resizes, `prefix z` zooms the stage to full screen. On a small screen skip `enter` and switch windows with `prefix w` or `prefix n`, then `prefix a` back to agtc.
- `v` opens lazygit over the checkout as a popup; `q` closes it and you are back in agtc.
- `V` starts a reviewer read-only, with a prompt written to `~/.cache/agtc/prompts/`, as a split beside the reviewed session's pane, so both are on screen; staging either one brings the other along, and whatever leaves the stage leaves together. A session outside tmux gets its reviewer in a window named `<checkout> review`. agtc remembers which session it reviews, so the pairing survives restarts and `S`. `V` on the reviewer pastes its last message into the reviewed session's pane the way `agtc send` does: bracketed, nothing submitted. A reviewed session that is not in tmux, or not running, gets the report on the clipboard instead.
- `o` opens the checkout in Zed at its most recently changed file. Each checkout is its own workspace in Zed's sidebar, so the git panel and the project panel are that checkout's. Zed's sidebar needs the agent panel enabled (`agent.enabled`, the default); with it off, Zed opens a window per checkout instead.
- Agents started by hand also count: any tmux pane running `claude` or `codex` is found, in any session.

Careful with worktrees Zed created itself (under its `git.worktree_directory`, by default `../worktrees/<repo>/<name>/<repo>` next to the repo). Each belongs to a thread in Zed's sidebar, and archiving that thread, or closing its entry, runs `git worktree remove` on the directory after saving pending changes as WIP commits under `refs/archived-worktrees/<n>`. An agent working there from a terminal loses its working directory mid-task. agtc never removes anything, it only opens the checkout; but `zed --existing` does open that sidebar. Worktrees made with `git worktree add`, by Claude Code, or by agtc's `N` (all under `.claude/worktrees/` by default) are not Zed-managed and are not affected. Prefer those for agent work.

Getting back to agtc from anywhere in the session is `prefix a` or `option-a`. agtc binds both itself every time it starts inside tmux, turns the mouse on for its session, and sets `CLAUDE_CODE_TMUX_TRUECOLOR=1` in the session environment so agents started from the hub keep Claude Code's 24-bit colours (it falls back to 256 colours under tmux otherwise, which makes the logo and diff backgrounds look off). `~/.tmux.conf` needs nothing. A key you already bound to something else is left alone; `AGTC_TMUX_SETUP=0` skips the whole thing. `option-a` only reaches tmux when the terminal sends option as meta (Terminal.app: profile, Keyboard, "Use Option as Meta key"; Zed: `"terminal": {"option_as_meta": true}`), `prefix a` works everywhere. If you would rather own the lines:

```
set -g mouse on
bind a select-window -t hub \; select-pane -Z -t hub.0
bind -n M-a select-window -t hub \; select-pane -Z -t hub.0
```

### tmux in five keys

Everything below is stock tmux; the prefix is `ctrl-b`, pressed and released before the next key. Every agent is a window, listed in the status bar at the bottom; the hub is window `hub`, whose left pane is agtc and whose right pane is the staged agent.

- Switch windows: `prefix w` opens a chooser, `prefix n` / `prefix p` go next and previous, `prefix 0`..`9` by number, `prefix l` the window you came from. With `mouse on`, clicking a name in the status bar works too. From agtc, `enter` on a session does the same thing and also stages it.
- Move between panes: `prefix o` cycles, `prefix` plus an arrow key goes in that direction, or click the pane. `prefix z` zooms the current pane to full size and back.
- Change the layout: `prefix space` cycles side by side, stacked and more, `prefix {` swaps the two panes, `enter` keeps whatever you set. Resize by dragging the border, or `prefix :` and `resize-pane -L 10` (`-R`, `-U`, `-D`). tmux's own `prefix ctrl-arrow` never arrives on macOS until you untick the Mission Control shortcuts under Keyboard Shortcuts.
- Close an agent: quit it (`/exit` in Claude Code, `ctrl-c` twice or `exit` for a shell), and its window closes with it. Nothing else is needed, agtc notices. `prefix &` kills the window with everything in it after a confirmation, `prefix x` kills just the pane; both end the agent, so prefer quitting it.
- Leave: `prefix d` detaches, agents keep running, `agtc tmux` brings the session back. Closing the terminal window does the same.
- Scroll: `prefix [` enters copy mode, arrows or page up/down move, `q` leaves. With `mouse on`, the wheel does it directly.

Sessions in Terminal.app tabs keep working as before; agtc uses whichever the session runs in. Agents survive closing the terminal that shows the hub, `agtc tmux` attaches again.

## Agents inside Zed

The other way round: keep the agents in tmux, but look at them from Zed. Two commands, both meant to run from a Zed terminal inside a checkout, and both find the agent by directory (the checkout it works in, or one containing the terminal's cwd; several agents in one checkout: the one that needs you most).

- `agtc attach` shows that agent in the terminal, live. It is a tmux session grouped with the agent's, so it shares the windows but keeps its own current window: the hub can show something else at the same time. No status bar; closing the terminal drops the view, the agent keeps running.
- `agtc send --file F --row N` types `F:N` into the agent's input, followed by `$AGTC_SELECTION` as a fenced code block when it is set. Bracketed paste, so nothing is submitted: you add "this should be per chat, not global" and press enter yourself.

Both need the agent to run inside tmux: started from the hub with `n`, `N` or `R`, or by hand in a tmux window. An agent in a Terminal.app tab is reported, not attached; quit it there and `R` brings it into tmux. Zed hands the environment of the `zed` call that opened a project to that project's terminals, so `o` from the hub launches Zed without tmux's variables, and `agtc attach` trusts `TMUX_PANE` only when its terminal really is that pane.

Wire them to Zed tasks (`~/.config/zed/tasks.json`) and keys (`~/.config/zed/keymap.json`):

```json
[
  {
    "label": "Send selection to agent",
    "command": "agtc",
    "args": ["send", "--file", "$ZED_RELATIVE_FILE", "--row", "$ZED_ROW"],
    "env": { "AGTC_SELECTION": "$ZED_SELECTED_TEXT" },
    "reveal": "never",
    "hide": "always"
  },
  {
    "label": "Attach agent",
    "command": "agtc",
    "args": ["attach"],
    "use_new_terminal": true,
    "allow_concurrent_runs": true
  }
]
```

```json
[
  {
    "context": "Editor",
    "bindings": {
      "cmd-shift-enter": ["task::Spawn", { "task_name": "Send selection to agent" }],
      "cmd-shift-a": ["task::Spawn", { "task_name": "Attach agent" }]
    }
  }
]
```

In this mode start agtc with `--jump zed` (or `AGTC_JUMP=zed`): `enter` then opens the session's checkout in Zed like `o`, and `n` / `N` leave new agents in their own windows instead of pulling them next to agtc, so a Zed terminal attached to one keeps showing it. Zed restores terminal tabs after a restart but not what ran in them, so attach again.

`agtc update` runs `bun add -g @lilbunnyrabbit/agtc@latest` (or the npm equivalent) for you. Plain `bun update -g` will not do: `bun add -g` writes `^0.x.y` to the global package.json, and a caret on a 0.x version never crosses a minor release. Under `bunx` or a git checkout the command only tells you what to do.

## How it works

No hooks, no daemons, no config. Everything is read from what the tools already write:

- Claude Code: `~/.claude/sessions/<pid>.json` for live status and cwd, `~/.claude/history.jsonl` for prompts, `~/.claude/projects/<project>/<session>.jsonl`, read incrementally, for the paths a live session's tool calls touch: any tool, so shell edits count like Edit calls. Subagents from `~/.claude/projects/<project>/<session>/subagents/`: `agent-<id>.meta.json` names the type and task, the last entry of `agent-<id>.jsonl` says whether it is still working (a tool call or its result) or done (a plain message, or an interruption); the parent's tool result cannot tell, it is written when the agent launches. The checkout most of the recent calls hit is where the session works (that is how a session that moved into a worktree is placed, and why one `cd` elsewhere does not move it). Only checkouts listed by `git worktree list` for the repository the session started in count, so writes to memory files, dotfiles or other repos never move a session, and a session whose directory vanished (Claude then reports your home as cwd) stays under its repo.
- Codex: the `thread-writer-locks/<id>.lock` file a running `codex` holds open identifies its thread; `~/.codex/state_*.sqlite` and the thread's rollout log give title, prompts and busy/idle. Collaborators a thread spawned come from its `thread_spawn_edges` table joined to `threads`, named by nickname and role since their prompts are encrypted on disk, busy or done from their own rollout.
- Worktrees: `git rev-parse --git-dir` vs `--git-common-dir`. Changes: `git status --porcelain`, `git diff HEAD --numstat` and `git rev-list --count <base>..HEAD` against `origin/HEAD` (else `main` / `master`), every 10 s per live checkout.
- Terminal.app via AppleScript: tab titles, which tab you are looking at (that is how "done" turns into "idle"), and focusing a tab on `enter`.
- tmux: `list-clients` and `list-panes` map ttys to panes and tell which window is in front of an attached client. A client sitting in a Terminal.app tab counts as looking only while that tab is in front.

"Seen" marks persist in `~/.cache/agtc/state.json`, and so do the list of agent windows `S` restores and the reviewer pairings from `V` (by session id; a Codex reviewer is matched by its tmux pane until its thread id exists).

## Security

agtc is read-only and offline. The full footprint:

- **Reads** `~/.claude/sessions/*.json`, `~/.claude/history.jsonl`, the last 256 KB of `~/.claude/projects/*/<session>.jsonl` for live sessions, their `<session>/subagents/agent-*.meta.json` and the tail of `agent-*.jsonl`, `~/.codex/state_*.sqlite` (opened read-only) and Codex rollout `.jsonl` logs.
- **Writes** `~/.cache/agtc/state.json` (session ids and timestamps of when you looked at them, the session last opened per checkout, the agent windows tmux held, for `S`, and which reviewer reviews which session) and, on `V`, the reviewer's prompt under `~/.cache/agtc/prompts/`. Specs under `~/.cache/agtc/specs/` are written by the agent you asked, agtc only creates the directory and reads them. Inside tmux it also sets a `@agtc_window` pane option on panes it moves.
- **Spawns** while polling: `ps`, `lsof`, `git` (`rev-parse`, `worktree list`, `status`, `diff`, `rev-list`, `symbolic-ref`), `osascript` and `tmux list-*`, always as argv arrays, never through a shell. The tty passed to AppleScript is validated against `ttys<digits>` first. When a poll finds a session that just turned done or needs input while its terminal is off screen, `osascript -e 'display notification …'` shows a banner with the session's title and status (`--no-notify` stops that).
- **Spawns once at start inside tmux**: `tmux set-option mouse on` and `tmux set-environment CLAUDE_CODE_TMUX_TRUECOLOR=1` for its own session, and `tmux bind-key` for `prefix a`, `option-a`, `option-j`, `option-k` and `option-1` to `option-9`, after `tmux list-keys` showed them free or already agtc's.
- **Spawns on a key press only**: `pbcopy` (`c`), `tmux` pane commands (`enter`, `n`, `N`), the editor from `AGTC_EDITOR` (`o`), for `v` a tmux popup that runs `lazygit` or `git diff HEAD` in the checkout, and for `N` `git fetch` of the base branch plus `git worktree add` in the main checkout. `n` and `N` type the bare command `claude` or `codex` into a fresh shell in the checkout, nothing else; `R` and `S` type `claude --resume <id>` or `codex resume <id>` the same way, with the read-only flags below added back for a reviewer. `V` types `claude "$(cat <prompt file>)" --session-id <uuid> --disallowedTools 'Edit,Write,NotebookEdit,Read(~/.claude/**),Read(~/.codex/**)' --allowedTools 'Read,Grep,Glob,Bash(git diff:*),…'` or `codex --sandbox read-only --ask-for-approval never "$(cat <prompt file>)"`. `agtc send` and `V` on a reviewer paste text into an agent's input without pressing enter (`V` reads the reviewer's last message from its transcript or rollout log first, and copies it with `pbcopy` when the pane is out of reach); `agtc attach` creates a grouped tmux session. `x` runs `tmux kill-pane` on a reviewer's pane, the one process agtc ends, and only after its report was handed over or dropped. The only things agtc deletes are worktrees and branches, and only through `agtc worktrees prune` after a `y` or `agtc worktrees rm`: `git worktree remove` (with `--force` only when you passed it), then `git branch -d` for a never-used branch and `git branch -D` for one whose remote branch is gone, `git worktree prune` for a directory that is already gone. Nothing runs in a worktree an agent is active in.
- **Network**: none. `bun run check:offline` fails CI if anything under `src/` references fetch, http, sockets or Bun's server APIs. The one thing that reaches the registry is `agtc update`, and it does so by running `bun add -g` (or `npm install -g`), never from agtc's own code.
- **Dependencies**: zero at runtime. `bun-types` for development only. No install scripts.
- macOS asks for Automation permission (control Terminal.app) the first time. Denying it only disables tab titles, the seen detection and `enter` for sessions in Terminal.app tabs.
- `c` copies a single-quoted `cd '<cwd>' && claude --resume '<id>'` to the clipboard. It never executes anything.
- `--json` includes each session's title, first and last prompt, and working directory. The full prompt list stays in memory only.

To run exactly what you reviewed, pin a version. Every release is published from GitHub Actions with npm provenance, so the tarball can be traced to a commit:

```
bunx @lilbunnyrabbit/agtc@0.2.0
npm view @lilbunnyrabbit/agtc@0.2.0 dist.attestations
```

GitHub Actions in the workflows are pinned to commit SHAs.

## Development

```
git clone https://github.com/lilBunnyRabbit/agtc
cd agtc
bun install
bun start         # or: bun src/main.ts
bun src/main.ts tmux   # the hub, running this checkout
bun run check     # typecheck
bun test
bun run check:offline
bun link          # makes `agtc` on your PATH point at this checkout
ln -s "$PWD/bin/agtc" ~/.local/bin/agtc-dev   # or keep the release and run the checkout as agtc-dev
```

Layout:

```
src/main.ts          entry: dispatches on the parsed mode
src/cli.ts           flag parsing and usage text
src/paths.ts         every file agtc reads or writes under ~
src/model/           Session type and status order, tool commands (resume, read-only flags), collect from every
                     source + git changes + "done" + sort, `/` search, the state file (~/.cache/agtc/state.json),
                     the agent running in a directory (for attach and send)
src/sources/         read-only: claude/ (registry, history, transcript, subagents), codex/ (sqlite, lsof, rollout),
                     git, processes, Terminal.app tabs, tmux panes
src/tmux/            acting on tmux: own pane detection, stage (enter), windows/panes/popups, key setup, the hub
                     session, restoring the last hub
src/review/          the V loop: spec request, reviewer prompt and command, reading a report and its verdict
src/worktrees/       `agtc worktrees`: read state per worktree, state rules, table, picker, remove
src/commands/        one file per subcommand: attach, send, update, graph loop, worktrees
src/desktop/         the editor (`o`) and macOS notifications
src/tui/             ansi, theme, row layout, frame rendering, key parsing, the shared raw-mode screen, help text,
                     graph rendering; tui/app/ is the interactive loop with its actions split by concern
                     (stage, agents, review, input) over one AppContext
src/lib/             shell, files, text, time, ttl-cache, map-limit
test/                bun test: pure parts (parsing, layout, state rules, rendering invariants)
```

## Releasing

Publishing is automated from tags via npm trusted publishing (OIDC), no tokens stored anywhere:

```
npm version patch   # or minor / major — bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

GitHub Actions runs a smoke test, publishes to npm with provenance, and creates a GitHub release.

One-time setup: the first version is published by hand (`npm publish --access public --provenance=false`), then on npmjs.com under the package's Settings → Trusted Publisher, register GitHub Actions with owner `lilBunnyRabbit`, repository `agtc`, workflow `release.yml`.

## License

MIT

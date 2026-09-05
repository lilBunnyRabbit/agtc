# agtc — Agent Traffic Control

Air traffic control for your coding agents.

A terminal dashboard for every Claude Code and Codex CLI session running on your Mac: which repo and worktree each one is in, whether it is busy, idle, waiting for input, or finished with output you have not looked at yet. Read-only. It watches your agents, it does not launch them.

```
bunx @lilbunnyrabbit/agtc
```

Or install once and get the `agtc` command:

```
bun add -g @lilbunnyrabbit/agtc
agtc update          # later: pulls the newest version
```

Requires [Bun](https://bun.sh) and macOS (Terminal.app integration). Does not run under `npx`.

## What you see

```
 agtc   ✳ 11  ⬡ 1     needs input 0   done 1   busy 2   idle 8   inactive 5

 astra-ai-platform ───────────────────────────────────── 10 sessions
 ▌     ✳  done      Labs page top safe padding                      2m
   ⎇   ✳  busy      Study path header overflow iOS                  5m
       ⬡  idle      Does our voice orb allow styling                1h
```

- `✳` Claude Code, `⬡` Codex, `⎇` session lives in a git worktree
- **needs input** blocked on a permission or dialog
- **done** turn finished after your last prompt and you have not looked at it yet
- **busy** working, **idle** waiting for you, **inactive** not running (recent history)

Selected session gets a detail pane: working directory, worktree and branch, last prompt.

## Keys

| key | action |
| --- | --- |
| `↑↓` `j` `k` | move |
| `enter` | jump to that session's Terminal tab |
| `/` | search across every prompt you ever typed in any session, plus worktree, branch, path, tool, status |
| `m` / `M` | mark selected / all as seen |
| `c` | copy a resume command (`claude --resume …` / `codex resume …`) |
| `a` | show inactive sessions |
| `d` | toggle detail pane |
| `q` | quit |

## Flags

```
agtc --days 7        list inactive sessions from the last 7 days (default 2)
agtc --interval 1000 poll every second (default 2000 ms)
agtc --inactive      start with inactive sessions shown
agtc --bell          ring the terminal bell when a session finishes while you are elsewhere
agtc --json          print all sessions as JSON
agtc --once          print one frame and exit
agtc update          update this install to the newest version
agtc --help          usage
```

`agtc update` runs `bun add -g @lilbunnyrabbit/agtc@latest` (or the npm equivalent) for you. Plain `bun update -g` will not do: `bun add -g` writes `^0.x.y` to the global package.json, and a caret on a 0.x version never crosses a minor release. Under `bunx` or a git checkout the command only tells you what to do.

## How it works

No hooks, no daemons, no config. Everything is read from what the tools already write:

- Claude Code: `~/.claude/sessions/<pid>.json` for live status and cwd, `~/.claude/history.jsonl` for prompts.
- Codex: the `thread-writer-locks/<id>.lock` file a running `codex` holds open identifies its thread; `~/.codex/state_*.sqlite` and the thread's rollout log give title, prompts and busy/idle.
- Worktrees: `git rev-parse --git-dir` vs `--git-common-dir`.
- Terminal.app via AppleScript: tab titles, which tab you are looking at (that is how "done" turns into "idle"), and focusing a tab on `enter`.

"Seen" marks persist in `~/.cache/agtc/state.json`.

## Security

agtc is read-only and offline. The full footprint:

- **Reads** `~/.claude/sessions/*.json`, `~/.claude/history.jsonl`, `~/.codex/state_*.sqlite` (opened read-only) and Codex rollout `.jsonl` logs.
- **Writes** one file: `~/.cache/agtc/state.json` (session ids and timestamps of when you looked at them).
- **Spawns** `ps`, `lsof`, `git rev-parse`, `osascript` and `pbcopy`, always as argv arrays, never through a shell. The tty passed to AppleScript is validated against `ttys<digits>` first.
- **Network**: none. `bun run check:offline` fails CI if anything under `src/` references fetch, http, sockets or Bun's server APIs. The one thing that reaches the registry is `agtc update`, and it does so by running `bun add -g` (or `npm install -g`), never from agtc's own code.
- **Dependencies**: zero at runtime. `bun-types` for development only. No install scripts.
- macOS asks for Automation permission (control Terminal.app) the first time. Denying it only disables tab titles, the seen detection and `enter`.
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
bun run check     # typecheck
bun run check:offline
bun link          # makes `agtc` on your PATH point at this checkout
```

Layout:

```
src/main.ts          entry: --help / --version / --json / --once / TUI
src/cli.ts           flag parsing and usage text
src/session.ts       Session type, status order
src/sessions.ts      collects from every source, resolves "done", sorts
src/search.ts        `/` filtering and match snippets
src/seen-store.ts    persisted "seen" marks (~/.cache/agtc/state.json)
src/sources/         claude/ (registry + history), codex/ (sqlite, lsof, rollout log), git, processes, terminal
src/tui/             ansi codes, theme, row layout, frame rendering, key parsing, App loop
src/lib/             shell, files, text, time, ttl-cache helpers
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

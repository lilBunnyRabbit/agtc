# agtc — Agent Traffic Control

Air traffic control for your coding agents.

A terminal dashboard for every Claude Code and Codex CLI session running on your Mac: which repo and worktree each one is in, whether it is busy, idle, waiting for input, or finished with output you have not looked at yet. Read-only. It watches your agents, it does not launch them.

```
bunx @lilbunnyrabbit/agtc
```

Or install once and get the `agtc` command:

```
bun add -g @lilbunnyrabbit/agtc
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
agtc --help          usage
```

## How it works

No hooks, no daemons, no config. Everything is read from what the tools already write:

- Claude Code: `~/.claude/sessions/<pid>.json` for live status and cwd, `~/.claude/history.jsonl` for prompts.
- Codex: the `thread-writer-locks/<id>.lock` file a running `codex` holds open identifies its thread; `~/.codex/state_*.sqlite` and the thread's rollout log give title, prompts and busy/idle.
- Worktrees: `git rev-parse --git-dir` vs `--git-common-dir`.
- Terminal.app via AppleScript: tab titles, which tab you are looking at (that is how "done" turns into "idle"), and focusing a tab on `enter`.

"Seen" marks persist in `~/.cache/agtc/state.json`.

## Development

```
git clone https://github.com/lilBunnyRabbit/agtc
cd agtc
bun install
bun start         # or: bun src/main.ts
bun run check     # typecheck
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

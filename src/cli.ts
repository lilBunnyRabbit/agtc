export type Mode = "tui" | "graph" | "worktrees" | "once" | "json" | "update" | "tmux" | "attach" | "send" | "help" | "version";
export type Jump = "tmux" | "zed";

export interface Options {
  mode: Mode;
  days: number;
  intervalMs: number;
  showInactive: boolean;
  bell: boolean;
  /** macOS banner when a session turns done or needs input off screen. Default on. */
  notify: boolean;
  stagePercent: number;
  /** Where `N` puts new worktrees; relative to the main checkout. Default .claude/worktrees. */
  worktrees?: string;
  /** Branch `N` starts new worktrees from. Default origin's default branch. */
  base?: string;
  /** What `enter` does: pull the agent's pane next to agtc, or open its checkout in the editor. */
  jump: Jump;
  dir: string;
  file?: string;
  row?: string;
  action?: "prune" | "rm";
  name?: string;
  force: boolean;
  once: boolean;
}

const DEFAULT_DAYS = 2;
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_STAGE_PERCENT = 70;

export const USAGE = `agtc — Agent Traffic Control
Terminal dashboard for local Claude Code and Codex sessions.

Usage
  agtc                 interactive TUI
  agtc tmux            open (or attach to) a tmux hub with agtc in it
  agtc graph           read-only overview of what runs: a box per session, its reviewers and
                       subagents in boxes to the right, live; q quits
  agtc attach [DIR]    show the agent running in DIR (default cwd) in this terminal, live
  agtc send [DIR] --file F --row N
                       type "F:N" plus $AGTC_SELECTION as a code block into that agent's input
  agtc worktrees [DIR] the worktrees of DIR's repository (default cwd): what runs or last ran in
                       each, uncommitted and unpushed work, which ones are safe to remove (✓).
                       In a terminal it is a list with a checkbox per row: the safe ones start
                       checked, space toggles any that is not live or locked, enter removes the
                       checked after a y/N; piped or with --once it prints the table
  agtc worktrees prune [DIR]
                       remove the safe ones after a y/N, with their branches, no list to edit
  agtc worktrees rm NAME [DIR]
                       remove one by directory name or branch; --force takes uncommitted or
                       unpushed work with it (the branch stays)
  agtc --once          print one frame and exit
  agtc --json          dump sessions as JSON
  agtc update          update to the newest published version

Options
  --days N             list inactive sessions from the last N days (default ${DEFAULT_DAYS})
  --interval MS        poll interval in milliseconds (default ${DEFAULT_INTERVAL_MS})
  --stage PERCENT      width of the agent pane shown next to agtc in tmux (default ${DEFAULT_STAGE_PERCENT})
  --worktrees DIR      where N creates worktrees, relative to the main checkout (default .claude/worktrees)
  --base BRANCH        branch N starts worktrees from (default origin's default branch)
  --jump tmux|zed      enter pulls the agent next to agtc (tmux) or opens its checkout in the editor (zed)
  --inactive           start with inactive sessions shown
  --bell               ring the terminal bell too when a session finishes or needs input unseen
  --no-notify          no macOS notification when a session finishes or needs input off screen
  --force              worktrees rm: remove despite uncommitted or unpushed work
  -h, --help           show this help
  -v, --version        print the version

Environment
  AGTC_EDITOR          editor for the o key (default zed)
  AGTC_WORKTREES       same as --worktrees
  AGTC_BASE            same as --base
  AGTC_JUMP            same as --jump
  AGTC_NOTIFY          0 is the same as --no-notify
  AGTC_TMUX_SETUP      0 leaves tmux alone: no mouse, no prefix-a / option-a bindings
  AGTC_SELECTION       selected code for agtc send

States
  needs input          blocked on a dialog or permission
  done                 turn finished after your last prompt, output not looked at yet
  busy                 working
  idle                 waiting for you, output already seen
  inactive             not running (recent history)

Worktrees
  live                 an agent runs there (shown as its status)
  dirty                uncommitted changes
  unpushed             commits the remote lacks, or a branch never pushed
  pushed               everything on the remote; the branch still exists there
  detached             no branch, commits of its own
  locked               git worktree lock; never touched
  fresh                no commits, no changes: never used         ✓ removable
  gone                 branch deleted on the remote: merged or closed  ✓ removable
  missing              directory gone; prune forgets it, keeps the branch  ✓ removable

"Seen" means the session's Terminal.app tab or tmux window was in front after
the turn finished, or you jumped to it (enter) or marked it (m / M) from here.
Marks persist in ~/.cache/agtc/state.json.`;

export function parseArgs(argv: string[]): Options {
  const has = (...names: string[]) => names.some((name) => argv.includes(name));
  const stringAfter = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("-") ? argv[index + 1] : fallback;
  };
  const numberAfter = (name: string, fallback: number) => {
    const value = Number(stringAfter(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  const command = argv[0]?.startsWith("-") ? undefined : argv[0];
  const commands: Record<string, Mode> = { update: "update", tmux: "tmux", graph: "graph", worktrees: "worktrees", attach: "attach", send: "send" };
  const mode: Mode = has("--help", "-h")
    ? "help"
    : has("--version", "-v")
      ? "version"
      : command !== undefined
        ? (commands[command] ?? "help")
        : has("--json")
          ? "json"
          : has("--once")
            ? "once"
            : "tui";
  const action = command === "worktrees" && (argv[1] === "prune" || argv[1] === "rm") ? argv[1] : undefined;
  const words: string[] = [];
  for (const arg of argv.slice(action ? 2 : 1)) {
    if (arg.startsWith("-")) break;
    words.push(arg);
  }
  const name = action === "rm" ? words[0] : undefined;
  const positional = action === "rm" ? words[1] : words[0];
  const jump = stringAfter("--jump", process.env.AGTC_JUMP);

  return {
    mode,
    days: numberAfter("--days", DEFAULT_DAYS),
    intervalMs: numberAfter("--interval", DEFAULT_INTERVAL_MS),
    showInactive: has("--inactive"),
    bell: has("--bell"),
    notify: !has("--no-notify") && process.env.AGTC_NOTIFY !== "0",
    stagePercent: Math.min(95, numberAfter("--stage", DEFAULT_STAGE_PERCENT)),
    worktrees: stringAfter("--worktrees", process.env.AGTC_WORKTREES),
    base: stringAfter("--base", process.env.AGTC_BASE),
    jump: jump === "zed" ? "zed" : "tmux",
    dir: positional ?? process.cwd(),
    file: stringAfter("--file"),
    row: stringAfter("--row"),
    action,
    name,
    force: has("--force"),
    once: has("--once"),
  };
}

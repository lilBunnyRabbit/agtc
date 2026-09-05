export type Mode = "tui" | "once" | "json" | "help" | "version";

export interface Options {
  mode: Mode;
  /** How far back inactive sessions are listed. */
  days: number;
  intervalMs: number;
  showInactive: boolean;
  bell: boolean;
}

const DEFAULT_DAYS = 2;
const DEFAULT_INTERVAL_MS = 2000;

export const USAGE = `agtc — Agent Traffic Control
Terminal dashboard for local Claude Code and Codex sessions.

Usage
  agtc                 interactive TUI
  agtc --once          print one frame and exit
  agtc --json          dump sessions as JSON

Options
  --days N             list inactive sessions from the last N days (default ${DEFAULT_DAYS})
  --interval MS        poll interval in milliseconds (default ${DEFAULT_INTERVAL_MS})
  --inactive           start with inactive sessions shown
  --bell               ring the terminal bell when a session finishes unseen
  -h, --help           show this help
  -v, --version        print the version

States
  needs input          blocked on a dialog or permission
  done                 turn finished after your last prompt, output not looked at yet
  busy                 working
  idle                 waiting for you, output already seen
  inactive             not running (recent history)

"Seen" means Terminal.app had that session's tab in front after the turn
finished, or you jumped to it (enter) or marked it (m / M) from here.
Marks persist in ~/.cache/agtc/state.json.`;

export function parseArgs(argv: string[]): Options {
  const has = (...names: string[]) => names.some((name) => argv.includes(name));
  const numberAfter = (name: string, fallback: number) => {
    const index = argv.indexOf(name);
    const value = index >= 0 ? Number(argv[index + 1]) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  const mode: Mode = has("--help", "-h")
    ? "help"
    : has("--version", "-v")
      ? "version"
      : has("--json")
        ? "json"
        : has("--once")
          ? "once"
          : "tui";

  return {
    mode,
    days: numberAfter("--days", DEFAULT_DAYS),
    intervalMs: numberAfter("--interval", DEFAULT_INTERVAL_MS),
    showInactive: has("--inactive"),
    bell: has("--bell"),
  };
}

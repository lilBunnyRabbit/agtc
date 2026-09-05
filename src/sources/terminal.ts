import { run } from "../lib/shell";
import { SECOND } from "../lib/time";
import { TtlCache } from "../lib/ttl-cache";
import { listExecutables } from "./processes";

export interface TerminalTab {
  title: string;
  /** Terminal.app is frontmost, this tab's window is frontmost, and the tab is selected. */
  viewed: boolean;
}

/** Terminal.app tabs keyed by tty name, e.g. "ttys004". */
export type TerminalTabs = Map<string, TerminalTab>;

const FIELD_SEPARATOR = "\t";
const FRONTMOST_MARKER = "FRONT";

const runningCache = new TtlCache<string, boolean>(30 * SECOND);

// `pgrep -x Terminal` finds nothing on macOS; match the executable path instead.
function isTerminalRunning(): Promise<boolean> {
  return runningCache.get("terminal", async () => (await listExecutables()).some((exe) => exe.endsWith("/MacOS/Terminal")));
}

/** Emits "FRONT<tab><app frontmost>" then one "tty<tab>windowFrontmost<tab>selected<tab>title" line per tab. */
const LIST_TABS_SCRIPT = `
tell application "Terminal"
  set out to "${FRONTMOST_MARKER}" & (ASCII character 9) & (frontmost as text) & linefeed
  repeat with w in windows
    set wf to frontmost of w
    repeat with t in tabs of w
      set out to out & (tty of t) & (ASCII character 9) & (wf as text) & (ASCII character 9) & ((selected of t) as text) & (ASCII character 9) & (custom title of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;

export async function terminalTabs(): Promise<TerminalTabs> {
  const tabs: TerminalTabs = new Map();
  if (!(await isTerminalRunning())) return tabs;

  let appFrontmost = false;
  for (const line of (await run(["osascript", "-e", LIST_TABS_SCRIPT])).split("\n")) {
    const fields = line.split(FIELD_SEPARATOR);
    if (fields[0] === FRONTMOST_MARKER) {
      appFrontmost = fields[1] === "true";
      continue;
    }
    const [ttyPath, windowFrontmost, selected, title = ""] = fields;
    if (!ttyPath) continue;
    tabs.set(ttyPath.replace("/dev/", ""), {
      title,
      viewed: appFrontmost && windowFrontmost === "true" && selected === "true",
    });
  }
  return tabs;
}

const focusTabScript = (tty: string) => `
tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "/dev/${tty}" then
        set selected of t to true
        set frontmost of w to true
        activate
        return "ok"
      end if
    end repeat
  end repeat
  return ""
end tell`;

/** macOS pseudo-terminal names look like "ttys004". Anything else never reaches the script. */
const TTY_NAME = /^ttys\d+$/;

/** Brings the tab attached to `tty` to the front. False when no such tab exists. */
export async function focusTerminalTab(tty: string): Promise<boolean> {
  if (!TTY_NAME.test(tty)) return false;
  if (!(await isTerminalRunning())) return false;
  return (await run(["osascript", "-e", focusTabScript(tty)])) === "ok";
}

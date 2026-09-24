import { padRight, plural, truncate } from "../lib/text";
import { relativeAge } from "../lib/time";
import { ANSI, style } from "../tui/ansi";
import { STATUS_LABEL, statusStyle, toolIcon } from "../tui/theme";
import { type Worktree, isRemovable } from "./state";

const STATE_WIDTH = 8;
const AGE_WIDTH = 4;
const FILES_WIDTH = "99 files".length;
const AHEAD_WIDTH = "↑9999".length;
const REMOTE_WIDTH = "origin".length;
const MAX_NAME_WIDTH = 40;

export const paint: typeof style = process.stdout.isTTY ? style : (text) => text;

export type Lead = (worktree: Worktree, index: number) => string;

export const tick: Lead = (worktree) => (isRemovable(worktree) ? paint("✓", ANSI.green) : " ") + "   ";

export function formatHeader(worktrees: Worktree[], leadWidth = 4): string {
  const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(...worktrees.map((w) => w.name.length)));
  const cells = [
    " ".repeat(leadWidth + 2),
    padRight("worktree", nameWidth),
    "  ",
    padRight("state", STATE_WIDTH),
    "  ",
    "age".padStart(AGE_WIDTH),
    "  ",
    "changes".padStart(FILES_WIDTH),
    "  ",
    "ahead".padStart(AHEAD_WIDTH),
    "  ",
    padRight("remote", REMOTE_WIDTH),
    "  ",
    "branch · last agent",
  ];
  return paint(cells.join(""), ANSI.dim);
}

export function formatRows(worktrees: Worktree[], lead: Lead = tick, leadWidth = 4): string[] {
  const columns = process.stdout.columns || 120;
  const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(...worktrees.map((w) => w.name.length)));
  const noteWidth = Math.max(10, columns - leadWidth - 2 - nameWidth - STATE_WIDTH - AGE_WIDTH - FILES_WIDTH - AHEAD_WIDTH - REMOTE_WIDTH - 12);
  return worktrees.map((worktree, index) => {
    const [label, ...colour] = stateLabel(worktree);
    const age = worktree.activeAt ? relativeAge(worktree.activeAt) : "";
    return [
      lead(worktree, index),
      worktree.session ? `${toolIcon(worktree.session.tool, worktree.state !== "live")} ` : "  ",
      padRight(worktree.name, nameWidth),
      "  ",
      paint(padRight(label, STATE_WIDTH), ...colour),
      "  ",
      paint(age.padStart(AGE_WIDTH), ANSI.dim),
      "  ",
      filesCell(worktree),
      "  ",
      aheadCell(worktree),
      "  ",
      remoteCell(worktree),
      "  ",
      paint(truncate(noteOf(worktree), noteWidth), ANSI.dim),
    ].join("");
  });
}

function filesCell({ dirty }: Worktree): string {
  return dirty ? paint(plural(dirty, "file", "files").padStart(FILES_WIDTH), ANSI.magenta) : " ".repeat(FILES_WIDTH);
}

function aheadCell({ ahead }: Worktree): string {
  if (!(ahead > 0)) return " ".repeat(AHEAD_WIDTH);
  return paint(`↑${ahead > 9999 ? "9999+" : ahead}`.padStart(AHEAD_WIDTH), ANSI.yellow, ANSI.bold);
}

function remoteCell({ upstream, gone, branch, state }: Worktree): string {
  if (state === "missing" || state === "fresh") return " ".repeat(REMOTE_WIDTH);
  if (!branch) return paint(padRight("none", REMOTE_WIDTH), ANSI.dim);
  if (!upstream) return paint(padRight("local", REMOTE_WIDTH), ANSI.yellow);
  const remote = upstream.replace(/\/.*/, "");
  return gone ? paint(padRight("gone", REMOTE_WIDTH), ANSI.cyan) : paint(padRight(remote, REMOTE_WIDTH), ANSI.green);
}

function noteOf({ name, branch, heldBy, session }: Worktree): string {
  const facts: string[] = [];
  if (heldBy) facts.push(`in ${heldBy}`);
  if (branch && branch !== name && branch.replace(/\//g, "+") !== name) facts.push(branch);
  if (session) facts.push(truncate(session.title, 60));
  return facts.join(" · ");
}

function stateLabel({ state, session }: Worktree): [string, ...string[]] {
  switch (state) {
    case "live":
      return [STATUS_LABEL[session!.status], ...statusStyle(session!.status)];
    case "dirty":
      return [state, ANSI.magenta];
    case "unpushed":
    case "detached":
      return [state, ANSI.yellow];
    case "pushed":
      return [state, ANSI.green];
    case "fresh":
    case "gone":
      return [state, ANSI.cyan];
    case "locked":
    case "missing":
      return [state, ANSI.dim];
  }
}

export function detailOf({ dirty, ahead, upstream }: Worktree): string {
  const facts: string[] = [];
  if (dirty) facts.push(plural(dirty, "file", "files"));
  if (ahead > 0) facts.push(`ahead ${ahead}${upstream ? "" : ", never pushed"}`);
  return facts.join(", ");
}

import { padRight, plural } from "../lib/text";
import type { Session, Status } from "../session";
import { ANSI, style, visibleLength } from "./ansi";
import { type Layout, STATUS_WIDTH } from "./layout";
import { ICON, STATUS_LABEL, needsAttention, statusStyle } from "./theme";

/** Lines of one view's body, with what each line stands for. */
export interface RenderedBody {
  lines: string[];
  /** The session each line belongs to; a repo rule or blank has none. */
  sessions: (Session | undefined)[];
  /** Line index of the selected session, for scrolling. */
  lineOfSelected: number;
}

/** A rule per repository with the counts that want you, then how many sessions it holds. */
export function repoRule(repo: string, sessions: Session[], layout: Layout): string {
  const label = ` ${repo} `;
  const waiting = (["needs input", "done"] as const)
    .map((status) => [status, sessions.filter((s) => s.status === status).length] as const)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => style(` ${n} ${STATUS_LABEL[status]} `, ...statusStyle(status), ANSI.reverse));
  const summary = `${waiting.length ? ` ${waiting.join(" ")}` : ""} ${style(plural(sessions.length, "session", "sessions"), ANSI.dim)}`;
  const rule = ICON.rule.repeat(Math.max(0, layout.columns - label.length - visibleLength(summary) - 1));
  return style(label, ANSI.bold, ANSI.cyan) + style(rule, ANSI.dim) + summary;
}

/** How many live rows get a digit: one key each. */
const JUMP_KEYS = 9;

/** The live sessions the digit keys stage, in list order: row 1 is the first live row on screen. */
export function jumpTargets(visible: Session[]): Session[] {
  return visible.filter((s) => s.status !== "inactive").slice(0, JUMP_KEYS);
}

export function selectionBar(isSelected: boolean): string {
  return isSelected ? style(ICON.selection, ANSI.cyan) : " ";
}

/** The status column: a filled badge when the session wants you, plain colour otherwise. */
export function statusCell(status: Status): string {
  return needsAttention(status)
    ? style(padRight(` ${STATUS_LABEL[status]}`, STATUS_WIDTH), ...statusStyle(status), ANSI.reverse)
    : style(padRight(STATUS_LABEL[status], STATUS_WIDTH), ...statusStyle(status));
}

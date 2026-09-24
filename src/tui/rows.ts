import { padRight, plural } from "../lib/text";
import type { Session, Status } from "../model/session";
import { ANSI, style, visibleLength } from "./ansi";
import { type Layout, STATUS_WIDTH } from "./layout";
import { ICON, STATUS_LABEL, needsAttention, statusStyle } from "./theme";

export interface Hit {
  from: number;
  to: number;
  session: Session;
}

export interface RenderedBody {
  lines: string[];
  hits: Hit[][];
  lineOfSelected: number;
}

export const rowHit = (session: Session | undefined, width: number): Hit[] => (session ? [{ from: 0, to: width, session }] : []);

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

const JUMP_KEYS = 9;

export function jumpTargets(visible: Session[]): Session[] {
  return visible.filter((s) => s.status !== "inactive").slice(0, JUMP_KEYS);
}

export function selectionBar(isSelected: boolean): string {
  return isSelected ? style(ICON.selection, ANSI.cyan) : " ";
}

export function statusCell(status: Status): string {
  return needsAttention(status)
    ? style(padRight(` ${STATUS_LABEL[status]}`, STATUS_WIDTH), ...statusStyle(status), ANSI.reverse)
    : style(padRight(STATUS_LABEL[status], STATUS_WIDTH), ...statusStyle(status));
}

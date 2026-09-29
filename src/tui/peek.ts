import type { Status, Tool } from "../model/session";
import { ANSI, clip, style, visibleLength } from "./ansi";

export interface PeekInfo {
  pane: string;
  title: string;
  status: Status;
  tool: Tool;
  id: string;
  answers: boolean;
  outcome: string;
}

export type PeekOutcome = "go" | "answered";

const CLEAR_LINE = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";
const HOME = "\x1b[H";

export const peekHint = (answers: boolean, settled = false) =>
  settled ? "answered" : answers ? "your keys go to the agent   esc closes, the question stays" : "enter goes there   esc closes";

/** The hint is a bar across the popup, so where the agent's screen ends is plain to see. */
export function renderPeek(captured: string, columns: number, rows: number, hint: string, answers = false): string[] {
  const screen = captured.replace(/\s+$/, "").split("\n");
  const room = Math.max(0, rows - 1);
  const shown = screen.slice(-room).map((line) => (visibleLength(line) > columns ? clip(line, columns) : line));
  const blank = Array.from({ length: room - shown.length }, () => "");
  const bar = clip(` ${hint}`, columns);
  return [...shown, ...blank, style(bar.padEnd(columns), ...(answers ? [ANSI.magenta] : []), ANSI.bold, ANSI.reverse)];
}

/** Over what is there, line by line: clearing the screen first flickers at this pace. */
export const paint = (lines: string[]) => HOME + lines.map((line) => line + ANSI.reset + CLEAR_LINE).join("\n") + CLEAR_BELOW;

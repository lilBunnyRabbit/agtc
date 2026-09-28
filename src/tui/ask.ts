import { collapse, truncate, wrapWords } from "../lib/text";
import { ANSI, style } from "./ansi";
import { MENU_WIDTH } from "./menu";
import type { Prompt } from "./render";
import { ICON } from "./theme";

const MARGIN = 4;
const ROOM = MENU_WIDTH - MARGIN * 2;
const LABEL_LINES = 3;
const MAX_CHOICES = 6;
const MARKER_WIDTH = 2;

/** As many lines whatever the value, so the popup keeps the height it opened with. */
export function renderAsk({ label, value, choices = [] }: Prompt): string[] {
  const flat = collapse(value, value.length + 1);
  // A long path keeps its end, the part that says which checkout it is.
  const shown = flat.length > ROOM - 1 ? `…${flat.slice(flat.length - ROOM + 2)}` : flat;
  const at = choices.indexOf(value);
  const from = Math.max(0, Math.min(at - MAX_CHOICES + 1, choices.length - MAX_CHOICES));
  const list = choices.slice(from, from + MAX_CHOICES).map((choice, index) => {
    const text = truncate(collapse(choice, choice.length + 1), ROOM - MARKER_WIDTH);
    return from + index === at ? style(ICON.selection.padEnd(MARKER_WIDTH), ANSI.cyan) + style(text, ANSI.bold) : " ".repeat(MARKER_WIDTH) + style(text, ANSI.dim);
  });
  const hint = choices.length ? "tab ↑↓ next   enter ok   esc cancel" : "enter ok   esc cancel";
  const lines = [
    "",
    ...wrapWords(label, ROOM, LABEL_LINES).map((line) => style(line, ANSI.bold, ANSI.cyan)),
    `${style(shown, ANSI.yellow)}${style("▏", ANSI.bold)}`,
    ...(list.length ? ["", ...list] : []),
    "",
    style(hint, ANSI.dim),
    "",
  ];
  return lines.map((line) => " ".repeat(MARGIN) + line);
}

import { truncate } from "../lib/text";
import { TOOLS, type Tool } from "../model/session";
import { ANSI, style } from "./ansi";
import { cycleChoice } from "./app/input";
import { Key, isPrintable } from "./keys";
import { ICON } from "./theme";

export type Start = Tool | "terminal";
export const STARTS: Start[] = [...TOOLS, "terminal"];

type Field = "start" | "dir" | "message";
const FIELDS: Field[] = ["start", "dir", "message"];

export interface HomeForm {
  start: Start;
  dir: string;
  dirs: string[];
  message: string;
  field: Field;
  problem?: string;
  /** Bracketed paste: an enter inside it is a line of the message, not a start. */
  pasting?: boolean;
}

export interface HomeInfo extends HomeForm {
  answer: string;
}

export interface HomeChoice {
  start: Start;
  dir: string;
  message: string;
}

export const HOME_WIDTH = 72;
const MARGIN = 2;
const INDENT = "  ";
const ROOM = HOME_WIDTH - MARGIN * 2 - INDENT.length * 2;
const MESSAGE_LINES = 6;
const LABEL_WIDTH = 9;

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
const NEW_LINE_KEYS: string[] = ["\n", Key.altEnter];

const fields = ({ start }: HomeForm) => (start === "terminal" ? FIELDS.slice(0, 2) : FIELDS);

export function homeKey(form: HomeForm, key: string): "edited" | "submit" | "cancel" | "ignored" {
  if (key === PASTE_START || key === PASTE_END) {
    form.pasting = key === PASTE_START;
    return "ignored";
  }
  if (form.pasting && key === Key.enter) key = "\n";
  if (key === Key.escape) return "cancel";
  if (key === Key.enter) return "submit";
  form.problem = undefined;
  const shown = fields(form);
  if (key === Key.up || key === Key.down) {
    const at = shown.indexOf(form.field);
    form.field = shown[(at + (key === Key.down ? 1 : -1) + shown.length) % shown.length];
    return "edited";
  }
  if (form.field === "start") {
    if (key !== Key.left && key !== Key.right && key !== Key.tab && key !== Key.shiftTab) return "ignored";
    const step = key === Key.left || key === Key.shiftTab ? -1 : 1;
    form.start = STARTS[(STARTS.indexOf(form.start) + step + STARTS.length) % STARTS.length];
    return "edited";
  }
  const edit = form.field === "dir" ? "dir" : "message";
  if (edit === "dir" && (key === Key.tab || key === Key.shiftTab)) {
    const prompt = { label: "", value: form.dir, choices: form.dirs };
    cycleChoice(prompt, key === Key.tab ? 1 : -1);
    form.dir = prompt.value;
    return "edited";
  }
  if (key === Key.backspace || key === Key.backspaceAlt) form[edit] = form[edit].slice(0, -1);
  else if (key === Key.ctrlU) form[edit] = "";
  else if (edit === "message" && NEW_LINE_KEYS.includes(key)) form.message += "\n";
  else if (isPrintable(key)) form[edit] += key;
  else return "ignored";
  return "edited";
}

export const homeChoice = ({ start, dir, message }: HomeForm): HomeChoice => ({ start, dir: dir.trim(), message: start === "terminal" ? "" : message.trim() });

function messageLines(message: string, focused: boolean): string[] {
  const lines = (message + (focused ? "▏" : "")).split("\n").flatMap((line) => (line ? (line.match(new RegExp(`.{1,${ROOM - 2}}`, "g")) ?? [""]) : [""]));
  const shown = lines.slice(-MESSAGE_LINES);
  return [...shown, ...Array.from({ length: MESSAGE_LINES - shown.length }, () => "")];
}

function label(name: string, focused: boolean): string {
  return focused ? style(ICON.selection.padEnd(INDENT.length), ANSI.cyan) + style(name.padEnd(LABEL_WIDTH), ANSI.bold, ANSI.cyan) : INDENT + style(name.padEnd(LABEL_WIDTH), ANSI.dim);
}

function startLine(form: HomeForm): string {
  const options = STARTS.map((start) => (start === form.start ? style(` ${start} `, ANSI.bold, ANSI.reverse, ANSI.cyan) : style(` ${start} `, ANSI.dim)));
  return label("start", form.field === "start") + options.join(" ");
}

function dirLine(form: HomeForm): string {
  const room = ROOM - LABEL_WIDTH - 1;
  const shown = form.dir.length > room ? `…${form.dir.slice(form.dir.length - room + 1)}` : form.dir;
  return label("where", form.field === "dir") + style(shown, ANSI.yellow) + (form.field === "dir" ? style("▏", ANSI.bold) : "");
}

function hint(form: HomeForm): string {
  const moves = form.field === "start" ? "←→ pick" : form.field === "dir" ? "tab walks checkouts" : "option-enter new line";
  return `↑↓ field   ${moves}   enter starts   esc closes`;
}

/** As many lines whatever is typed, so the popup keeps the height it opened with. */
export function renderHome(info: HomeInfo): string[] {
  const terminal = info.start === "terminal";
  const focused = info.field === "message";
  const message = terminal
    ? [style("a shell in a new window, nothing sent", ANSI.dim), ...Array.from({ length: MESSAGE_LINES - 1 }, () => "")]
    : messageLines(info.message, focused).map((line) => style(`│ `, focused ? ANSI.cyan : ANSI.dim) + line);
  const lines = [
    "",
    startLine(info),
    "",
    dirLine(info),
    "",
    label("first message", focused),
    ...message.map((line) => INDENT + line),
    "",
    INDENT + (info.problem ? style(truncate(info.problem, ROOM), ANSI.bold, ANSI.magenta) : ""),
    INDENT + style(hint(info), ANSI.dim),
    "",
  ];
  return lines.map((line) => " ".repeat(MARGIN) + line);
}

import { truncate } from "../lib/text";
import type { Status, Tool } from "../model/session";
import { ACTIONS, appliesTo } from "./actions";
import { ANSI, style, visibleLength } from "./ansi";
import { Key } from "./keys";
import { ICON, STATUS_LABEL, statusStyle } from "./theme";

export const MENU_WIDTH = 60;
const MARGIN = 2;
const INDENT = "  ";
const COLUMN_WIDTH = (MENU_WIDTH - MARGIN * 2) / 2;
const KEY_WIDTH = 8;
const DIGIT_WIDTH = 3;
const STATUS_WIDTH = 7;

export interface Other {
  title: string;
  status: Status;
  digit: string;
}

export interface MenuInfo {
  pane: string;
  hub: string;
  where: string;
  others: Other[];
  kind: "agent" | "reviewer" | "none";
  title?: string;
  tool?: Tool;
  id?: string;
  status?: Status;
  branch?: string;
}

/** `hub`: the key goes to agtc, which acts on the pane's row. `own`: an agtc command for the pane. `jump`: the digit, as typed in agtc. */
export interface Action {
  key: string;
  label: string;
  does: "hub" | "own" | "back" | "layout" | "jump";
  command?: string;
  opensPopup?: boolean;
}

interface Group {
  name: string;
  actions: Action[];
}

/** Keys agtc has a command for, so they work in a pane it knows no agent of. */
const OWN_COMMAND: Record<string, string> = { e: "code", o: "edit" };

/** The hub's keys by their letters, as far as they apply to the pane's agent. */
function hubKeys({ kind, status = "idle" }: MenuInfo, keys: string[]): Action[] {
  const applies = appliesTo({ status, reviewer: kind === "reviewer", inTmux: true });
  return keys.flatMap((key) =>
    ACTIONS.filter((action) => action.key === key && (OWN_COMMAND[key] || (kind !== "none" && applies(action)))).map(
      ({ label, opensPopup }): Action => (OWN_COMMAND[key] ? { key, label, does: "own", command: OWN_COMMAND[key] } : { key, label, does: "hub", opensPopup }),
    ),
  );
}

function columns(info: MenuInfo): [Group[], Group[]] {
  const open: Group = { name: "open", actions: hubKeys(info, ["e", "o", "v"]) };
  const move: Group = {
    name: "move",
    actions: [...hubKeys(info, ["J", "K"]), { key: "a", label: "back to agtc", does: "back" }, { key: " ", label: "flip layout", does: "layout" }],
  };
  if (info.kind === "none") return [[open], [move]];
  const agent: Group = { name: info.kind, actions: hubKeys(info, ["V", "x", "X", "m", "c"]) };
  const fresh: Group = { name: "new", actions: hubKeys(info, ["n"]) };
  return [
    [agent, fresh],
    [open, move],
  ];
}

const jumps = ({ others }: MenuInfo): Action[] => others.map(({ digit, title }) => ({ key: digit, label: title, does: "jump" }));

export const menuActions = (info: MenuInfo): Action[] => [...columns(info).flatMap((groups) => groups.flatMap((group) => group.actions)), ...jumps(info)];

const keyName = (key: string) => (key === " " ? "space" : key);

function actionLine({ key, label }: Action, selected: boolean): string {
  const marker = selected ? style(ICON.selection.padEnd(INDENT.length), ANSI.cyan) : INDENT;
  return `${marker}${style(keyName(key).padEnd(KEY_WIDTH), ANSI.bold, ANSI.yellow)}${selected ? style(label, ANSI.bold) : label}`;
}

function columnLines(groups: Group[], selected: Action | undefined): string[] {
  return groups.flatMap((group, index) => [
    ...(index ? [""] : []),
    INDENT + style(group.name.toUpperCase(), ANSI.dim),
    ...group.actions.map((action) => actionLine(action, action.key === selected?.key)),
  ]);
}

/** Arrows walk a column and cross to the other one at the same height; the first press picks the top left. */
export function moveSelection(info: MenuInfo, selected: Action | undefined, key: string): Action | undefined {
  const lists = columns(info).map((groups) => groups.flatMap((group) => group.actions));
  if (!selected) return lists[0][0];
  const column = lists.findIndex((list) => list.some((action) => action.key === selected.key));
  const row = lists[column].findIndex((action) => action.key === selected.key);
  const step = key === Key.up ? -1 : key === Key.down ? 1 : 0;
  if (step) return lists[column][(row + step + lists[column].length) % lists[column].length];
  const other = lists[(column + 1) % lists.length];
  return other[Math.min(row, other.length - 1)];
}

function header({ kind, title, tool, id, status, branch, where }: MenuInfo): string[] {
  const name = style(truncate(kind === "none" ? "no agent in this pane" : (title ?? ""), MENU_WIDTH - MARGIN * 2 - INDENT.length), ANSI.bold, ANSI.cyan);
  const what = [tool, id && style(id, ANSI.dim), status && style(status, ...statusStyle(status)), branch && style(branch, ANSI.cyan)].filter(Boolean).join("  ");
  return [name, ...(what ? [what] : []), where].map((line) => INDENT + line);
}

function otherLines({ others }: MenuInfo): string[] {
  if (!others.length) return [];
  const room = MENU_WIDTH - MARGIN * 2 - INDENT.length - DIGIT_WIDTH - STATUS_WIDTH;
  const rows = others.map(({ digit, status, title }) => {
    const label = style(STATUS_LABEL[status].padEnd(STATUS_WIDTH), ...statusStyle(status));
    return `${INDENT}${style(digit.padEnd(DIGIT_WIDTH), ANSI.bold, ANSI.yellow)}${label}${truncate(title, room)}`;
  });
  return ["", INDENT + style("WAITING FOR YOU", ANSI.dim), ...rows];
}

export function renderMenu(info: MenuInfo, selected?: Action): string[] {
  const [left, right] = columns(info).map((groups) => columnLines(groups, selected));
  const rows = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const cell = left[i] ?? "";
    return `${cell}${" ".repeat(Math.max(1, COLUMN_WIDTH - visibleLength(cell)))}${right[i] ?? ""}`;
  });
  const lines = ["", ...header(info), "", ...rows, ...otherLines(info), "", INDENT + style("↑↓←→ select   enter runs   esc closes", ANSI.dim), ""];
  return lines.map((line) => " ".repeat(MARGIN) + line);
}

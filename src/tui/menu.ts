import { truncate } from "../lib/text";
import type { Status, Tool } from "../model/session";
import { ANSI, style, visibleLength } from "./ansi";
import { Key } from "./keys";
import { ICON, statusStyle } from "./theme";

export const MENU_WIDTH = 60;
const MARGIN = 2;
const INDENT = "  ";
const COLUMN_WIDTH = (MENU_WIDTH - MARGIN * 2) / 2;
const KEY_WIDTH = 8;

export interface MenuInfo {
  pane: string;
  hub: string;
  where: string;
  kind: "agent" | "reviewer" | "none";
  title?: string;
  tool?: Tool;
  id?: string;
  status?: Status;
  branch?: string;
}

/** `hub`: the key goes to agtc, which acts on the pane's row. `own`: an agtc command for the pane. */
export interface Action {
  key: string;
  label: string;
  does: "hub" | "own" | "back" | "layout";
  command?: string;
  asks?: boolean;
  opensPopup?: boolean;
}

interface Group {
  name: string;
  actions: Action[];
}

const hub = (key: string, label: string, extra: Partial<Action> = {}): Action => ({ key, label, does: "hub", ...extra });

/** Letters are the hub's own, so one set serves both. */
function columns({ kind }: MenuInfo): [Group[], Group[]] {
  const open: Group = {
    name: "open",
    actions: [
      { key: "e", label: "vscode", does: "own", command: "code" },
      { key: "o", label: "editor", does: "own", command: "edit" },
      ...(kind === "none" ? [] : [hub("v", "diff", { opensPopup: true })]),
    ],
  };
  const move: Group = {
    name: "move",
    actions: [
      ...(kind === "none" ? [] : [hub("J", "agent above"), hub("K", "agent below")]),
      { key: "a", label: "back to agtc", does: "back" },
      { key: " ", label: "flip layout", does: "layout" },
    ],
  };
  if (kind === "none") return [[open], [move]];
  const agent: Group =
    kind === "reviewer"
      ? { name: "reviewer", actions: [hub("V", "paste report"), hub("x", "close"), hub("m", "mark seen"), hub("c", "copy resume")] }
      : { name: "agent", actions: [hub("V", "review", { asks: true }), hub("X", "close", { asks: true }), hub("m", "mark seen"), hub("c", "copy resume")] };
  const fresh: Group = { name: "new", actions: [hub("n", "agent", { asks: true }), hub("N", "worktree", { asks: true })] };
  return [
    [agent, fresh],
    [open, move],
  ];
}

export const menuActions = (info: MenuInfo): Action[] => columns(info).flatMap((groups) => groups.flatMap((group) => group.actions));

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

export function renderMenu(info: MenuInfo, selected?: Action): string[] {
  const [left, right] = columns(info).map((groups) => columnLines(groups, selected));
  const rows = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
    const cell = left[i] ?? "";
    return `${cell}${" ".repeat(Math.max(1, COLUMN_WIDTH - visibleLength(cell)))}${right[i] ?? ""}`;
  });
  const lines = ["", ...header(info), "", ...rows, "", INDENT + style("↑↓←→ select   enter runs   esc closes", ANSI.dim), ""];
  return lines.map((line) => " ".repeat(MARGIN) + line);
}

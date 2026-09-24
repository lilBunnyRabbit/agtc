import { plural } from "../lib/text";
import { ANSI } from "../tui/ansi";
import { Key } from "../tui/keys";
import { terminalSize } from "../tui/layout";
import { openScreen } from "../tui/terminal";
import type { WorktreeReport } from "./read";
import { removeAll } from "./remove";
import { type Worktree, canRemove, isRemovable } from "./state";
import { formatHeader, formatRows, paint } from "./table";

const LEAD_WIDTH = 7;
const CHROME_LINES = 5;

/**
 * Removable ones start checked, any other that is not live or locked can be checked too and
 * goes with --force. Enter asks once, then leaves the alternate screen so git's lines stay in
 * the scrollback.
 */
export function pickWorktrees(report: WorktreeReport): Promise<number> {
  const { worktrees } = report;
  const out = process.stdout;
  const checked = new Set(worktrees.flatMap((w, i) => (isRemovable(w) ? [i] : [])));
  let cursor = 0;
  let top = 0;
  let confirming = false;

  const draw = () => {
    const { rows } = terminalSize();
    const room = Math.max(1, rows - CHROME_LINES);
    if (cursor < top) top = cursor;
    if (cursor >= top + room) top = cursor - room + 1;
    const forced = [...checked].filter((i) => !isRemovable(worktrees[i])).length;
    const header = `${paint(report.repo, ANSI.bold)}${paint(` · base ${report.base ?? "?"} · ${plural(worktrees.length, "worktree", "worktrees")} · ${checked.size} checked${forced ? ` (${forced} forced)` : ""}`, ANSI.dim)}`;
    const lead = (worktree: Worktree, index: number) => {
      const box = checked.has(index) ? paint("[x]", isRemovable(worktree) ? ANSI.green : ANSI.magenta) : canRemove(worktree) ? "[ ]" : paint("[ ]", ANSI.dim);
      return `${index === cursor ? paint("▸", ANSI.cyan) : " "} ${box}  `;
    };
    const body = formatRows(worktrees, lead, LEAD_WIDTH).slice(top, top + room);
    const footer = confirming
      ? paint(`remove ${plural(checked.size, "worktree", "worktrees")}${forced ? `, ${forced} with uncommitted or unpushed work` : ""}? y/N`, ANSI.bold, ANSI.magenta)
      : paint("space toggle · a all removable · n none · enter remove checked · q quit", ANSI.dim);
    out.write(ANSI.clearScreen + [header, "", formatHeader(worktrees, LEAD_WIDTH), ...body, "", footer].join("\n"));
  };

  return new Promise((resolve) => {
    const screen = openScreen({
      onResize: draw,
      onKey: (key) => {
        if (confirming) {
          confirming = false;
          if (key === "y" || key === "Y") {
            screen.close();
            void removeAll(report, [...checked].sort((a, b) => a - b).map((i) => worktrees[i])).then(resolve);
            return;
          }
          draw();
          return;
        }
        if (key === "q" || key === Key.escape || key === Key.ctrlC) {
          screen.close();
          resolve(0);
          return;
        }
        if (key === "j" || key === Key.down) cursor = Math.min(worktrees.length - 1, cursor + 1);
        else if (key === "k" || key === Key.up) cursor = Math.max(0, cursor - 1);
        else if (key === "g") cursor = 0;
        else if (key === "G") cursor = worktrees.length - 1;
        else if (key === " " && canRemove(worktrees[cursor])) checked.has(cursor) ? checked.delete(cursor) : checked.add(cursor);
        else if (key === "a") worktrees.forEach((w, i) => isRemovable(w) && checked.add(i));
        else if (key === "n") checked.clear();
        else if (key === Key.enter && checked.size) confirming = true;
        draw();
      },
    });
    draw();
  });
}

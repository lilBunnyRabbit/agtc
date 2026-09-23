import { visibleLength } from "./ansi";

/*
 * One list row:
 *
 *    ▌ 3 ⎇  ✳  idle      Title of the session ...................  19h
 *   │ │ │ │  │  │         │                                        │
 *   │ │ │ │  │  status    title (fills the rest)                   age
 *   │ │ │ │  tool icon
 *   │ │ │ worktree icon
 *   │ │ jump digit: the key that stages this session, live rows 1-9
 *   │ selection bar
 *   left margin
 */

export const STATUS_WIDTH = "inactive".length;
export const AGE_WIDTH = "999d".length;
export const DETAIL_INDENT = "  ";
export const MIN_TITLE_WIDTH = 10;

const LEFT_MARGIN = " ";
const RIGHT_MARGIN = " ";
const GAP = "  ";

export interface RowCells {
  bar: string;
  jump: string;
  worktree: string;
  tool: string;
  /** Already padded to STATUS_WIDTH. */
  status: string;
}

/** Everything left of the title. Glyph cells are one column wide; styling is allowed. */
export function rowPrefix({ bar, jump, worktree, tool, status }: RowCells): string {
  return `${LEFT_MARGIN}${bar} ${jump} ${worktree}${GAP}${tool}${GAP}${status}${GAP}`;
}

export function rowSuffix(age: string): string {
  return `${GAP}${age}`;
}

export const BLANK_CELLS: RowCells = { bar: " ", jump: " ", worktree: " ", tool: " ", status: " ".repeat(STATUS_WIDTH) };

export const PREFIX_WIDTH = visibleLength(rowPrefix(BLANK_CELLS));
export const SUFFIX_WIDTH = visibleLength(rowSuffix(" ".repeat(AGE_WIDTH)));
export const RIGHT_MARGIN_WIDTH = RIGHT_MARGIN.length;

export interface Size {
  columns: number;
  rows: number;
}

export interface Layout extends Size {
  titleWidth: number;
  /** Text after the search icon on a match-snippet line. */
  snippetWidth: number;
  /** Text width inside the detail pane. */
  detailWidth: number;
}

export function computeLayout({ columns, rows }: Size): Layout {
  const snippetMarker = 2; // "⌕ "
  return {
    columns,
    rows,
    titleWidth: Math.max(MIN_TITLE_WIDTH, columns - PREFIX_WIDTH - SUFFIX_WIDTH - RIGHT_MARGIN.length),
    snippetWidth: columns - PREFIX_WIDTH - snippetMarker - RIGHT_MARGIN.length,
    detailWidth: columns - DETAIL_INDENT.length * 2,
  };
}

export function terminalSize(): Size {
  return { columns: process.stdout.columns || 140, rows: process.stdout.rows || 40 };
}

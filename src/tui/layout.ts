import { visibleLength } from "./ansi";

/*
 * One list row:
 *
 *    ▌ ⎇  ✳  idle      Title of the session ...................  19h
 *   │ │ │  │  │         │                                        │
 *   │ │ │  │  status    title (fills the rest)                   age
 *   │ │ │  tool icon
 *   │ │ worktree icon
 *   │ selection bar
 *   left margin
 */

export const STATUS_WIDTH = "inactive".length;
export const AGE_WIDTH = "999d".length;
export const DETAIL_INDENT = "  ";
export const MIN_TITLE_WIDTH = 10;
export const PROMPT_AGE_WIDTH = "999d ago".length;

const LEFT_MARGIN = " ";
const RIGHT_MARGIN = " ";
const GAP = "  ";

export interface RowCells {
  bar: string;
  worktree: string;
  tool: string;
  /** Already padded to STATUS_WIDTH. */
  status: string;
}

/** Everything left of the title. Glyph cells are one column wide; styling is allowed. */
export function rowPrefix({ bar, worktree, tool, status }: RowCells): string {
  return `${LEFT_MARGIN}${bar} ${worktree}${GAP}${tool}${GAP}${status}${GAP}`;
}

export function rowSuffix(age: string): string {
  return `${GAP}${age}`;
}

export const BLANK_CELLS: RowCells = { bar: " ", worktree: " ", tool: " ", status: " ".repeat(STATUS_WIDTH) };

const PREFIX_WIDTH = visibleLength(rowPrefix(BLANK_CELLS));
const SUFFIX_WIDTH = visibleLength(rowSuffix(" ".repeat(AGE_WIDTH)));

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
  /** Prompt text width inside the detail pane, after the "↳ " marker and the age column. */
  promptWidth: number;
}

export function computeLayout({ columns, rows }: Size): Layout {
  const snippetMarker = 2; // "⌕ "
  const promptMarker = 2; // "↳ "
  return {
    columns,
    rows,
    titleWidth: Math.max(MIN_TITLE_WIDTH, columns - PREFIX_WIDTH - SUFFIX_WIDTH - RIGHT_MARGIN.length),
    snippetWidth: columns - PREFIX_WIDTH - snippetMarker - RIGHT_MARGIN.length,
    detailWidth: columns - DETAIL_INDENT.length * 2,
    promptWidth: columns - DETAIL_INDENT.length * 2 - promptMarker - PROMPT_AGE_WIDTH - GAP.length,
  };
}

export function terminalSize(): Size {
  return { columns: process.stdout.columns || 140, rows: process.stdout.rows || 40 };
}

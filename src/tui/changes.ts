import { plural, truncate } from "../lib/text";
import { relativeAge } from "../lib/time";
import type { Target } from "../review/comments";
import { ANSI, style } from "./ansi";
import { ICON } from "./theme";

export interface ChangesInfo {
  dir: string;
  where: string;
  base?: string;
  ahead?: number;
  uncommitted?: { files: number; insertions: number; deletions: number };
  keys: string;
  output: string;
}

export interface Pick {
  selected: number;
  comments: number;
}

const MARGIN = 2;
const SHA_WIDTH = 9;
const AGE_WIDTH = 5;
const CHROME_LINES = 6;

export function targets(info: ChangesInfo, commits: Target[]): Target[] {
  const branch: Target[] = info.base && info.ahead ? [{ kind: "branch", base: info.base }] : [];
  const uncommitted: Target[] = info.uncommitted?.files ? [{ kind: "uncommitted" }] : [];
  return [...uncommitted, ...branch, ...commits];
}

/** `git log --format=%h%x1f%s%x1f%ct%x1f%p`: one commit a line, fields apart by the unit separator. */
export function parseLog(log: string): Target[] {
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, seconds, parents] = line.split("\x1f");
      return { kind: "commit", sha, subject, at: Number(seconds) * 1000, parent: !!parents };
    });
}

function describe(target: Target, info: ChangesInfo, width: number, now: number): string {
  if (target.kind === "uncommitted") {
    const { files = 0, insertions = 0, deletions = 0 } = info.uncommitted ?? {};
    return `${"uncommitted".padEnd(SHA_WIDTH + 12)}${plural(files, "file", "files")}  ${style(`+${insertions}`, ANSI.green)} ${style(`−${deletions}`, ANSI.magenta)}`;
  }
  if (target.kind === "branch") return `${"whole branch".padEnd(SHA_WIDTH + 12)}${style(`${plural(info.ahead ?? 0, "commit", "commits")} since ${target.base}`, ANSI.dim)}`;
  const room = width - SHA_WIDTH - AGE_WIDTH;
  return `${style(target.sha.padEnd(SHA_WIDTH), ANSI.yellow)}${truncate(target.subject, room).padEnd(room)}${style(relativeAge(target.at, now).padStart(AGE_WIDTH), ANSI.dim)}`;
}

export function renderChanges(info: ChangesInfo, list: Target[], pick: Pick, columns: number, rows: number, now = Date.now()): string[] {
  const width = Math.max(20, columns - MARGIN * 2 - 2);
  const room = Math.max(1, rows - CHROME_LINES);
  const from = Math.max(0, Math.min(pick.selected - Math.floor(room / 2), list.length - room));
  const lines = list.slice(from, from + room).map((target, index) => {
    const selected = from + index === pick.selected;
    const text = describe(target, info, width, now);
    const gap = target.kind === "commit" && from + index > 0 && list[from + index - 1].kind !== "commit" ? [""] : [];
    return [...gap, (selected ? style(ICON.selection, ANSI.cyan) + " " : "  ") + (selected ? style(text, ANSI.bold) : text)];
  });
  const body = lines.flat().slice(0, room);
  const blank = Array.from({ length: room - body.length }, () => "");
  const count = pick.comments ? style(`${plural(pick.comments, "comment", "comments")} so far`, ANSI.bold, ANSI.yellow) : style("no comments yet", ANSI.dim);
  const hint = style("↑↓ pick   enter opens it in revdiff   esc hands the comments over   Q drops them", ANSI.dim);
  return ["", style(info.where, ANSI.bold, ANSI.cyan), "", ...body, ...blank, count, hint].map((line) => " ".repeat(MARGIN) + line);
}

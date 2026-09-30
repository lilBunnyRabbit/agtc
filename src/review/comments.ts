import { plural } from "../lib/text";

export const REVIEW_TOOL = "revdiff";
export const INSTALL_HINT = "brew install umputun/apps/revdiff";

/** revdiff's own esc only dismisses; mapped to quit, esc closes it like every popup of agtc's. Typing a comment, esc still cancels it. */
export const REVIEW_KEYS = "map esc quit\n";

/** git's empty tree: what a first commit is compared with, having no parent. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type Target =
  | { kind: "uncommitted" }
  | { kind: "branch"; base: string }
  | { kind: "commit"; sha: string; subject: string; parent: boolean; at: number };

export function revdiffArgs(target: Target, keys: string, output: string): string[] {
  const range = target.kind === "commit" ? [target.parent ? `${target.sha}^` : EMPTY_TREE, target.sha] : target.kind === "branch" ? [target.base] : [];
  return [REVIEW_TOOL, ...(target.kind === "commit" ? [] : ["--untracked"]), "--start-at-change", "--keys", keys, "--output", output, ...range];
}

export function targetLabel(target: Target): string {
  if (target.kind === "uncommitted") return "uncommitted changes";
  if (target.kind === "branch") return `everything since ${target.base}, uncommitted included`;
  return `commit ${target.sha} "${target.subject}"`;
}

/** Each visit's comments under what they were written on: a line number means that version of the file. */
export const commentBlock = (target: Target, annotations: string) => `### On ${targetLabel(target)}\n\n${annotations.trim()}\n\n`;

const HEADING = /^## .+$/gm;

export const countComments = (annotations: string) => annotations.match(HEADING)?.length ?? 0;

export function commentsMessage(annotations: string): string {
  const count = countComments(annotations);
  const intro = `My review of your changes, ${plural(count, "comment", "comments")}. Each ### says what I looked at, each ## heading names the file and the line in that version, (+) an added line, (-) a removed one. Work through all of them.`;
  return `${intro}\n\n${annotations.trim()}\n`;
}

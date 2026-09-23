import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { editorArgvAtLine } from "./editor";
import { shellQuote } from "./lib/shell";
import { REPORT_FILE } from "./paths";
import type { Session } from "./session";
import { ANSI, style } from "./tui/ansi";
import { lastAssistantMessage } from "./sources/claude/transcript";
import { lastAgentMessage } from "./sources/codex/rollout";
import { readCodexThreads } from "./sources/codex/threads";

/** What a reviewer said last, complete turns only, read from its own log. */
export function reviewerReport(session: Session): string | undefined {
  if (session.tool === "claude") return lastAssistantMessage(session.id, session.cwd);
  const thread = readCodexThreads().find((t) => t.id === session.id);
  return thread ? lastAgentMessage(thread.rollout_path) : undefined;
}

/** The report as it lands in the reviewed session's input: who it is from, then the text. */
export function reportMessage(reviewer: Session, report: string): string {
  return `Review findings from a ${reviewer.tool} reviewer that saw only the spec and the diff, not this conversation:\n\n${report}\n`;
}

export interface CodeRef {
  /** Relative to the checkout. */
  path: string;
  line: number;
}

/** `path/to/file.ext:line`, as reviewers write findings; a path needs an extension so `host:port` and clock times stay out. */
const CODE_REF = /(?<![\w/.])((?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z]\w*):(\d+)\b/g;

/** The files a report points at, in order of first mention, each once, only ones that exist in `dir`. */
export function codeRefs(report: string, dir: string): CodeRef[] {
  const refs = new Map<string, CodeRef>();
  for (const [, path, line] of report.matchAll(CODE_REF)) {
    const key = `${path}:${line}`;
    if (!refs.has(key) && existsSync(join(dir, path))) refs.set(key, { path, line: Number(line) });
  }
  return [...refs.values()];
}

/** Writes the report for the popup's pager: a title line, then the text with `[n]` after every reference `f` can open. */
export function writeReport(reviewer: Session, report: string, refs: CodeRef[]): string {
  const numbered = report.replace(CODE_REF, (match, path, line) => {
    const at = refs.findIndex((ref) => ref.path === path && ref.line === Number(line));
    return at < 0 ? match : `${match} ${style(`[${at + 1}]`, ANSI.yellow)}`;
  });
  const title = `${style(reviewer.title, ANSI.bold)}${style(` · ${reviewer.tool} · ${reviewer.status}`, ANSI.dim)}`;
  mkdirSync(dirname(REPORT_FILE), { recursive: true });
  writeFileSync(REPORT_FILE, `${title}\n\n${numbered}\n`);
  return REPORT_FILE;
}

/**
 * The popup's shell command: the report in `less`; `q` then a reference's number opens it in
 * the editor and comes back to the report, `q` then enter closes. The editor runs without
 * tmux's variables, so a Zed project opened this way keeps them out of its terminals.
 */
export function findingsCommand(reportPath: string, refs: CodeRef[], dir: string): string {
  const pager = (prompt: string) => `less -R -K -~ -Ps${shellQuote(prompt)} ${shellQuote(reportPath)}`;
  if (!refs.length) return pager(" ↑↓ scroll · q closes ");
  const open = (ref: CodeRef) => ["env", "-u", "TMUX", "-u", "TMUX_PANE", ...editorArgvAtLine(dir, ref.path, ref.line)].map(shellQuote).join(" ");
  const cases = refs.map((ref, i) => `${i + 1}) ${open(ref)};;`);
  return [
    `while ${pager(` ↑↓ scroll · q, then a number opens that [n] in the editor `)}; do`,
    `printf '\\nopen [1-${refs.length}] in the editor, enter closes: '`,
    `read -r n || exit 0`,
    `case "$n" in`,
    `'') exit 0;;`,
    ...cases,
    `esac`,
    `done`,
  ].join("\n");
}

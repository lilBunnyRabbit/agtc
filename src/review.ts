import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shellQuote } from "./lib/shell";
import { PROMPTS_DIR } from "./paths";
import type { Tool } from "./session";

export interface ReviewRequest {
  /** What the work was asked to do, in the author's words or as an `@file` reference. */
  spec: string;
  /** Branch the work will merge into; the diff is taken against it. */
  base?: string;
}

/** Tools a Claude reviewer may use without asking. Everything that writes is disallowed outright. */
const CLAUDE_READ_TOOLS = ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git status:*)", "Bash(git blame:*)"];
const CLAUDE_WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Read(~/.claude/**)", "Read(~/.codex/**)"];

/** The other tool by default: a fresh process of another model shares nothing with the author, not even memory. */
export const reviewerFor = (tool: Tool): Tool => (tool === "claude" ? "codex" : "claude");

export function reviewPrompt({ spec, base }: ReviewRequest): string {
  const scope = base
    ? `Commits: \`git diff ${base}...HEAD\`. Uncommitted work: \`git diff HEAD\` plus untracked files from \`git status\`.`
    : "Uncommitted work: `git diff HEAD` plus untracked files from `git status`, and the recent commits in `git log` that belong to it.";
  return `You review work another agent did in this checkout. You know nothing about that agent's reasoning and you must not go looking for it: never read session transcripts, ~/.claude or ~/.codex.

## Spec

${spec}

## What to review

${scope}
Read as much surrounding code as you need. Judge the code alone: does it do what the spec asks, is it correct, is it safe, does it fit the codebase.

## Rules

- Read-only. Do not edit files, do not run anything that changes the checkout, do not commit or push.
- When the spec is unclear, or the diff cannot be judged without something only the author knows, stop and ask me before concluding.
- Findings only, no praise. Skip formatting unless it changes meaning.

## Report

End with exactly this structure:

## Findings
- path:line · severity (bug, risk, smell) · what is wrong · suggested fix

## Questions
- what you need from the author, or "none"

## Verdict
- ready, or not ready and why
`;
}

/** The prompt goes through a file: the command line stays short and nothing in the spec meets the shell. */
export function writeReviewPrompt(id: string, request: ReviewRequest): string {
  mkdirSync(PROMPTS_DIR, { recursive: true });
  const path = join(PROMPTS_DIR, `review-${id}.md`);
  writeFileSync(path, reviewPrompt(request));
  return path;
}

/** A read-only reviewer: Claude with every writing tool disallowed, Codex in its read-only sandbox. */
export function reviewerCommand(tool: Tool, id: string, promptPath: string): string {
  const prompt = `"$(cat ${shellQuote(promptPath)})"`;
  if (tool === "codex") return `codex --sandbox read-only --ask-for-approval never ${prompt}`;
  const disallowed = shellQuote(CLAUDE_WRITE_TOOLS.join(","));
  const allowed = shellQuote(CLAUDE_READ_TOOLS.join(","));
  return `claude ${prompt} --session-id ${id} --disallowedTools ${disallowed} --allowedTools ${allowed}`;
}

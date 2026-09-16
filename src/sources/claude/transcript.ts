import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseJsonLine, readLinesFrom } from "../../lib/files";
import { CLAUDE_DIR, HOME } from "../../paths";

/** Where a session has been working, read from its transcript as it grows. */
export interface TranscriptActivity {
  /**
   * Absolute paths the session acted on, newest first: every path-like token in a tool call's
   * input, whatever the tool, plus the working directory of that call. Tool agnostic, so an
   * agent that edits through shell commands counts as much as one using the Edit tool.
   */
  paths: string[];
}

interface TranscriptLine {
  cwd?: string;
  message?: { content?: unknown };
}

interface ToolUseBlock {
  type?: string;
  input?: unknown;
}

interface ScanState {
  path: string;
  size: number;
  next: number;
  paths: string[];
}

const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
/** How far back a transcript is read the first time it is seen. */
const FIRST_READ_BYTES = 1024 * 1024;
const KEEP_PATHS = 40;
const MAX_DEPTH = 4;
/** Absolute, home-relative or plain relative paths with at least one separator. */
const PATH_TOKEN = /(?:~|\.{1,2}|[\w.@+-]+)?(?:\/[\w.@+-]+)+/g;
const NO_ACTIVITY: TranscriptActivity = { paths: [] };

/** Claude names a project directory after the cwd with every non-alphanumeric character replaced. */
const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

const pathById = new Map<string, string>();
const scans = new Map<string, ScanState>();

/** Recent activity of a live session. Only lines appended since the last call are read. */
export function transcriptActivity(sessionId: string, cwd: string): TranscriptActivity {
  const path = transcriptPath(sessionId, cwd);
  if (!path) return NO_ACTIVITY;

  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return NO_ACTIVITY;
  }
  let scan = scans.get(sessionId);
  if (!scan || scan.path !== path || size < scan.next) {
    scan = { path, size: -1, next: Math.max(0, size - FIRST_READ_BYTES), paths: [] };
    scans.set(sessionId, scan);
  }
  if (scan.size === size) return { paths: scan.paths };

  const { lines, next } = readLinesFrom(path, scan.next);
  const startedMidLine = scan.size < 0 && scan.next > 0;
  const found: string[] = [];
  for (const line of startedMidLine ? lines.slice(1) : lines) found.push(...pathsOnLine(line, cwd));
  scan.paths = [...found.reverse(), ...scan.paths].slice(0, KEEP_PATHS);
  scan.next = next;
  scan.size = size;
  return { paths: scan.paths };
}

/** Paths a tool call on this line touched, in order of appearance, then its cwd. */
function pathsOnLine(line: string, fallbackCwd: string): string[] {
  const entry = parseJsonLine<TranscriptLine>(line);
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  const cwd = entry?.cwd ?? fallbackCwd;
  const paths = new Set<string>();
  for (const block of content as ToolUseBlock[]) {
    if (block?.type !== "tool_use") continue;
    for (const token of pathTokens(block.input, 0)) paths.add(token.startsWith("~") ? join(HOME, token.slice(1)) : resolve(cwd, token));
    paths.add(cwd);
  }
  return [...paths];
}

function pathTokens(value: unknown, depth: number): string[] {
  if (typeof value === "string") return value.match(PATH_TOKEN) ?? [];
  if (depth >= MAX_DEPTH || !value || typeof value !== "object") return [];
  return Object.values(value).flatMap((v) => pathTokens(v, depth + 1));
}

/** ~/.claude/projects/<slug of cwd>/<id>.jsonl, or wherever else the id turns up. */
function transcriptPath(sessionId: string, cwd: string): string | undefined {
  const known = pathById.get(sessionId);
  if (known) return known;
  const guess = join(PROJECTS_DIR, projectSlug(cwd), `${sessionId}.jsonl`);
  const found = existsSync(guess) ? guess : scanProjects(sessionId);
  if (found) pathById.set(sessionId, found);
  return found;
}

function scanProjects(sessionId: string): string | undefined {
  try {
    for (const dir of readdirSync(PROJECTS_DIR)) {
      const candidate = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    // no projects dir yet
  }
  return undefined;
}

import { type Stats, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseJsonLine, readJson, readTailLines } from "../../lib/files";
import { MINUTE } from "../../lib/time";
import type { Subagent } from "../../session";
import { transcriptPath } from "./transcript";

/** `agent-<id>.meta.json`, written once when the agent is spawned. */
interface AgentMeta {
  agentType?: string;
  description?: string;
  /** 1 for an agent the session spawned itself, 2 for one an agent spawned. */
  spawnDepth?: number;
}

interface AgentLine {
  type?: string;
  timestamp?: string;
  message?: { content?: unknown };
}

interface AgentState {
  status: Subagent["status"];
  since: number;
}

interface Cached extends AgentState {
  size: number;
  mtimeMs: number;
}

/** A finished agent stays in the graph this long: long enough to see the hand-back land. */
const RECENT_MS = 10 * MINUTE;
/** An agent whose log stopped growing this long ago while mid-tool crashed or was orphaned. */
const STALE_MS = 30 * MINUTE;
/** The last entry may be a tool result; a report that long is still read whole. */
const TAIL_BYTES = 256 * 1024;
const META_FILE = /^agent-(.+)\.meta\.json$/;
const INTERRUPTED = "[Request interrupted";

const states = new Map<string, Cached>();

/**
 * Agents a live session spawned itself, running or finished in the last few minutes. Read
 * from `<project>/<sessionId>/subagents/`: the meta file says what and why, the log's last
 * entry says whether it is still going. The parent's tool result is written at launch, so
 * it never says.
 */
export function claudeSubagents(sessionId: string, cwd: string): Subagent[] {
  const transcript = transcriptPath(sessionId, cwd);
  if (!transcript) return [];
  const dir = join(dirname(transcript), sessionId, "subagents");
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const now = Date.now();
  const agents: Subagent[] = [];
  for (const file of files) {
    const id = file.match(META_FILE)?.[1];
    if (!id) continue;
    const meta = readJson<AgentMeta>(join(dir, file));
    if (!meta || (meta.spawnDepth ?? 1) > 1) continue;
    const state = agentState(join(dir, `agent-${id}.jsonl`), join(dir, file));
    if (!state) continue;
    const quietFor = now - state.mtimeMs;
    if (state.status === "done" ? now - state.since > RECENT_MS : quietFor > STALE_MS) continue;
    agents.push({ id, description: meta.description ?? id, kind: meta.agentType, status: state.status, since: state.since });
  }
  return agents.sort((a, b) => a.since - b.since);
}

/** The log's last entry decides, read again only when the file changed. */
function agentState(log: string, metaPath: string): Cached | undefined {
  let stat: Stats;
  try {
    stat = statSync(log);
  } catch {
    return undefined;
  }
  const cached = states.get(log);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached;
  const state: Cached = { ...readState(log, metaPath, stat), size: stat.size, mtimeMs: stat.mtimeMs };
  states.set(log, state);
  return state;
}

/**
 * Finished: a text-only assistant message, or the user interrupting. Anything else, a tool
 * call, its result, a fresh prompt from the parent, an empty log, means it is working.
 */
function readState(log: string, metaPath: string, stat: Stats): AgentState {
  const entry = parseJsonLine<AgentLine>(readTailLines(log, TAIL_BYTES).at(-1) ?? "");
  const content = entry?.message?.content;
  const textOnly = entry?.type === "assistant" && Array.isArray(content) && !content.some((block) => block?.type === "tool_use");
  const interrupted = entry?.type === "user" && typeof content === "string" && content.startsWith(INTERRUPTED);
  if (textOnly || interrupted) return { status: "done", since: entry?.timestamp ? Date.parse(entry.timestamp) : stat.mtimeMs };
  return { status: "busy", since: spawnedAt(metaPath, stat) };
}

function spawnedAt(metaPath: string, fallback: Stats): number {
  try {
    return statSync(metaPath).mtimeMs;
  } catch {
    return fallback.birthtimeMs || fallback.mtimeMs;
  }
}

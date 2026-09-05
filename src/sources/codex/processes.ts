import { run } from "../../lib/shell";
import { listProcesses } from "../processes";

export interface CodexProcess {
  pid: number;
  cwd: string;
  /** Thread the TUI is attached to; absent until the first message creates one. */
  threadId?: string;
}

const CODEX_COMMAND = /(^|\/)codex(\s|$)/;
const CODEX_HELPER = /app-server|remote-control|mcp-server/;
const THREAD_LOCK = /thread-writer-locks\/([0-9a-f-]{36})\.lock$/;

/** Interactive `codex` processes with their cwd and thread. Helper daemons are ignored. */
export async function findCodexProcesses(): Promise<CodexProcess[]> {
  const pids = (await listProcesses())
    .filter(({ command }) => CODEX_COMMAND.test(command) && !CODEX_HELPER.test(command))
    .map(({ pid }) => pid);
  const inspected = await Promise.all(pids.map(inspect));
  return inspected.filter((proc): proc is CodexProcess => proc.cwd !== undefined);
}

/**
 * One lsof call per process: the `cwd` descriptor gives the working directory and the
 * thread-writer-locks/<id>.lock file the TUI keeps open gives the active thread id.
 */
async function inspect(pid: number): Promise<{ pid: number; cwd?: string; threadId?: string }> {
  let cwd: string | undefined;
  let threadId: string | undefined;
  let descriptor = "";
  for (const line of (await run(["lsof", "-p", String(pid), "-Fn"])).split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "f") descriptor = value;
    if (tag !== "n") continue;
    if (descriptor === "cwd") cwd = value;
    threadId = value.match(THREAD_LOCK)?.[1] ?? threadId;
  }
  return { pid, cwd, threadId };
}

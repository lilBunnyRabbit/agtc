import { run } from "../lib/shell";
import { parseElapsed } from "../lib/time";

export interface ProcessInfo {
  tty?: string;
  startedAt: number;
}

export async function processInfo(pids: number[]): Promise<Map<number, ProcessInfo>> {
  const info = new Map<number, ProcessInfo>();
  if (!pids.length) return info;

  const output = await run(["ps", "-o", "pid=,tty=,etime=", "-p", pids.join(",")]);
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)/);
    if (!match) continue;
    const [, pid, tty, etime] = match;
    info.set(Number(pid), { tty: tty === "??" ? undefined : tty, startedAt: Date.now() - parseElapsed(etime) });
  }
  return info;
}

export interface ProcessEntry {
  pid: number;
  command: string;
}

export async function listProcesses(): Promise<ProcessEntry[]> {
  const entries: ProcessEntry[] = [];
  for (const line of (await run(["ps", "-eo", "pid=,args="])).split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match) entries.push({ pid: Number(match[1]), command: match[2] });
  }
  return entries;
}

export async function listExecutables(): Promise<string[]> {
  return (await run(["ps", "-eo", "comm="])).split("\n");
}

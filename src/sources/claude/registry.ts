import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../../lib/files";
import { isProcessAlive } from "../../lib/shell";
import { CLAUDE_DIR } from "../../paths";

export interface ClaudeRegistration {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: "idle" | "busy";
  /** Set while a permission prompt or dialog blocks the session. */
  waitingFor?: string;
  statusUpdatedAt?: number;
  updatedAt?: number;
  startedAt?: number;
}

const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");

export function readClaudeRegistry(): ClaudeRegistration[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  const live: ClaudeRegistration[] = [];
  for (const file of readdirSync(SESSIONS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const registration = readJson<Partial<ClaudeRegistration>>(join(SESSIONS_DIR, file));
    if (!registration?.pid || !registration.sessionId || !registration.cwd) continue;
    if (isProcessAlive(registration.pid)) live.push(registration as ClaudeRegistration);
  }
  return live;
}

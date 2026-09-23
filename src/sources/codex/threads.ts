import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CODEX_DIR } from "../../paths";

/** A row of the `threads` table in ~/.codex/state_*.sqlite. Columns keep their DB names. */
export interface CodexThread {
  id: string;
  cwd: string;
  git_branch: string | null;
  title: string;
  first_user_message: string;
  rollout_path: string;
  /** Unix seconds. */
  updated_at: number;
}

const STATE_DB = /^state_(\d+)\.sqlite$/;

/** Codex keeps one state DB per schema version; the highest number is current. */
function currentStateDb(): string | undefined {
  if (!existsSync(CODEX_DIR)) return undefined;
  const version = (file: string) => Number(file.match(STATE_DB)?.[1] ?? -1);
  const newest = readdirSync(CODEX_DIR)
    .filter((file) => STATE_DB.test(file))
    .sort((a, b) => version(b) - version(a))[0];
  return newest ? join(CODEX_DIR, newest) : undefined;
}

/** Unarchived threads, newest first. A thread appears only after its first message. */
export function readCodexThreads(): CodexThread[] {
  const path = currentStateDb();
  if (!path) return [];
  try {
    const db = new Database(path, { readonly: true });
    try {
      return db
        .query("select id, cwd, git_branch, title, first_user_message, rollout_path, updated_at from threads where archived = 0 order by updated_at desc")
        .all() as CodexThread[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

/** A thread a live thread spawned as a collaborator, from `thread_spawn_edges` joined to `threads`. */
export interface SpawnedThread {
  id: string;
  title: string;
  rollout_path: string;
  agent_nickname: string | null;
  agent_role: string | null;
  agent_path: string | null;
}

/** Threads spawned by `parentId`. Older state DBs have no spawn table: none then. */
export function readSpawnedThreads(parentId: string): SpawnedThread[] {
  const path = currentStateDb();
  if (!path) return [];
  try {
    const db = new Database(path, { readonly: true });
    try {
      return db
        .query(
          `select t.id, t.title, t.rollout_path, t.agent_nickname, t.agent_role, t.agent_path
           from thread_spawn_edges e join threads t on t.id = e.child_thread_id
           where e.parent_thread_id = ?`,
        )
        .all(parentId) as SpawnedThread[];
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

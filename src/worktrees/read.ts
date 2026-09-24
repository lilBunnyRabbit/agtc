import { existsSync } from "node:fs";
import { basename } from "node:path";
import { mapLimit } from "../lib/map-limit";
import { run } from "../lib/shell";
import type { Session } from "../model/session";
import { collectSessions } from "../model/sessions";
import { StateStore } from "../model/state-store";
import { STATE_FILE } from "../paths";
import { baseBranch, gitInfo } from "../sources/git";
import { type ListEntry, STATE_ORDER, type Tracking, type Worktree, stateOf } from "./state";

/*
 * A squash merge leaves none of the branch's commits in the base's history, so "merged" cannot
 * be read from ancestry; it is read from the remote instead: a branch whose upstream is gone
 * was merged or closed there and deleted.
 */

export interface WorktreeReport {
  repo: string;
  mainRoot: string;
  base?: string;
  worktrees: Worktree[];
}

/** Worktrees outlive the list's two days of history; a month still finds the agent that worked in most of them. */
const SESSION_LOOKBACK_DAYS = 30;
/** `git status` in a hundred checkouts at once thrashes the disk; eight at a time is as fast as it gets. */
const CONCURRENCY = 8;
const PROGRESS_THRESHOLD = 10;

export async function readWorktrees(dir: string): Promise<WorktreeReport | undefined> {
  const { repo, mainRoot } = await gitInfo(dir);
  if (!mainRoot) return undefined;
  const git = (...args: string[]) => run(["git", "-C", mainRoot, ...args]);
  const [base, list, refs, sessions] = await Promise.all([
    baseBranch(mainRoot),
    git("worktree", "list", "--porcelain"),
    git("for-each-ref", "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:unix)", "refs/heads"),
    collectSessions({ days: SESSION_LOOKBACK_DAYS, state: StateStore.load(STATE_FILE, { readOnly: true }) }),
  ]);
  const tracking = new Map<string, Tracking>();
  for (const line of refs.split("\n")) {
    const [branch, upstream, track, committed] = line.split("\t");
    if (!branch) continue;
    tracking.set(branch, { upstream: upstream || undefined, gone: track === "[gone]", ahead: Number(track?.match(/ahead (\d+)/)?.[1] ?? 0), committedAt: Number(committed) * 1000 });
  }
  // The main checkout is always listed first.
  const entries = parseWorktreeList(list).slice(1).filter((entry) => !entry.bare);
  const progress = process.stderr.isTTY && entries.length > PROGRESS_THRESHOLD;
  if (progress) process.stderr.write(`reading ${entries.length} worktrees…`);
  const worktrees = await mapLimit(entries, CONCURRENCY, (entry) => describe(entry, { mainRoot, base, tracking, sessions }));
  if (progress) process.stderr.write("\r\x1b[K");
  worktrees.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.activeAt - a.activeAt);
  return { repo, mainRoot, base, worktrees };
}

export function parseWorktreeList(porcelain: string): ListEntry[] {
  return porcelain
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const value = (key: string) => lines.find((line) => line === key || line.startsWith(`${key} `))?.slice(key.length + 1);
      const has = (key: string) => value(key) !== undefined;
      return { dir: value("worktree") ?? "", head: value("HEAD") ?? "", branch: value("branch")?.replace(/^refs\/heads\//, ""), bare: has("bare"), locked: has("locked"), prunable: has("prunable") };
    })
    .filter((entry) => entry.dir);
}

interface RepoContext {
  mainRoot: string;
  base?: string;
  tracking: Map<string, Tracking>;
  sessions: Session[];
}

async function describe(entry: ListEntry, { mainRoot, base, tracking, sessions }: RepoContext): Promise<Worktree> {
  const missing = entry.prunable || !existsSync(entry.dir);
  const track = entry.branch ? tracking.get(entry.branch) : undefined;
  // A branch cut from a local base sits ahead of the remote base by whatever the base has not pushed: only commits
  // nothing else holds are its own. A gone upstream leaves no trace of the last pushed tip, so it is not counted.
  const tracked = !!track?.upstream;
  const own = entry.branch ? [`--exclude=${entry.branch}`] : [];
  const [status, unique, lastCommit] = await Promise.all([
    missing ? "" : run(["git", "-C", entry.dir, "status", "--porcelain"]),
    tracked ? "" : run(["git", "-C", mainRoot, "rev-list", "--count", entry.head, "--not", ...own, "--branches", "--remotes"]),
    track ? "" : run(["git", "-C", mainRoot, "log", "-1", "--format=%ct", entry.head]),
  ]);
  const dirty = status ? status.split("\n").length : 0;
  // An empty count is a failed git call, never zero: it must not read as fresh or gone.
  const ahead = tracked ? track.ahead : unique ? Number(unique) : NaN;
  const holders = ahead === 0 && !track?.upstream ? (await run(["git", "-C", mainRoot, "for-each-ref", "--format=%(refname:short)", `--contains=${entry.head}`, ...own, "refs/heads", "refs/remotes"])).split("\n").filter(Boolean) : [];
  const heldBy = holders.length && !holders.includes(base ?? "") ? holders.find((ref) => !ref.includes("/")) ?? holders[0] : undefined;
  // Sessions come live first, then finished ones newest first, so the first match is the one to show.
  const session = sessions.find((s) => s.root === entry.dir);
  const committedAt = track?.committedAt ?? Number(lastCommit) * 1000;
  return {
    dir: entry.dir,
    name: basename(entry.dir),
    branch: entry.branch,
    head: entry.head,
    state: stateOf({ entry, missing, track, dirty, ahead, live: !!session && session.status !== "inactive" }),
    dirty,
    ahead,
    upstream: track?.upstream,
    gone: !!track?.gone,
    heldBy,
    session,
    activeAt: Math.max(committedAt || 0, session?.since ?? 0),
  };
}

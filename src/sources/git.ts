import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { exec, run } from "../lib/shell";
import { MINUTE, SECOND } from "../lib/time";
import { TtlCache } from "../lib/ttl-cache";

export interface GitInfo {
  /** Main checkout's directory name, or the cwd's name outside git. */
  repo: string;
  /** Linked worktree's directory name, when cwd is one. */
  worktree?: string;
  branch?: string;
  /** Top level of the checkout. Absent outside git. */
  root?: string;
  /** The repository's shared .git directory: equal for a main checkout and all its worktrees. */
  commonDir?: string;
  /** The main checkout, where new worktrees are added from. */
  mainRoot?: string;
}

const infoCache = new TtlCache<string, GitInfo>(30 * SECOND);

export function gitInfo(cwd: string): Promise<GitInfo> {
  return infoCache.get(cwd, () => readGitInfo(cwd));
}

/** What a tmux window in `dir` is called: the repository, plus the worktree when it is one. */
export async function checkoutName(dir: string): Promise<string> {
  const { repo, worktree } = await gitInfo(dir);
  return worktree ? `${repo}/${worktree}` : repo;
}

async function readGitInfo(cwd: string): Promise<GitInfo> {
  const output = await run(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir", "--abbrev-ref", "HEAD"]);
  if (!output) return { repo: basename(cwd) };

  const [top, gitDir, commonDir, ref] = output.split("\n");
  const branch = ref === "HEAD" ? undefined : ref; // detached
  const absolute = (path: string) => (isAbsolute(path) ? path : join(top, path));
  // A linked worktree keeps its own .git dir apart from the repository's common dir.
  const isWorktree = absolute(gitDir) !== absolute(commonDir);
  const mainRoot = isWorktree ? dirname(absolute(commonDir)) : top;
  return {
    repo: basename(mainRoot),
    worktree: isWorktree ? basename(top) : undefined,
    branch,
    root: top,
    commonDir: absolute(commonDir),
    mainRoot,
  };
}

const checkoutsCache = new TtlCache<string, string[]>(30 * SECOND);

/** Every checkout of the repository `root` belongs to, main and linked, deepest path first. */
export function repoCheckouts(root: string): Promise<string[]> {
  return checkoutsCache.get(root, async () => {
    const output = await run(["git", "-C", root, "worktree", "list", "--porcelain"]);
    const paths = output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
    return (paths.length ? paths : [root]).sort((a, b) => b.length - a.length);
  });
}

const rootCache = new Map<string, string>();

/**
 * Nearest checkout containing `start`, found by walking up to a `.git` entry (a directory for
 * a main checkout, a file for a linked worktree). No git call. Hits are cached; misses are
 * not, since a checkout may appear later.
 */
export function gitRootOfDir(start: string): string | undefined {
  const visited: string[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    const hit = rootCache.get(dir);
    if (hit || existsSync(join(dir, ".git"))) {
      const root = hit ?? dir;
      for (const seen of visited) rootCache.set(seen, root);
      rootCache.set(dir, root);
      return root;
    }
    visited.push(dir);
    if (dirname(dir) === dir) return undefined;
  }
}

export interface GitChanges {
  /** Modified, added, deleted or untracked paths relative to the root, most recently touched first. */
  paths: string[];
  insertions: number;
  deletions: number;
  /** Branch the work will merge into, when one could be guessed. */
  base?: string;
  /** Commits on HEAD that `base` lacks. */
  ahead?: number;
}

const MAX_STATTED_PATHS = 50;
const STATUS_LINE = /^[ MADRCU?!]{1,2}\s+(.+)$/;
const changesCache = new TtlCache<string, GitChanges>(10 * SECOND);
const baseCache = new TtlCache<string, string | undefined>(5 * MINUTE);

/** Uncommitted work and commits ahead of the base branch in a checkout. */
export function gitChanges(root: string): Promise<GitChanges> {
  return changesCache.get(root, () => readGitChanges(root));
}

async function readGitChanges(root: string): Promise<GitChanges> {
  const git = (...args: string[]) => run(["git", "-C", root, ...args]);
  const [status, numstat, base] = await Promise.all([git("status", "--porcelain"), git("diff", "HEAD", "--numstat"), baseBranch(root)]);

  // "XY path" or "R  old -> new"; run() trims the output, so the first line may have lost X's leading space.
  const paths = status
    .split("\n")
    .map((line) => line.match(STATUS_LINE)?.[1].replace(/^.* -> /, ""))
    .filter((path): path is string => !!path);

  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.split("\t");
    insertions += Number(added) || 0; // binary files show "-"
    deletions += Number(removed) || 0;
  }

  const aheadCount = base ? Number(await git("rev-list", "--count", `${base}..HEAD`)) : NaN;
  return { paths: byRecency(root, paths), insertions, deletions, base, ahead: Number.isFinite(aheadCount) ? aheadCount : undefined };
}

/** origin's default branch, else a local main or master. */
export function baseBranch(root: string): Promise<string | undefined> {
  return baseCache.get(root, async () => {
    const remoteHead = await run(["git", "-C", root, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"]);
    if (remoteHead) return remoteHead;
    for (const name of ["main", "master"]) {
      if (await run(["git", "-C", root, "rev-parse", "--verify", "-q", name])) return name;
    }
    return undefined;
  });
}

export interface NewWorktree {
  dir: string;
  branch: string;
  base: string;
}

/**
 * Adds a worktree from the main checkout. A branch that already exists is checked out as is,
 * otherwise it is created from `base` (fetched first when it is a remote branch, so the
 * worktree starts from what origin has now). Returns git's message on failure.
 */
export async function createWorktree(mainRoot: string, { dir, branch, base }: NewWorktree): Promise<string | undefined> {
  const git = (...args: string[]) => exec(["git", "-C", mainRoot, ...args]);
  const remote = base.match(/^([^/]+)\/(.+)$/);
  if (remote && (await git("remote", "get-url", remote[1])).ok) await git("fetch", "-q", remote[1], remote[2]);
  const branchExists = (await git("rev-parse", "--verify", "-q", `refs/heads/${branch}`)).ok;
  const result = branchExists ? await git("worktree", "add", dir, branch) : await git("worktree", "add", "-b", branch, dir, base);
  return result.ok ? undefined : result.output;
}

/** Most recently modified first; deleted paths (no mtime) go last. Long lists keep git's order past the cap. */
function byRecency(root: string, paths: string[]): string[] {
  const mtime = (path: string) => {
    try {
      return statSync(join(root, path)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const head = paths.slice(0, MAX_STATTED_PATHS).map((path) => ({ path, at: mtime(path) }));
  return [...head.sort((a, b) => b.at - a.at).map((entry) => entry.path), ...paths.slice(MAX_STATTED_PATHS)];
}

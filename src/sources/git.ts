import { basename, dirname, isAbsolute, join } from "node:path";
import { run } from "../lib/shell";
import { SECOND } from "../lib/time";
import { TtlCache } from "../lib/ttl-cache";

export interface GitInfo {
  /** Main checkout's directory name, or the cwd's name outside git. */
  repo: string;
  /** Linked worktree's directory name, when cwd is one. */
  worktree?: string;
  branch?: string;
}

const cache = new TtlCache<string, GitInfo>(30 * SECOND);

export function gitInfo(cwd: string): Promise<GitInfo> {
  return cache.get(cwd, () => readGitInfo(cwd));
}

async function readGitInfo(cwd: string): Promise<GitInfo> {
  const output = await run(["git", "-C", cwd, "rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir", "--abbrev-ref", "HEAD"]);
  if (!output) return { repo: basename(cwd) };

  const [top, gitDir, commonDir, branch] = output.split("\n");
  const absolute = (path: string) => (isAbsolute(path) ? path : join(top, path));
  // A linked worktree keeps its own .git dir apart from the repository's common dir.
  const isWorktree = absolute(gitDir) !== absolute(commonDir);
  return {
    repo: basename(isWorktree ? dirname(absolute(commonDir)) : top),
    worktree: isWorktree ? basename(top) : undefined,
    branch,
  };
}

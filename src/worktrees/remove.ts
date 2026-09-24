import { exec } from "../lib/shell";
import type { WorktreeReport } from "./read";
import { type Worktree, isRemovable } from "./state";

export interface Outcome {
  line: string;
  error?: true;
}

/**
 * The branch goes with the worktree only when that is safe: `-D` for one gone from the remote
 * (squash-merged commits count as unmerged to git), `-d` for one never committed to, so a
 * mistaken "fresh" still cannot lose work. A missing directory only loses its registration.
 */
export async function remove({ mainRoot, base }: WorktreeReport, worktree: Worktree, force: boolean): Promise<Outcome> {
  const git = (...args: string[]) => exec(["git", "-C", mainRoot, ...args]);
  if (worktree.state === "missing") {
    const pruned = await git("worktree", "prune");
    return pruned.ok ? { line: `forgot ${worktree.name}: directory was gone, branch ${worktree.branch ?? "(detached)"} kept` } : { line: `git: ${pruned.output}`, error: true };
  }
  const removed = await git("worktree", "remove", ...(force ? ["--force"] : []), worktree.dir);
  if (!removed.ok) return { line: `${worktree.name}: ${removed.output}`, error: true };
  const { branch, state } = worktree;
  if (!branch) return { line: `removed ${worktree.name}` };
  const baseName = base?.replace(/^[^/]+\//, "");
  if (branch === baseName || branch === "main" || branch === "master") return { line: `removed ${worktree.name}, branch ${branch} kept` };
  if (state !== "gone" && state !== "fresh") return { line: `removed ${worktree.name}, branch ${branch} kept` };
  const deleted = await git("branch", state === "gone" ? "-D" : "-d", branch);
  return deleted.ok ? { line: `removed ${worktree.name} and branch ${branch}` } : { line: `removed ${worktree.name}, branch ${branch} kept: ${deleted.output}` };
}

export async function removeAll(report: WorktreeReport, doomed: Worktree[], force: (worktree: Worktree) => boolean = (w) => !isRemovable(w)): Promise<number> {
  let failures = 0;
  for (const worktree of doomed) {
    const outcome = await remove(report, worktree, force(worktree));
    if (outcome.error) failures++;
    console.log(outcome.line);
  }
  return failures ? 1 : 0;
}

import { resolve } from "node:path";
import type { Options } from "../cli";
import { plural } from "../lib/text";
import { ANSI } from "../tui/ansi";
import { STATUS_LABEL } from "../tui/theme";
import { pickWorktrees } from "../worktrees/picker";
import { type WorktreeReport, readWorktrees } from "../worktrees/read";
import { remove, removeAll } from "../worktrees/remove";
import { isRemovable } from "../worktrees/state";
import { detailOf, formatHeader, formatRows, paint } from "../worktrees/table";

export async function worktreesCommand({ dir, action, name, force, once }: Options): Promise<number> {
  if (action === "rm" && !name) {
    console.error("agtc worktrees rm NAME [DIR]");
    return 1;
  }
  const report = await readWorktrees(dir);
  if (!report) {
    console.error("not a git checkout");
    return 1;
  }
  if (action === "prune") return pruneWorktrees(report);
  if (action === "rm") return removeWorktree(report, name!, force);
  const interactive = process.stdout.isTTY && process.stdin.isTTY && !once && report.worktrees.length > 0;
  return interactive ? pickWorktrees(report) : listWorktrees(report);
}

function listWorktrees({ repo, base, worktrees }: WorktreeReport): number {
  const removable = worktrees.filter(isRemovable).length;
  const out = [
    `${paint(repo, ANSI.bold)}${paint(` · base ${base ?? "?"} · ${plural(worktrees.length, "worktree", "worktrees")}`, ANSI.dim)}`,
    "",
    ...(worktrees.length ? [formatHeader(worktrees), ...formatRows(worktrees)] : [paint("    no linked worktrees", ANSI.dim)]),
    "",
    removable ? `${removable} removable (✓): agtc worktrees prune` : paint("nothing to prune", ANSI.dim),
  ];
  console.log(out.join("\n"));
  return 0;
}

async function pruneWorktrees(report: WorktreeReport): Promise<number> {
  const doomed = report.worktrees.filter(isRemovable);
  if (!doomed.length) {
    console.log("nothing to prune");
    return 0;
  }
  console.log([formatHeader(doomed), ...formatRows(doomed)].join("\n"));
  console.log("");
  const branches = doomed.filter((w) => w.branch && w.state !== "missing").length;
  const theirs = branches === doomed.length ? (branches === 1 ? "its branch" : "their branches") : plural(branches, "branch", "branches");
  const question = `remove ${plural(doomed.length, "worktree", "worktrees")}${branches ? ` and ${theirs}` : ""}? [y/N] `;
  if (!/^y(es)?$/i.test(prompt(question)?.trim() ?? "")) {
    console.log("kept");
    return 0;
  }
  return removeAll(report, doomed, () => false);
}

async function removeWorktree(report: WorktreeReport, name: string, force: boolean): Promise<number> {
  const target = resolve(name);
  const worktree = report.worktrees.find((w) => w.name === name || w.branch === name || w.dir === target);
  if (!worktree) {
    console.error(`no worktree ${name} in ${report.repo}; agtc worktrees lists them`);
    return 1;
  }
  if (worktree.state === "live") {
    console.error(`${worktree.name}: ${worktree.session!.tool} is ${STATUS_LABEL[worktree.session!.status]} there, quit it first`);
    return 1;
  }
  if (worktree.state === "locked") {
    console.error(`${worktree.name} is locked: git worktree unlock ${worktree.dir}`);
    return 1;
  }
  if (!isRemovable(worktree) && !force) {
    const detail = detailOf(worktree);
    console.error(`${worktree.name} is ${worktree.state}${detail ? ` (${detail})` : ""}: agtc worktrees rm ${name} --force removes it anyway, keeping the branch`);
    return 1;
  }
  const outcome = await remove(report, worktree, force);
  console.log(outcome.line);
  return outcome.error ? 1 : 0;
}

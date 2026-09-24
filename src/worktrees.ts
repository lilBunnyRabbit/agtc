import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Options } from "./cli";
import { exec, run } from "./lib/shell";
import { padRight, plural, truncate } from "./lib/text";
import { relativeAge } from "./lib/time";
import { STATE_FILE } from "./paths";
import { SeenStore } from "./seen-store";
import type { Session } from "./session";
import { collectSessions } from "./sessions";
import { baseBranch, gitInfo } from "./sources/git";
import { ANSI, style } from "./tui/ansi";
import { Key, splitKeys } from "./tui/keys";
import { terminalSize } from "./tui/layout";
import { STATUS_LABEL, statusStyle, toolIcon } from "./tui/theme";

/*
 * `agtc worktrees`: every linked worktree of a repository with what keeps it around, so the
 * ones N and the agents left behind can go. A squash merge leaves none of the branch's
 * commits in the base's history, so "merged" cannot be read from ancestry; it is read from
 * the remote instead: a branch whose upstream is gone was merged or closed there and deleted.
 */

/** Why a worktree is still here, in table order. The last three are safe to remove. */
export type WorktreeState = "live" | "dirty" | "unpushed" | "pushed" | "detached" | "locked" | "fresh" | "gone" | "missing";

const STATE_ORDER: WorktreeState[] = ["live", "dirty", "unpushed", "pushed", "detached", "locked", "fresh", "gone", "missing"];

export interface Worktree {
  dir: string;
  name: string;
  branch?: string;
  head: string;
  state: WorktreeState;
  dirty: number;
  /** Commits the upstream lacks; without an upstream, commits no other branch or remote has. NaN when git could not count. */
  ahead: number;
  upstream?: string;
  /** The upstream branch no longer exists on the remote. */
  gone: boolean;
  /** Another ref that holds every commit of a branch with none of its own, when that ref is not the base. */
  heldBy?: string;
  session?: Session;
  activeAt: number;
}

export interface WorktreeReport {
  repo: string;
  mainRoot: string;
  base?: string;
  worktrees: Worktree[];
}

interface ListEntry {
  dir: string;
  head: string;
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

interface Tracking {
  upstream?: string;
  gone: boolean;
  ahead: number;
  committedAt: number;
}

/** Worktrees outlive the list's two days of history; a month still finds the agent that worked in most of them. */
const SESSION_LOOKBACK_DAYS = 30;
/** `git status` in a hundred checkouts at once thrashes the disk; eight at a time is as fast as it gets. */
const CONCURRENCY = 8;
const STATE_WIDTH = 8;
const AGE_WIDTH = 4;
const FILES_WIDTH = "99 files".length;
const AHEAD_WIDTH = "↑9999".length;
const REMOTE_WIDTH = "origin".length;
const MAX_NAME_WIDTH = 40;

export const isRemovable = ({ state }: Worktree) => state === "fresh" || state === "gone" || state === "missing";

export async function worktreesCommand({ dir, action, name, force, mode }: Options): Promise<number> {
  if (action === "prune") return pruneWorktrees(dir);
  if (action === "rm") {
    if (name) return removeWorktree(dir, name, force);
    console.error("agtc worktrees rm NAME [DIR]");
    return 1;
  }
  return process.stdout.isTTY && process.stdin.isTTY && !action && mode === "worktrees" && !process.argv.includes("--once") ? pickWorktrees(dir) : listWorktrees(dir);
}

export async function readWorktrees(dir: string): Promise<WorktreeReport | undefined> {
  const { repo, mainRoot } = await gitInfo(dir);
  if (!mainRoot) return undefined;
  const git = (...args: string[]) => run(["git", "-C", mainRoot, ...args]);
  const [base, list, refs, sessions] = await Promise.all([
    baseBranch(mainRoot),
    git("worktree", "list", "--porcelain"),
    git("for-each-ref", "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(committerdate:unix)", "refs/heads"),
    collectSessions({ days: SESSION_LOOKBACK_DAYS, seen: SeenStore.load(STATE_FILE, { readOnly: true }) }),
  ]);
  const tracking = new Map<string, Tracking>();
  for (const line of refs.split("\n")) {
    const [branch, upstream, track, committed] = line.split("\t");
    if (!branch) continue;
    tracking.set(branch, { upstream: upstream || undefined, gone: track === "[gone]", ahead: Number(track?.match(/ahead (\d+)/)?.[1] ?? 0), committedAt: Number(committed) * 1000 });
  }
  // The main checkout is always listed first.
  const entries = parseWorktreeList(list).slice(1).filter((entry) => !entry.bare);
  // A big monorepo's `git status` is slow across a hundred checkouts; say so rather than look hung.
  if (process.stderr.isTTY && entries.length > 10) process.stderr.write(`reading ${entries.length} worktrees…`);
  const worktrees = await mapLimit(entries, CONCURRENCY, (entry) => describe(entry, { mainRoot, base, tracking, sessions }));
  if (process.stderr.isTTY && entries.length > 10) process.stderr.write("\r\x1b[K");
  worktrees.sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.activeAt - a.activeAt);
  return { repo, mainRoot, base, worktrees };
}

function parseWorktreeList(porcelain: string): ListEntry[] {
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

interface StateInput {
  entry: ListEntry;
  missing: boolean;
  track?: Tracking;
  dirty: number;
  ahead: number;
  live: boolean;
}

function stateOf({ entry, missing, track, dirty, ahead, live }: StateInput): WorktreeState {
  if (entry.locked) return "locked";
  if (missing) return "missing";
  if (live) return "live";
  if (dirty) return "dirty";
  if (track?.gone) return "gone";
  if (track?.upstream) return ahead > 0 ? "unpushed" : "pushed";
  if (ahead === 0) return "fresh";
  return entry.branch ? "unpushed" : "detached";
}

async function listWorktrees(dir: string): Promise<number> {
  const report = await readWorktrees(dir);
  if (!report) {
    console.error("not a git checkout");
    return 1;
  }
  const { repo, base, worktrees } = report;
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

async function pruneWorktrees(dir: string): Promise<number> {
  const report = await readWorktrees(dir);
  if (!report) {
    console.error("not a git checkout");
    return 1;
  }
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
  let failures = 0;
  for (const worktree of doomed) {
    const outcome = await remove(report, worktree, false);
    if (outcome.error) failures++;
    console.log(outcome.line);
  }
  return failures ? 1 : 0;
}

async function removeWorktree(dir: string, name: string, force: boolean): Promise<number> {
  const report = await readWorktrees(dir);
  if (!report) {
    console.error("not a git checkout");
    return 1;
  }
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
    console.error(`${worktree.name} is ${worktree.state}${detailOf(worktree) ? ` (${detailOf(worktree)})` : ""}: agtc worktrees rm ${name} --force removes it anyway, keeping the branch`);
    return 1;
  }
  const outcome = await remove(report, worktree, force);
  console.log(outcome.line);
  return outcome.error ? 1 : 0;
}

/**
 * Removes the worktree and, when it is safe, its branch: `-D` for one gone from the remote
 * (squash-merged commits count as unmerged to git), `-d` for one never committed to, so a
 * mistaken "fresh" still cannot lose work. A missing directory only loses its registration.
 */
async function remove({ mainRoot, base }: WorktreeReport, worktree: Worktree, force: boolean): Promise<{ line: string; error?: true }> {
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

const tick = (worktree: Worktree) => (isRemovable(worktree) ? paint("✓", ANSI.green) : " ") + "   ";

/** Column labels, laid out like a row so they sit over the cells. */
function formatHeader(worktrees: Worktree[], leadWidth = 4): string {
  const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(...worktrees.map((w) => w.name.length)));
  const cells = [
    " ".repeat(leadWidth + 2),
    padRight("worktree", nameWidth),
    "  ",
    padRight("state", STATE_WIDTH),
    "  ",
    "age".padStart(AGE_WIDTH),
    "  ",
    "changes".padStart(FILES_WIDTH),
    "  ",
    "ahead".padStart(AHEAD_WIDTH),
    "  ",
    padRight("remote", REMOTE_WIDTH),
    "  ",
    "branch · last agent",
  ];
  return paint(cells.join(""), ANSI.dim);
}

function formatRows(worktrees: Worktree[], lead: (worktree: Worktree, index: number) => string = tick, leadWidth = 4): string[] {
  const columns = process.stdout.columns || 120;
  const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(...worktrees.map((w) => w.name.length)));
  const noteWidth = Math.max(10, columns - leadWidth - 2 - nameWidth - STATE_WIDTH - AGE_WIDTH - FILES_WIDTH - AHEAD_WIDTH - REMOTE_WIDTH - 12);
  return worktrees.map((worktree, index) => {
    const [label, ...colour] = stateLabel(worktree);
    const age = worktree.activeAt ? relativeAge(worktree.activeAt) : "";
    return [
      lead(worktree, index),
      worktree.session ? `${toolIcon(worktree.session.tool, worktree.state !== "live")} ` : "  ",
      padRight(worktree.name, nameWidth),
      "  ",
      paint(padRight(label, STATE_WIDTH), ...colour),
      "  ",
      paint(age.padStart(AGE_WIDTH), ANSI.dim),
      "  ",
      filesCell(worktree),
      "  ",
      aheadCell(worktree),
      "  ",
      remoteCell(worktree),
      "  ",
      paint(truncate(noteOf(worktree), noteWidth), ANSI.dim),
    ].join("");
  });
}

function filesCell({ dirty }: Worktree): string {
  return dirty ? paint(plural(dirty, "file", "files").padStart(FILES_WIDTH), ANSI.magenta) : " ".repeat(FILES_WIDTH);
}

function aheadCell({ ahead }: Worktree): string {
  if (!(ahead > 0)) return " ".repeat(AHEAD_WIDTH);
  return paint(`↑${ahead > 9999 ? "9999+" : ahead}`.padStart(AHEAD_WIDTH), ANSI.yellow, ANSI.bold);
}

/** Where the branch stands on the remote: pushed there, deleted there, or never sent. */
function remoteCell({ upstream, gone, branch, state }: Worktree): string {
  if (state === "missing" || state === "fresh") return " ".repeat(REMOTE_WIDTH);
  if (!branch) return paint(padRight("none", REMOTE_WIDTH), ANSI.dim);
  if (!upstream) return paint(padRight("local", REMOTE_WIDTH), ANSI.yellow);
  const remote = upstream.replace(/\/.*/, "");
  return gone ? paint(padRight("gone", REMOTE_WIDTH), ANSI.cyan) : paint(padRight(remote, REMOTE_WIDTH), ANSI.green);
}

/** The dim tail: which ref holds a fresh one, the branch when the directory is not named after it, the last agent's title. */
function noteOf({ name, branch, heldBy, session }: Worktree): string {
  const facts: string[] = [];
  if (heldBy) facts.push(`in ${heldBy}`);
  if (branch && branch !== name && branch.replace(/\//g, "+") !== name) facts.push(branch);
  if (session) facts.push(truncate(session.title, 60));
  return facts.join(" · ");
}

function stateLabel({ state, session }: Worktree): [string, ...string[]] {
  switch (state) {
    case "live":
      return [STATUS_LABEL[session!.status], ...statusStyle(session!.status)];
    case "dirty":
      return [state, ANSI.magenta];
    case "unpushed":
    case "detached":
      return [state, ANSI.yellow];
    case "pushed":
      return [state, ANSI.green];
    case "fresh":
    case "gone":
      return [state, ANSI.cyan];
    case "locked":
    case "missing":
      return [state, ANSI.dim];
  }
}

/** What stands in the way of removing it, for the rm refusal. */
function detailOf({ dirty, ahead, upstream }: Worktree): string {
  const facts: string[] = [];
  if (dirty) facts.push(plural(dirty, "file", "files"));
  if (ahead > 0) facts.push(`ahead ${ahead}${upstream ? "" : ", never pushed"}`);
  return facts.join(", ");
}

const paint: typeof style = process.stdout.isTTY ? style : (text) => text;

const canRemove = ({ state }: Worktree) => state !== "live" && state !== "locked";

/**
 * The list with a checkbox per row: removable ones start checked, any other that is not
 * live or locked can be checked too and goes with --force. Enter asks once, then leaves
 * the alternate screen so git's lines stay in the scrollback.
 */
async function pickWorktrees(dir: string): Promise<number> {
  const report = await readWorktrees(dir);
  if (!report) {
    console.error("not a git checkout");
    return 1;
  }
  const { worktrees } = report;
  if (!worktrees.length) return listWorktrees(dir);
  const out = process.stdout;
  const checked = new Set(worktrees.flatMap((w, i) => (isRemovable(w) ? [i] : [])));
  let cursor = 0;
  let top = 0;
  let confirming = false;

  const draw = () => {
    const { rows } = terminalSize();
    const room = Math.max(1, rows - 5);
    if (cursor < top) top = cursor;
    if (cursor >= top + room) top = cursor - room + 1;
    const forced = [...checked].filter((i) => !isRemovable(worktrees[i])).length;
    const header = `${paint(report.repo, ANSI.bold)}${paint(` · base ${report.base ?? "?"} · ${plural(worktrees.length, "worktree", "worktrees")} · ${checked.size} checked${forced ? ` (${forced} forced)` : ""}`, ANSI.dim)}`;
    const lead = (worktree: Worktree, index: number) => {
      const box = checked.has(index) ? paint("[x]", isRemovable(worktree) ? ANSI.green : ANSI.magenta) : canRemove(worktree) ? "[ ]" : paint("[ ]", ANSI.dim);
      return `${index === cursor ? paint("▸", ANSI.cyan) : " "} ${box}  `;
    };
    const body = formatRows(worktrees, lead, 7).slice(top, top + room);
    const footer = confirming
      ? paint(`remove ${plural(checked.size, "worktree", "worktrees")}${forced ? `, ${forced} with uncommitted or unpushed work` : ""}? y/N`, ANSI.bold, ANSI.magenta)
      : paint("space toggle · a all removable · n none · enter remove checked · q quit", ANSI.dim);
    out.write(ANSI.clearScreen + [header, "", formatHeader(worktrees, 7), ...body, "", footer].join("\n"));
  };

  const finish = (): Promise<number> =>
    new Promise((resolve) => {
      const leave = () => {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        out.write(ANSI.showCursor + ANSI.altScreenOff);
      };
      const done = (code: number) => {
        leave();
        resolve(code);
      };
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk: string) => {
        for (const key of splitKeys(chunk)) {
          if (confirming) {
            confirming = false;
            if (key === "y" || key === "Y") {
              leave();
              void removeChecked(report, [...checked].sort((a, b) => a - b).map((i) => worktrees[i])).then(resolve);
              return;
            }
            draw();
            continue;
          }
          if (key === "q" || key === Key.escape || key === Key.ctrlC) return done(0);
          if (key === "j" || key === Key.down) cursor = Math.min(worktrees.length - 1, cursor + 1);
          else if (key === "k" || key === Key.up) cursor = Math.max(0, cursor - 1);
          else if (key === "g") cursor = 0;
          else if (key === "G") cursor = worktrees.length - 1;
          else if (key === " " && canRemove(worktrees[cursor])) checked.has(cursor) ? checked.delete(cursor) : checked.add(cursor);
          else if (key === "a") worktrees.forEach((w, i) => isRemovable(w) && checked.add(i));
          else if (key === "n") checked.clear();
          else if (key === Key.enter && checked.size) confirming = true;
          draw();
        }
      });
      out.write(ANSI.altScreenOn + ANSI.hideCursor);
      out.on("resize", draw);
      draw();
    });
  const code = await finish();
  return code;
}

async function removeChecked(report: WorktreeReport, doomed: Worktree[]): Promise<number> {
  let failures = 0;
  for (const worktree of doomed) {
    const outcome = await remove(report, worktree, !isRemovable(worktree));
    if (outcome.error) failures++;
    console.log(outcome.line);
  }
  return failures ? 1 : 0;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

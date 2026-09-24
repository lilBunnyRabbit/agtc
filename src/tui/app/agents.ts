import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { collapse, plural, tildify, untildify } from "../../lib/text";
import { type Session, type Tool, resumeInvocation, workDir } from "../../model/session";
import { HOME } from "../../paths";
import { baseBranch, checkoutName, createWorktree } from "../../sources/git";
import { OWN_PANE, tmuxHasSession } from "../../tmux/env";
import { HUB_SESSION } from "../../tmux/hub";
import { restoreHub } from "../../tmux/restore";
import { newTmuxWindow, splitPane } from "../../tmux/windows";
import type { AppContext } from "./context";
import { showPane } from "./stage";

const DEFAULT_WORKTREES_DIR = join(".claude", "worktrees");

export interface Target {
  /** Undefined inside tmux: an unnamed target lets tmux pick agtc's own session. */
  session?: string;
}

export interface Launch {
  tool: Tool;
  dir: string;
  tmuxSession: string | undefined;
  command?: string;
  name?: string;
  beside?: string;
  note?: string;
}

export async function tmuxTarget(session: Session): Promise<Target | undefined> {
  if (session.tmux && !OWN_PANE) return { session: session.tmux.session };
  return hubTarget();
}

export async function hubTarget(): Promise<Target | undefined> {
  if (OWN_PANE) return {};
  return (await tmuxHasSession(HUB_SESSION)) ? { session: HUB_SESSION } : undefined;
}

export async function startAgent(ctx: AppContext, { tool, dir, tmuxSession, command = tool, name, beside, note = "" }: Launch): Promise<string | undefined> {
  const paneId = beside ? await splitPane(beside, dir, command) : await newTmuxWindow(dir, command, tmuxSession, name ?? (await checkoutName(dir)));
  if (!paneId) {
    ctx.say(`could not open tmux ${beside ? "pane" : "window"} in ${tildify(dir, HOME)}`);
    return undefined;
  }
  ctx.say(`started ${tool} in ${tildify(dir, HOME)}${note}`);
  await showPane(ctx, paneId);
  ctx.refreshSoon();
  return paneId;
}

export function newAgent(ctx: AppContext, session: Session): void {
  void tmuxTarget(session).then((target) => {
    if (!target) {
      ctx.say("n needs a tmux session: run `agtc tmux`");
      return;
    }
    const choices = knownCheckouts(ctx, session).map((dir) => tildify(dir, HOME));
    ctx.ask({ label: `new ${session.tool} in`, value: choices[0], choices }, (value) => {
      const dir = untildify(value.trim(), HOME);
      if (!dir) return;
      if (!existsSync(dir)) {
        ctx.say(`no such directory: ${tildify(dir, HOME)}`);
        return;
      }
      void startAgent(ctx, { tool: session.tool, dir, tmuxSession: target.session });
    });
  });
}

function knownCheckouts(ctx: AppContext, session: Session): string[] {
  const dirs = new Set([workDir(session)]);
  const sameRepoFirst = [...ctx.sessions].sort((a, b) => Number(b.repo === session.repo) - Number(a.repo === session.repo));
  for (const s of sameRepoFirst) {
    if (s.mainRoot) dirs.add(s.mainRoot);
    dirs.add(workDir(s));
  }
  return [...dirs].filter((dir) => existsSync(dir));
}

/**
 * `N`: a fresh worktree of the session's repository, then an agent in it. Lives outside Zed's
 * worktree directory, so Zed never archives it. A directory name swaps "/" for "+", like Claude Code does.
 */
export function newWorktree(ctx: AppContext, session: Session): void {
  const { mainRoot } = session;
  if (!mainRoot) {
    ctx.say("not a git checkout");
    return;
  }
  void tmuxTarget(session).then((target) => {
    if (!target) {
      ctx.say("N needs a tmux session: run `agtc tmux`");
      return;
    }
    ctx.ask({ label: "new worktree branch" }, (name) => {
      const branch = name.trim();
      if (!branch) return;
      const dir = join(worktreesDir(ctx, mainRoot), branch.replace(/\//g, "+"));
      if (existsSync(dir)) {
        ctx.say(`already exists: ${tildify(dir, HOME)}`);
        return;
      }
      void createAndStart(ctx, session, mainRoot, dir, branch, target.session);
    });
  });
}

async function createAndStart(ctx: AppContext, session: Session, mainRoot: string, dir: string, branch: string, tmuxSession: string | undefined): Promise<void> {
  const base = ctx.options.base ?? (await baseBranch(mainRoot)) ?? "HEAD";
  ctx.say(`creating ${tildify(dir, HOME)} from ${base}…`);
  const error = await createWorktree(mainRoot, { dir, branch, base });
  if (error) {
    ctx.say(`git: ${collapse(error, 160)}`);
    return;
  }
  await startAgent(ctx, { tool: session.tool, dir, tmuxSession, note: ` (${branch} from ${base})` });
}

function worktreesDir(ctx: AppContext, mainRoot: string): string {
  const configured = ctx.options.worktrees ?? DEFAULT_WORKTREES_DIR;
  return isAbsolute(configured) ? configured : join(mainRoot, configured);
}

/**
 * `R`: a finished session again inside tmux, where attach and send can reach it. One still
 * running in a Terminal.app tab has to be quit there first: two processes on one session id
 * would write the same transcript.
 */
export function resumeInTmux(ctx: AppContext, session: Session): void {
  if (session.tmux) {
    ctx.say("already in tmux");
    return;
  }
  if (session.status !== "inactive") {
    ctx.say(`still running in ${session.tty ?? "another terminal"}: quit it there, then R`);
    return;
  }
  if (!existsSync(session.cwd)) {
    ctx.say(`directory is gone: ${tildify(session.cwd, HOME)}`);
    return;
  }
  void tmuxTarget(session).then(async (target) => {
    if (!target) {
      ctx.say("R needs a tmux session: run `agtc tmux`");
      return;
    }
    const paneId = await newTmuxWindow(session.cwd, resumeInvocation(session), target.session, await checkoutName(session.cwd));
    if (!paneId) {
      ctx.say("could not open tmux window");
      return;
    }
    ctx.say(`resumed ${session.tool} in ${tildify(session.cwd, HOME)}`);
    await showPane(ctx, paneId);
    ctx.refreshSoon();
  });
}

export function missingFromLastHub(ctx: AppContext) {
  const running = new Set(ctx.sessions.filter((s) => s.status !== "inactive").map((s) => s.id));
  return ctx.state.lastHub().filter((w) => !running.has(w.id));
}

export function restoreLastHub(ctx: AppContext): void {
  const missing = missingFromLastHub(ctx);
  if (!missing.length) {
    ctx.say("nothing to restore: every agent of the last hub is running");
    return;
  }
  void hubTarget().then(async (target) => {
    if (!target) {
      ctx.say("S needs a tmux session: run `agtc tmux`");
      return;
    }
    ctx.say(`restoring ${missing.length} ${plural(missing.length, "agent", "agents")}…`);
    const { opened, skipped } = await restoreHub(ctx.state.lastHub(), ctx.sessions, target.session);
    const gone = skipped.filter((w) => !existsSync(w.cwd)).length;
    ctx.say(`restored ${opened.length}${gone ? `, ${gone} skipped, directory gone` : ""}`);
    ctx.refreshSoon();
  });
}

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyToClipboard } from "../../lib/shell";
import { collapse, tildify } from "../../lib/text";
import { type Session, type Tool, isTool } from "../../model/session";
import { reviewerFor } from "../../model/tools";
import { HOME } from "../../paths";
import { reviewerCommand, writeReviewPrompt } from "../../review/prompt";
import { reportMessage, reviewerReport } from "../../review/report";
import { resolveSpec, specPath, specRequest } from "../../review/spec";
import { baseBranch, checkoutName } from "../../sources/git";
import { killPane, pasteIntoPane } from "../../tmux/windows";
import { startAgent, tmuxTarget } from "./agents";
import type { AppContext } from "./context";
import { existingWorkDir, showPane } from "./stage";

/**
 * `V`: a second agent reads the session's work against its spec and reports, read-only. Its
 * process is fresh, so the author's reasoning never reaches it; the other tool by default, so
 * not even memory does. It opens beside the session's pane, so both are on screen.
 */
export function startReviewer(ctx: AppContext, session: Session): void {
  const running = ctx.sessions.find((s) => s.reviewOf === session.id && s.status !== "inactive");
  if (running) {
    ctx.say(`${running.tool} is still reviewing this: quit it first`);
    return;
  }
  const dir = existingWorkDir(ctx, session);
  if (!dir) return;
  void tmuxTarget(session).then((target) => {
    if (!target) {
      ctx.say("V needs a tmux session: run `agtc tmux`");
      return;
    }
    const written = specPath(session.id);
    const askAuthor = `ask ${session.tool} for a spec`;
    const prompts = [session.firstPrompt, session.lastPrompt].filter((p): p is string => !!p && !p.startsWith("/"));
    const choices = [...new Set([...(existsSync(written) ? [tildify(written, HOME)] : []), askAuthor, ...prompts])];
    ctx.ask({ label: "spec (text, @file)", value: choices[0], choices }, (answer) => {
      if (answer.trim() === askAuthor) return requestSpec(ctx, session, written);
      const spec = resolveSpec(answer);
      if (!spec) return;
      const tools = [reviewerFor(session.tool), session.tool];
      ctx.ask({ label: "reviewer", value: tools[0], choices: tools }, (tool) => {
        if (!isTool(tool)) {
          ctx.say(`unknown tool: ${tool}`);
          return;
        }
        void launchReviewer(ctx, session, dir, spec, tool, target.session);
      });
    });
  });
}

/** The author knows what was built: the request lands in its input, you send it, `V` again once the file exists. */
function requestSpec(ctx: AppContext, session: Session, path: string): void {
  void handTo(ctx, session, specRequest(path)).then((where) => {
    if (where === "pane") ctx.say(`spec request in "${collapse(session.title, 40)}": enter there, then V again`);
    else if (where === "clipboard") ctx.say(session.status === "inactive" ? "spec request copied: R resumes the session, paste it there" : "spec request copied: the session runs outside tmux, paste it there");
  });
}

async function launchReviewer(ctx: AppContext, session: Session, dir: string, spec: string, tool: Tool, tmuxSession: string | undefined): Promise<void> {
  const id = randomUUID();
  const base = session.changes?.base ?? (await baseBranch(dir));
  const promptPath = writeReviewPrompt(id, { spec, base });
  const paneId = await startAgent(ctx, {
    tool,
    dir,
    tmuxSession,
    command: reviewerCommand(tool, id, promptPath),
    name: `${await checkoutName(dir)} review`,
    beside: session.tmux?.paneId,
    note: ` to review "${collapse(session.title, 40)}"`,
  });
  if (!paneId) return;
  ctx.state.rememberReview({ id: tool === "claude" ? id : undefined, pane: paneId, of: session.id, at: Date.now() });
}

/** `x`: only reviewers, nothing else agtc started is read-only. */
export function closeReviewer(ctx: AppContext, session: Session): void {
  if (!session.reviewOf) {
    ctx.say("x closes reviewers only: quit other agents in their own window");
    return;
  }
  if (session.status === "inactive") {
    ctx.say("not running");
    return;
  }
  if (!session.tmux) {
    ctx.say(`runs outside tmux in ${session.tty ?? "another terminal"}: quit it there`);
    return;
  }
  if (session.status === "done") {
    ctx.say("unread report: V hands it over, m drops it, then x");
    return;
  }
  const { paneId } = session.tmux;
  void killPane(paneId).then((ok) => {
    ctx.say(ok ? `closed ${session.tool} reviewer` : `tmux pane ${paneId} not found`);
    if (ok) ctx.refreshSoon();
  });
}

/** Text into a session's input, unsent. One the paste cannot reach gets it on the clipboard. */
async function handTo(ctx: AppContext, session: Session, text: string): Promise<"pane" | "clipboard" | undefined> {
  if (session.status === "inactive" || !session.tmux) {
    copyToClipboard(text);
    return "clipboard";
  }
  const { paneId } = session.tmux;
  if (!(await pasteIntoPane(paneId, text))) {
    ctx.say(`could not paste into tmux pane ${paneId}`);
    return undefined;
  }
  await showPane(ctx, paneId);
  return "pane";
}

export function reportFindings(ctx: AppContext, reviewer: Session): void {
  const subject = ctx.sessions.find((s) => s.id === reviewer.reviewOf);
  if (!subject) {
    ctx.say("the reviewed session is not in the list");
    return;
  }
  if (reviewer.status === "busy") {
    ctx.say("reviewer still working");
    return;
  }
  if (reviewer.status === "needs input") {
    ctx.say("reviewer is waiting on you: enter to answer it");
    return;
  }
  const report = reviewerReport(reviewer);
  if (!report) {
    ctx.say("no report yet: the reviewer has not finished a turn");
    return;
  }
  ctx.markSeen(reviewer);
  void handTo(ctx, subject, reportMessage(reviewer, report)).then((where) => {
    if (where === "pane") ctx.say(`report pasted into "${collapse(subject.title, 40)}": read it, then enter`);
    else if (where === "clipboard") ctx.say(subject.status === "inactive" ? "report copied: R resumes the session, then paste" : `report copied: "${collapse(subject.title, 40)}" runs outside tmux, paste it there`);
  });
}



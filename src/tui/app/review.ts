import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { copyToClipboard, shellQuote, succeeds } from "../../lib/shell";
import { collapse, plural, tildify } from "../../lib/text";
import { type Session, type Tool, isTool } from "../../model/session";
import { reviewerFor } from "../../model/tools";
import { HOME } from "../../paths";
import { INSTALL_HINT, REVIEW_KEYS, REVIEW_TOOL, commentsMessage, countComments } from "../../review/comments";
import { reviewerCommand, writeReviewPrompt } from "../../review/prompt";
import { reportMessage, reviewerReport } from "../../review/report";
import { resolveSpec, specPath, specRequest } from "../../review/spec";
import { baseBranch, checkoutName } from "../../sources/git";
import { postToInbox } from "../../sources/claude/inbox";
import { OWN_PANE, agtcShell } from "../../tmux/env";
import type { ChangesInfo } from "../changes";
import { killPane, pasteIntoPane, tmuxPopup } from "../../tmux/windows";
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
    if (where === "inbox") ctx.say(`spec request sent to "${collapse(session.title, 40)}": V again once the file exists`);
    else if (where === "pane") ctx.say(`spec request in "${collapse(session.title, 40)}": enter there, then V again`);
    else if (where === "clipboard") ctx.say(session.status === "inactive" ? "spec request copied: R resumes the session, paste it there" : "spec request copied: the session runs outside tmux, paste it there");
  });
}

async function launchReviewer(ctx: AppContext, session: Session, dir: string, spec: string, tool: Tool, tmuxSession: string | undefined): Promise<void> {
  const id = randomUUID();
  const base = session.changes?.base ?? (await baseBranch(dir));
  const name = `${await checkoutName(dir)} review`;
  const promptPath = writeReviewPrompt(id, { spec, base, author: tool === "claude" ? session.name : undefined });
  const paneId = await startAgent(ctx, {
    tool,
    dir,
    tmuxSession,
    command: reviewerCommand(tool, id, promptPath, name),
    name,
    beside: session.tmux?.paneId,
    note: ` to review "${collapse(session.title, 40)}"`,
  });
  if (!paneId) return;
  ctx.state.rememberReview({ id: tool === "claude" ? id : undefined, pane: paneId, of: session.id, at: Date.now() });
}

/** `x`: only reviewers, nothing else agtc started is read-only. */
export function closeReviewer(ctx: AppContext, session: Session): void {
  if (!session.reviewOf) {
    ctx.say("x closes reviewers only: X closes an agent and its window");
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

type HandedTo = "inbox" | "held" | "pane" | "clipboard" | undefined;

/**
 * A Claude session takes text on its inbox and acts on it. Any other gets it typed into its
 * input, unsent; one the paste cannot reach gets it on the clipboard.
 */
async function handTo(ctx: AppContext, session: Session, text: string): Promise<HandedTo> {
  if (session.status !== "inactive" && session.inbox && session.pid) {
    const delivery = await postToInbox({ pid: session.pid, socket: session.inbox }, text);
    if (delivery === "delivered") {
      if (session.tmux) await showPane(ctx, session.tmux.paneId);
      return "inbox";
    }
    if (delivery !== "unreachable") {
      copyToClipboard(text);
      ctx.say(`"${collapse(session.title, 40)}" ${delivery} the message${delivery === "held" ? ", it wants its user's approval first" : ""}: copied, paste it there`);
      return "held";
    }
  }
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

/** `v`: what changed, uncommitted, the whole branch or one commit, in revdiff. Comments from every visit add up and go to the session's input, unsent. */
export async function reviewChanges(ctx: AppContext, session: Session, from?: string): Promise<void> {
  if (!OWN_PANE) return ctx.say("v needs agtc inside tmux: run `agtc tmux`");
  const dir = existingWorkDir(ctx, session);
  if (!dir) return;
  if (!(await succeeds(["which", REVIEW_TOOL]))) return ctx.say(`${REVIEW_TOOL} not found: ${INSTALL_HINT}`);
  const keys = join(tmpdir(), "agtc-revdiff-keys");
  writeFileSync(keys, REVIEW_KEYS);
  const { changes, branch } = session;
  const info: ChangesInfo = {
    dir,
    where: [tildify(dir, HOME), branch].filter(Boolean).join(" · "),
    base: changes?.base,
    ahead: changes?.ahead,
    uncommitted: changes && { files: changes.paths.length, insertions: changes.insertions, deletions: changes.deletions },
    keys,
    output: join(tmpdir(), `agtc-comments-${randomUUID()}.md`),
  };
  const command = `${agtcShell()} changes ${shellQuote(Buffer.from(JSON.stringify(info)).toString("base64url"))}`;
  await ctx.behindPopup(tmuxPopup(dir, command, `review · ${basename(dir)}`, from));
  const annotations = existsSync(info.output) ? readFileSync(info.output, "utf8") : "";
  rmSync(info.output, { force: true });
  const count = countComments(annotations);
  if (!count) return ctx.say("no comments");
  const where = await handTo(ctx, session, commentsMessage(annotations));
  const comments = plural(count, "comment", "comments");
  if (where === "inbox") ctx.say(`${comments} sent to "${collapse(session.title, 40)}"`);
  else if (where === "pane") ctx.say(`${comments} pasted into "${collapse(session.title, 40)}": enter there sends them`);
  else if (where === "clipboard") ctx.say(`${comments} copied: the session is out of reach, paste them there`);
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
    if (where === "inbox") ctx.say(`report sent to "${collapse(subject.title, 40)}"`);
    else if (where === "pane") ctx.say(`report pasted into "${collapse(subject.title, 40)}": read it, then enter`);
    else if (where === "clipboard") ctx.say(subject.status === "inactive" ? "report copied: R resumes the session, then paste" : `report copied: "${collapse(subject.title, 40)}" runs outside tmux, paste it there`);
  });
}



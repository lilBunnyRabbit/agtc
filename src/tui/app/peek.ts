import { peekInPopup } from "../../commands/peek";
import type { Session } from "../../model/session";
import { OWN_PANE } from "../../tmux/env";
import type { AppContext } from "./context";
import { focus } from "./stage";

const reachable = (ctx: AppContext, session: Session): string | undefined => {
  if (!OWN_PANE) return void ctx.say("needs agtc inside tmux: run `agtc tmux`");
  if (!session.tmux || session.status === "inactive") return void ctx.say("no tmux pane to look at");
  return OWN_PANE;
};

export function peek(ctx: AppContext, session: Session, from?: string): void {
  const hub = reachable(ctx, session);
  if (!hub) return;
  void ctx.behindPopup(peekInPopup(from ?? hub, session)).then((outcome) => {
    if (outcome === "go") focus(ctx, session);
    if (outcome === "answered") void ctx.refresh();
  });
}

/** One question after the other while you keep answering; esc leaves the rest for later. */
export function answerNext(ctx: AppContext, from?: string, skip = new Set<string>()): void {
  const session = ctx.sessions.find((s) => s.status === "needs input" && s.tmux && !skip.has(s.id));
  if (!session) return ctx.say(skip.size ? "nothing else needs input" : "nothing needs input");
  const hub = reachable(ctx, session);
  if (!hub) return;
  ctx.select(session);
  void ctx.behindPopup(peekInPopup(from ?? hub, session)).then(async (outcome) => {
    if (outcome !== "answered") return;
    await ctx.refresh();
    answerNext(ctx, from, skip.add(session.id));
  });
}

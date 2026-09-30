import { homeInPopup } from "../../commands/home";
import { shellQuote } from "../../lib/shell";
import { tildify, untildify } from "../../lib/text";
import { type Session, workDir } from "../../model/session";
import { HOME } from "../../paths";
import { checkoutName } from "../../sources/git";
import { OWN_PANE, tmux } from "../../tmux/env";
import { newTmuxWindow } from "../../tmux/windows";
import type { HomeChoice } from "../home";
import { hubTarget, knownCheckouts, newAgent, startAgent } from "./agents";
import type { AppContext } from "./context";
import { showPane } from "./stage";

/** `n` and option-n: a new agent with its first message, or a shell, from any pane. Starts with the pane's agent and checkout. */
export function openHome(ctx: AppContext, session: Session | undefined, from?: string): void {
  if (!OWN_PANE) {
    if (session) newAgent(ctx, session);
    else ctx.say("n needs a tmux session: run `agtc tmux`");
    return;
  }
  const over = from ?? OWN_PANE;
  void (async () => {
    const here = session ? workDir(session) : await tmux("display", "-p", "-t", over, "#{pane_current_path}");
    const dirs = knownCheckouts(ctx, here, session?.repo).map((dir) => tildify(dir, HOME));
    const form = { start: session?.tool ?? "claude", dir: dirs[0] ?? tildify(here, HOME), dirs, message: "", field: "message" as const };
    const choice = await ctx.behindPopup(homeInPopup(over, form));
    if (choice) await start(ctx, choice);
  })();
}

async function start(ctx: AppContext, { start, dir: typed, message }: HomeChoice): Promise<void> {
  const target = await hubTarget();
  if (!target) return ctx.say("n needs a tmux session: run `agtc tmux`");
  const dir = untildify(typed, HOME);
  if (start !== "terminal") {
    await startAgent(ctx, { tool: start, dir, tmuxSession: target.session, command: message ? `${start} ${shellQuote(message)}` : start });
    return;
  }
  const paneId = await newTmuxWindow(dir, "", target.session, await checkoutName(dir));
  if (!paneId) return ctx.say(`could not open tmux window in ${tildify(dir, HOME)}`);
  ctx.say(`opened a shell in ${tildify(dir, HOME)}`);
  await showPane(ctx, paneId);
}

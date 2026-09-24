import { existsSync } from "node:fs";
import { basename } from "node:path";
import { openInEditor } from "../../desktop/editor";
import { shellQuote } from "../../lib/shell";
import { tildify } from "../../lib/text";
import { type Session, resumeCommand, workDir } from "../../model/session";
import { HOME } from "../../paths";
import { focusTerminalTab } from "../../sources/terminal";
import { OWN_PANE } from "../../tmux/env";
import { focusTmuxPane } from "../../tmux/stage";
import { tmuxPopup } from "../../tmux/windows";
import { writeHelp } from "../help";
import { jumpTargets } from "../rows";
import type { AppContext } from "./context";

export function focus(ctx: AppContext, session: Session): void {
  if (ctx.options.jump === "zed") {
    ctx.markSeen(session);
    openEditor(ctx, session);
    return;
  }
  const { tty, tmux } = session;
  if (!tty) {
    ctx.say(`not in a terminal. resume: ${resumeCommand(session)}`);
    return;
  }
  ctx.markSeen(session);
  ctx.say(`focusing ${tty}…`);
  if (tmux) {
    void focusTmuxPane(tmux.paneId, ctx.options.stagePercent).then((ok) => {
      ctx.say(ok ? `focused ${tty}` : `tmux pane ${tmux.paneId} not found`);
      if (ok && tmux.clientTty) void focusTerminalTab(tmux.clientTty);
    });
    return;
  }
  void focusTerminalTab(tty).then((found) => ctx.say(found ? `focused ${tty}` : `tab for ${tty} not found`));
}

/** In zed mode panes stay in their own windows, so a Zed terminal attached to one keeps it. */
export async function showPane(ctx: AppContext, paneId: string): Promise<void> {
  if (ctx.options.jump === "tmux") await focusTmuxPane(paneId, ctx.options.stagePercent);
}

/** `J` / `K`: the live row above or below, wrapping around. Up is j, down is k, everywhere in agtc. */
export function jumpBy(ctx: AppContext, step: 1 | -1): void {
  const rows = ctx.visible;
  if (!rows.length) return;
  for (let n = 1; n <= rows.length; n++) {
    const index = (ctx.ui.selected + step * n + rows.length * n) % rows.length;
    if (rows[index].status === "inactive") continue;
    ctx.select(rows[index]);
    focus(ctx, rows[index]);
    return;
  }
  ctx.say("nothing running");
}

export function jumpTo(ctx: AppContext, digit: number): void {
  const target = jumpTargets(ctx.visible)[digit - 1];
  if (!target) {
    ctx.say(`no row ${digit}`);
    return;
  }
  ctx.select(target);
  focus(ctx, target);
}

export function existingWorkDir(ctx: AppContext, session: Session): string | undefined {
  const dir = workDir(session);
  if (existsSync(dir)) return dir;
  ctx.say(`directory is gone: ${tildify(dir, HOME)}`);
  return undefined;
}

export function openEditor(ctx: AppContext, session: Session): void {
  const dir = existingWorkDir(ctx, session);
  if (!dir) return;
  ctx.state.markOpened(dir, session.id);
  const command = openInEditor(session);
  ctx.say(command ? `opened: ${command}` : "editor not found. Set AGTC_EDITOR.");
}

export function showHelp(ctx: AppContext): void {
  const path = writeHelp();
  const pager = `less -R -K -~ -Ps${shellQuote(" ↑↓ scroll · q closes ")} ${shellQuote(path)}`;
  void tmuxPopup(HOME, pager, "agtc keys · q closes").then((ok) => ctx.say(ok ? "" : "could not open popup"));
}

export function reviewDiff(ctx: AppContext, session: Session): void {
  if (!OWN_PANE) {
    ctx.say("v needs agtc inside tmux: run `agtc tmux`");
    return;
  }
  const dir = existingWorkDir(ctx, session);
  if (!dir) return;
  const command = `command -v lazygit >/dev/null && exec lazygit || exec git diff HEAD`;
  ctx.say(`reviewing ${tildify(dir, HOME)}…`);
  void tmuxPopup(dir, command, basename(dir)).then((ok) => ctx.say(ok ? "" : "could not open popup"));
}

import { basename } from "node:path";
import { succeeds } from "../lib/shell";
import { popupBehind, popupFrame } from "../commands/menu";
import { OWN_PANE, tmux } from "./env";

export async function newTmuxWindow(cwd: string, command: string, session?: string, name = basename(cwd)): Promise<string | undefined> {
  const target = session ? ["-t", `${session}:`] : [];
  const paneId = await tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-c", cwd, "-n", name, ...target);
  if (!paneId) return undefined;
  if (command) await succeeds(["tmux", "send-keys", "-t", paneId, command, "Enter"]);
  return paneId;
}

export async function splitPane(pane: string, cwd: string, command: string): Promise<string | undefined> {
  const paneId = await tmux("split-window", "-d", "-h", "-P", "-F", "#{pane_id}", "-c", cwd, "-t", pane);
  if (!paneId) return undefined;
  await succeeds(["tmux", "send-keys", "-t", paneId, command, "Enter"]);
  return paneId;
}

/** By pane id, never by window: the pane may be on agtc's stage. */
export function killPane(paneId: string): Promise<boolean> {
  return succeeds(["tmux", "kill-pane", "-t", paneId]);
}

export async function panesOf(pane: string): Promise<string[]> {
  return (await tmux("list-panes", "-t", pane, "-F", "#{pane_id}")).split("\n").filter(Boolean);
}

/** Pane by pane, never kill-window: a staged pane sits in agtc's window. The window goes with its last pane. */
export async function killWindowOf(paneId: string): Promise<string[]> {
  const panes = (await panesOf(paneId)).filter((id) => id !== OWN_PANE);
  const killed = await Promise.all(panes.map(killPane));
  return panes.filter((_, index) => killed[index]);
}

/** Bracketed paste, so newlines do not submit. */
export async function pasteIntoPane(paneId: string, text: string): Promise<boolean> {
  const buffer = `agtc-${process.pid}`;
  const loaded = Bun.spawnSync(["tmux", "load-buffer", "-b", buffer, "-"], { stdin: new TextEncoder().encode(text) }).exitCode === 0;
  return loaded && succeeds(["tmux", "paste-buffer", "-p", "-d", "-b", buffer, "-t", paneId]);
}

const POPUP_SIZE = "95%";

export function tmuxPopup(cwd: string, command: string, title: string, over = OWN_PANE): Promise<boolean> {
  const popup = [...popupFrame(POPUP_SIZE, POPUP_SIZE), "-d", cwd, "-T", `#[fg=cyan,bold,reverse] ${title.replaceAll("#", "##")} #[default]`, command];
  return over ? popupBehind(over, popup) : succeeds(["tmux", "display-popup", "-E", ...popup]);
}

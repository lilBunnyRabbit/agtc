import { basename } from "node:path";
import { succeeds } from "../lib/shell";
import { tmux } from "./env";

export async function newTmuxWindow(cwd: string, command: string, session?: string, name = basename(cwd)): Promise<string | undefined> {
  const target = session ? ["-t", `${session}:`] : [];
  const paneId = await tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-c", cwd, "-n", name, ...target);
  if (!paneId) return undefined;
  await succeeds(["tmux", "send-keys", "-t", paneId, command, "Enter"]);
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

/** Bracketed paste, so newlines do not submit. */
export async function pasteIntoPane(paneId: string, text: string): Promise<boolean> {
  const buffer = `agtc-${process.pid}`;
  const loaded = Bun.spawnSync(["tmux", "load-buffer", "-b", buffer, "-"], { stdin: new TextEncoder().encode(text) }).exitCode === 0;
  return loaded && succeeds(["tmux", "paste-buffer", "-p", "-d", "-b", buffer, "-t", paneId]);
}

const POPUP_SIZE = "95%";

export function tmuxPopup(cwd: string, command: string, title: string): Promise<boolean> {
  return succeeds(["tmux", "display-popup", "-E", "-d", cwd, "-w", POPUP_SIZE, "-h", POPUP_SIZE, "-T", ` ${title} `, command]);
}

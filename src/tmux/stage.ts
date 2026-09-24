import { basename } from "node:path";
import { succeeds } from "../lib/shell";
import { WINDOW_NAME_OPTION } from "../sources/tmux";
import { OWN_PANE, tmux } from "./env";

const SEP = "\t";

/**
 * Inside tmux, agtc's window is the hub: the pane takes the stage next to agtc and whatever
 * was on stage goes back to a window of its own. A pane brings the rest of its window along
 * (a reviewer split beside its subject), and a stage of several panes leaves together.
 * Outside tmux the pane's window is selected in its session.
 */
export async function focusTmuxPane(paneId: string, stagePercent: number): Promise<boolean> {
  if (!OWN_PANE) {
    return (await succeeds(["tmux", "select-window", "-t", paneId])) && succeeds(["tmux", "select-pane", "-t", paneId]);
  }
  const hubPanes = await panesOf(OWN_PANE);
  if (hubPanes.includes(paneId)) return succeeds(["tmux", "select-pane", "-t", paneId]);

  // The pane's window is lost once it leaves, so remember the name for the trip back.
  const incoming = await panesOf(paneId);
  const name = await tmux("display", "-p", "-t", paneId, "#{window_name}");
  for (const pane of incoming) await succeeds(["tmux", "set-option", "-p", "-t", pane, WINDOW_NAME_OPTION, name]);

  const staged = hubPanes.filter((id) => id !== OWN_PANE);
  if (staged.length === 1 && incoming.length === 1) {
    // Swapping keeps the hub layout as the user left it; the old stage inherits the newcomer's window.
    const [stagedName, stagedPath] = await stagedWindowName(staged[0]);
    if (!(await succeeds(["tmux", "swap-pane", "-Z", "-s", paneId, "-t", staged[0]]))) return false;
    await succeeds(["tmux", "rename-window", "-t", staged[0], stagedName || basename(stagedPath)]);
    return succeeds(["tmux", "select-pane", "-t", paneId]);
  }

  if (staged.length) await unstage(staged);
  // Panes join in their window's order, so a reviewer stays right of its subject whichever one was asked for.
  const [first, ...rest] = incoming;
  if (!(await succeeds(["tmux", "join-pane", "-d", "-h", "-l", `${stagePercent}%`, "-s", first, "-t", OWN_PANE]))) return false;
  await joinBeside(first, rest);
  return succeeds(["tmux", "select-pane", "-t", paneId]);
}

async function panesOf(pane: string): Promise<string[]> {
  return (await tmux("list-panes", "-t", pane, "-F", "#{pane_id}")).split("\n").filter(Boolean);
}

async function stagedWindowName(pane: string): Promise<[name: string, path: string]> {
  const [name, path] = (await tmux("display", "-p", "-t", pane, `#{${WINDOW_NAME_OPTION}}${SEP}#{pane_current_path}`)).split(SEP);
  return [name, path];
}

async function unstage([first, ...rest]: string[]): Promise<void> {
  const [name, path] = await stagedWindowName(first);
  await succeeds(["tmux", "break-pane", "-d", "-s", first, "-n", name || basename(path)]);
  await joinBeside(first, rest);
}

async function joinBeside(pane: string, panes: string[]): Promise<void> {
  let left = pane;
  for (const next of panes) {
    await succeeds(["tmux", "join-pane", "-d", "-h", "-s", next, "-t", left]);
    left = next;
  }
}

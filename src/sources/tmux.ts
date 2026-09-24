import { tmux } from "../tmux/env";
import type { Surfaces } from "./types";

const SEP = "\t";
const CLIENT_FORMAT = ["#{client_tty}", "#{client_session}"].join(SEP);
export const WINDOW_NAME_OPTION = "@agtc_window";
const PANE_FORMAT = [
  "#{pane_tty}",
  "#{pane_id}",
  "#{session_name}",
  "#{window_id}",
  "#{window_index}",
  "#{window_active}",
  `#{${WINDOW_NAME_OPTION}}`,
  "#{window_name}",
  "#{pane_title}",
].join(SEP);

const ttyName = (path: string) => path.replace("/dev/", "");

/**
 * A pane is viewed when its window is the current one of a session some client shows. A client
 * sitting in a Terminal.app tab counts only while that tab is in front; any other client
 * (Zed, Ghostty, ...) always counts.
 */
export async function tmuxPanes(tabs: Surfaces): Promise<Surfaces> {
  const panes: Surfaces = new Map();
  const clientTty = new Map<string, string>();
  const watched = new Set<string>();
  for (const line of (await tmux("list-clients", "-F", CLIENT_FORMAT)).split("\n")) {
    const [ttyPath, session] = line.split(SEP);
    if (!ttyPath) continue;
    clientTty.set(session, ttyName(ttyPath));
    const tab = tabs.get(ttyName(ttyPath));
    if (!tab || tab.viewed) watched.add(session);
  }

  for (const line of (await tmux("list-panes", "-a", "-F", PANE_FORMAT)).split("\n")) {
    const [ttyPath, paneId, session, windowId, windowIndex, windowActive, stagedName, windowName, ...title] = line.split(SEP);
    if (!ttyPath) continue;
    panes.set(ttyName(ttyPath), {
      title: title.join(SEP),
      viewed: windowActive === "1" && watched.has(session),
      tmux: { paneId, session, windowId, windowIndex: Number(windowIndex), windowName: stagedName || windowName, clientTty: clientTty.get(session) },
    });
  }
  return panes;
}

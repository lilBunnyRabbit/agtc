import { basename } from "node:path";
import { run, succeeds } from "../lib/shell";
import type { Surfaces } from "./types";


/** agtc's own pane id when it runs inside tmux. Its window is the hub. */
export const OWN_PANE = process.env.TMUX_PANE;

const SEP = "\t";
const CLIENT_FORMAT = ["#{client_tty}", "#{client_session}"].join(SEP);
const PANE_FORMAT = ["#{pane_tty}", "#{pane_id}", "#{session_name}", "#{window_id}", "#{window_active}", "#{pane_title}"].join(SEP);
const POPUP_SIZE = "95%";
/** Pane option holding the name of the window a pane came from while it sits on stage. */
const WINDOW_NAME_OPTION = "@agtc_window";

const tmux = (...args: string[]) => run(["tmux", ...args]);
const ttyName = (path: string) => path.replace("/dev/", "");

/**
 * tmux panes keyed by tty. A pane is viewed when its window is the current one of a session
 * some client shows. A client sitting in a Terminal.app tab counts only while that tab is in
 * front; any other client (Zed, Ghostty, ...) always counts.
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
    const [ttyPath, paneId, session, windowId, windowActive, ...title] = line.split(SEP);
    if (!ttyPath) continue;
    panes.set(ttyName(ttyPath), {
      title: title.join(SEP),
      viewed: windowActive === "1" && watched.has(session),
      tmux: { paneId, session, windowId, clientTty: clientTty.get(session) },
    });
  }
  return panes;
}

/**
 * Shows a pane. Inside tmux, agtc's window is the hub: the pane takes the stage next to agtc
 * and whatever was on stage goes back to a window of its own. Outside tmux the pane's window
 * is selected in its session.
 */
export async function focusTmuxPane(paneId: string, stagePercent: number): Promise<boolean> {
  if (!OWN_PANE) {
    return (await succeeds(["tmux", "select-window", "-t", paneId])) && succeeds(["tmux", "select-pane", "-t", paneId]);
  }
  const hubPanes = (await tmux("list-panes", "-t", OWN_PANE, "-F", "#{pane_id}")).split("\n");
  if (hubPanes.includes(paneId)) return succeeds(["tmux", "select-pane", "-t", paneId]);

  // The pane's window is lost once it leaves, so remember the name for the trip back.
  const name = await tmux("display", "-p", "-t", paneId, "#{window_name}");
  await succeeds(["tmux", "set-option", "-p", "-t", paneId, WINDOW_NAME_OPTION, name]);

  const staged = hubPanes.find((id) => id && id !== OWN_PANE);
  if (!staged) return succeeds(["tmux", "join-pane", "-h", "-l", `${stagePercent}%`, "-s", paneId, "-t", OWN_PANE]);

  // Swapping keeps the hub layout as the user left it; the old stage inherits the newcomer's window.
  const [stagedName, stagedPath] = (await tmux("display", "-p", "-t", staged, `#{${WINDOW_NAME_OPTION}}${SEP}#{pane_current_path}`)).split(SEP);
  if (!(await succeeds(["tmux", "swap-pane", "-Z", "-s", paneId, "-t", staged]))) return false;
  await succeeds(["tmux", "rename-window", "-t", staged, stagedName || basename(stagedPath)]);
  return succeeds(["tmux", "select-pane", "-t", paneId]);
}

/** Opens a shell in `cwd` in a new window and types `command` into it. Returns the pane id. */
export async function newTmuxWindow(cwd: string, command: string, session?: string): Promise<string | undefined> {
  const target = session ? ["-t", `${session}:`] : [];
  const paneId = await tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-c", cwd, "-n", basename(cwd), ...target);
  if (!paneId) return undefined;
  await succeeds(["tmux", "send-keys", "-t", paneId, command, "Enter"]);
  return paneId;
}

/** Runs a shell command in a popup over agtc's own client. The popup closes when it exits. */
export function tmuxPopup(cwd: string, command: string, title: string): Promise<boolean> {
  return succeeds(["tmux", "display-popup", "-E", "-d", cwd, "-w", POPUP_SIZE, "-h", POPUP_SIZE, "-T", ` ${title} `, command]);
}

/** The keys that bring you back to agtc from anywhere in its tmux session. */
const BACK_KEYS: [table: string, key: string][] = [
  ["prefix", "a"],
  ["root", "M-a"],
];
/** A binding of ours: an earlier run's pane id, or the line the README used to ask for. */
const OUR_BINDING = /select-pane -Z -t (%\d+|hub\.0)$/;
const KEY_LINE = /^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s+(\S+)\s+(.*)$/;

/**
 * Makes the tmux session comfortable without touching ~/.tmux.conf: mouse on for agtc's
 * session, and `prefix a` / `option-a` jump back to agtc's pane, unzooming nothing. Runs on
 * every start inside tmux since bindings live in the server and pane ids change. A key the
 * user bound to something else is left alone. AGTC_TMUX_SETUP=0 skips all of it.
 */
export async function setupTmux(ownPane: string): Promise<void> {
  if (process.env.AGTC_TMUX_SETUP === "0") return;
  await succeeds(["tmux", "set-option", "-t", ownPane, "mouse", "on"]);
  // One argument: tmux parses the string itself, an argv `;` would end the bind-key command instead.
  const back = `select-window -t ${ownPane} ; select-pane -Z -t ${ownPane}`;
  for (const [table, key] of BACK_KEYS) {
    const bound = await boundCommand(table, key);
    if (bound && !OUR_BINDING.test(bound)) continue;
    await succeeds(["tmux", "bind-key", "-T", table, key, back]);
  }
}

async function boundCommand(table: string, key: string): Promise<string | undefined> {
  for (const line of (await tmux("list-keys", "-T", table)).split("\n")) {
    const match = line.match(KEY_LINE);
    if (match && match[1] === table && match[2] === key) return match[3];
  }
  return undefined;
}

export function tmuxHasSession(name: string): Promise<boolean> {
  return succeeds(["tmux", "has-session", "-t", `=${name}`]);
}

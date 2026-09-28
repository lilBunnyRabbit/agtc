import { launch } from "../lib/shell";
import { tildify, truncate } from "../lib/text";
import { type Session, type Status, workDir } from "../model/session";
import { HOME } from "../paths";
import { agtcShell, tmux } from "../tmux/env";
import { backToHub } from "../tmux/setup";
import { paneKey } from "../tui/keys";

const TITLE_WIDTH = 48;
const ID_LENGTH = 8;

interface Place {
  pane: string;
  hub: string;
  self: string;
}

type Item = [label: string, key: string, command: string];

const SEPARATOR: Item = ["", "", ""];
/** tmux expands formats in menu text. */
const plain = (text: string) => text.replace(/#/g, "##");
/** A leading dash greys the line out and takes its key away. */
const info = (text: string): Item => [`-#[nodim]${text}`, "", ""];
const BORDER = "fg=cyan";
const badge = (text: string) => `#[fg=cyan,bold,reverse] ${plain(text)} #[default]`;
const STATUS_COLOUR: Record<Status, string> = { "needs input": "magenta,bold", done: "blue,bold", busy: "yellow", idle: "green", inactive: "default" };

/** Actions that ask something take the hub's pane, since agtc asks there. */
function inHub({ pane, hub }: Place, key: string, asks = false): string {
  const bytes = [...paneKey({ paneId: pane, key })].map((char) => char.charCodeAt(0).toString(16)).join(" ");
  return `${asks ? `${backToHub(hub)} ; ` : ""}send-keys -t ${hub} -H ${bytes}`;
}

export function menuItems(session: Session | undefined, place: Place): Item[] {
  const own = (command: string) => `run-shell -b "${place.self} ${command} --pane ${place.pane}"`;
  const checkout: Item[] = [
    ["Show in VS Code, link with /ide", "e", own("code")],
    ["Open in the editor", "o", own("edit")],
  ];
  const tmuxItems: Item[] = [SEPARATOR, ["Back to agtc", "a", backToHub(place.hub)], ["Flip the layout", "Space", "next-layout"]];
  if (!session) return [...checkout, ...tmuxItems];
  const act: Item[] = session.reviewOf
    ? [
        ["Paste the report into the reviewed agent", "V", inHub(place, "V")],
        ["Close this reviewer", "x", inHub(place, "x")],
      ]
    : [
        ["Review: start a reviewer beside it", "V", inHub(place, "V", true)],
        ["Close the agent and its window", "X", inHub(place, "X", true)],
      ];
  return [
    ...act,
    ["Diff in lazygit", "v", inHub(place, "v")],
    ...checkout,
    ["New agent, asks where", "n", inHub(place, "n", true)],
    ["New worktree with an agent", "N", inHub(place, "N", true)],
    ["Agent above", "J", inHub(place, "J")],
    ["Agent below", "K", inHub(place, "K")],
    ["Mark seen", "m", inHub(place, "m")],
    ["Copy the resume command", "c", inHub(place, "c")],
    ...tmuxItems,
  ];
}

export function menuHeader(session: Session | undefined, where: string): { title: string; lines: Item[] } {
  if (!session) return { title: badge("no agent in this pane"), lines: [info(plain(where)), SEPARATOR] };
  const status = `#[fg=${STATUS_COLOUR[session.status]}]${session.status}#[default]`;
  const what = [session.tool, session.id.slice(0, ID_LENGTH), status, session.branch && `#[fg=cyan]${plain(session.branch)}#[default]`].filter(Boolean).join("  ");
  return { title: badge(truncate(session.title, TITLE_WIDTH)), lines: [info(what), info(plain(where)), SEPARATOR] };
}

/** Launched, not awaited: tmux display-menu returns when the menu closes. */
export async function showMenu(session: Session | undefined, pane: string, hub: string): Promise<boolean> {
  const dir = session ? workDir(session) : await tmux("display", "-p", "-t", pane, "#{pane_current_path}");
  const { title, lines } = menuHeader(session, tildify(dir, HOME));
  const items = [...lines, ...menuItems(session, { pane, hub, self: agtcShell() })];
  return launch(["tmux", "display-menu", "-t", pane, "-b", "rounded", "-S", BORDER, "-T", title, "--", ...items.flatMap((item) => (item[0] ? item : [""]))]);
}

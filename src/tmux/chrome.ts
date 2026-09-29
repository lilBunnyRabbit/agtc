import { truncate } from "../lib/text";
import type { Session, Status } from "../model/session";
import { ICON, STATUS_LABEL } from "../tui/theme";

export const HEADER_OPTION = "@agtc_header";
const HEADER_FORMAT = `#{?#{${HEADER_OPTION}}, #{E:${HEADER_OPTION}} , #{pane_current_command} }`;
const TITLE_WIDTH = 60;
const STATUS_TITLE_WIDTH = 18;
const STATUS_LENGTH = 120;
const MAX_IN_STATUS = 5;
const GAP = " · ";

const COLOUR: Record<Status, string> = {
  "needs input": "fg=magenta,bold",
  done: "fg=brightblue,bold",
  busy: "fg=yellow",
  idle: "fg=green",
  inactive: "dim",
};

/** tmux reads `#` as the start of a format or a style, in a title too. */
const plain = (text: string) => text.replaceAll("#", "##");
const styled = (text: string, how: string) => `#[${how}]${plain(text)}#[default]`;

export function paneHeader(session: Session): string {
  const { tool, status, title, waitingFor, worktree, branch, changes, reviewOf } = session;
  const where = status === "needs input" && waitingFor ? styled(waitingFor, COLOUR[status]) : styled(worktree ?? branch ?? "", "fg=cyan");
  const facts = [
    `${ICON[tool]} ${styled(STATUS_LABEL[status], COLOUR[status])}`,
    plain(`${reviewOf ? `${ICON.review} ` : ""}${truncate(title, TITLE_WIDTH)}`),
    worktree || branch || waitingFor ? where : "",
    changes?.paths.length ? `${styled(`+${changes.insertions}`, "fg=green")} ${styled(`−${changes.deletions}`, "fg=magenta")}` : "",
  ];
  return facts.filter(Boolean).join(GAP);
}

/** The digit is the hub's, and the range carries it to the click. */
export function statusRight(targets: Session[], sessions: Session[]): string {
  const waiting = targets.slice(0, MAX_IN_STATUS).map(({ status, title }, index) => {
    const label = ` ${index + 1} ${truncate(title, STATUS_TITLE_WIDTH)} `;
    return `#[range=user|d${index + 1}]#[${COLOUR[status]},reverse]${plain(label)}#[default]#[norange]`;
  });
  const more = targets.length > MAX_IN_STATUS ? [styled(`+${targets.length - MAX_IN_STATUS}`, "dim")] : [];
  const busy = sessions.filter((session) => session.status === "busy").length;
  const working = busy ? [styled(`${busy} busy`, COLOUR.busy)] : [];
  return [...waiting, ...more, ...working].join(" ") + " ";
}

type Setting = [key: string, set: string[], unset: string[]];

function settings(sessions: Session[], targets: Session[], hub: string): Setting[] {
  const live = sessions.filter((session) => session.status !== "inactive" && session.tmux);
  const windows = new Set([hub, ...live.map((session) => session.tmux!.windowId)]);
  return [
    ["status", ["set-option", "-t", hub, "status-right", statusRight(targets, sessions)], ["set-option", "-u", "-t", hub, "status-right"]],
    ["length", ["set-option", "-t", hub, "status-right-length", String(STATUS_LENGTH)], ["set-option", "-u", "-t", hub, "status-right-length"]],
    ...[...windows].flatMap((window): Setting[] => [
      [`border ${window}`, ["set-option", "-w", "-t", window, "pane-border-status", "top"], ["set-option", "-wu", "-t", window, "pane-border-status"]],
      [`format ${window}`, ["set-option", "-w", "-t", window, "pane-border-format", HEADER_FORMAT], ["set-option", "-wu", "-t", window, "pane-border-format"]],
    ]),
    [`header ${hub}`, ["set-option", "-p", "-t", hub, HEADER_OPTION, "agtc"], ["set-option", "-pu", "-t", hub, HEADER_OPTION]],
    ...live.map((session): Setting => {
      const pane = session.tmux!.paneId;
      return [`header ${pane}`, ["set-option", "-p", "-t", pane, HEADER_OPTION, paneHeader(session)], ["set-option", "-pu", "-t", pane, HEADER_OPTION]];
    }),
  ];
}

/** Each command runs alone: tmux drops the rest of a sequence once one fails, and a pane can close between the poll and here. */
export class Chrome {
  private readonly applied = new Map<string, { value: string; unset: string[] }>();

  constructor(private readonly hub: string) {}

  /** Only what changed since the last poll is sent. */
  changes(sessions: Session[], targets: Session[]): string[][] {
    const commands: string[][] = [];
    for (const [key, set, unset] of settings(sessions, targets, this.hub)) {
      const value = set.join(" ");
      if (this.applied.get(key)?.value === value) continue;
      this.applied.set(key, { value, unset });
      commands.push(set);
    }
    return commands;
  }

  sync(sessions: Session[], targets: Session[]): void {
    for (const command of this.changes(sessions, targets)) Bun.spawn(["tmux", ...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  }

  /** On the way out, so a bar that names agents does not outlive what kept it true. */
  restore(): void {
    for (const { unset } of this.applied.values()) Bun.spawnSync(["tmux", ...unset], { stderr: "ignore" });
    this.applied.clear();
  }
}

import { truncate } from "../lib/text";
import type { Session, Status } from "../model/session";
import { ICON, STATUS_LABEL } from "../tui/theme";

export const HEADER_OPTION = "@agtc_header";
const HEADER_FORMAT = `#{?#{${HEADER_OPTION}}, #{E:${HEADER_OPTION}} , #{pane_current_command} }`;
const TITLE_WIDTH = 60;
const GAP = " · ";

const COLOUR: Record<Status, string> = {
  "needs input": "fg=magenta bold",
  done: "fg=brightblue bold",
  busy: "fg=yellow",
  idle: "fg=green",
  inactive: "dim",
};

/** A band across every pane, like tabs: the one you type in is darker, so a key meant for an agent is not pressed in the hub. */
const BAND = process.env.AGTC_HEADER_STYLE ?? "bg=#1a3a45";
const ACTIVE_BAND = process.env.AGTC_HEADER_ACTIVE_STYLE ?? "bg=#061419";

/** tmux reads `#` as the start of a format or a style, and a `,` or `}` in text inside #{?…} as the end of a branch. */
const plain = (text: string) => text.replaceAll("#", "##").replaceAll(",", "#,").replaceAll("}", "#}");
/** Back to the band's colours, not the pane's: `default` would drop the band for the rest of the line. */
const styled = (text: string, how: string) => `#[${how}]${plain(text)}#[fg=default none]`;
const look = (style: string) => `#[fill=${style.replace(/^bg=/, "").split(" ")[0]} ${style}]`;
const tab = (left: string, right = "") => `#{?pane_active,${look(ACTIVE_BAND)},${look(BAND)}}#[align=left] ${left} #[align=right] ${right} `;
const hubHeader = () => tab("#{?pane_active,▶ ,}#[bold]agtc#[none]#{?pane_active, · your keys go to agtc,}");

export function paneHeader(session: Session): string {
  const { tool, status, title, waitingFor, worktree, branch, changes, reviewOf } = session;
  const left = [
    `${worktree ? styled(`${ICON.worktree} `, "fg=cyan") : ""}${ICON[tool]} ${styled(STATUS_LABEL[status], COLOUR[status])}`,
    `#[bold]${plain(`${reviewOf ? `${ICON.review} ` : ""}${truncate(title, TITLE_WIDTH)}`)}#[none]`,
    status === "needs input" && waitingFor ? styled(waitingFor, COLOUR[status]) : "",
  ];
  const right = [
    worktree || branch ? styled(worktree ?? branch ?? "", "fg=cyan") : "",
    changes?.paths.length ? `${styled(`+${changes.insertions}`, "fg=green")} ${styled(`−${changes.deletions}`, "fg=magenta")}` : "",
  ];
  return tab(left.filter(Boolean).join(GAP), right.filter(Boolean).join(GAP));
}

type Setting = [key: string, set: string[], unset: string[]];

function settings(sessions: Session[], hub: string): Setting[] {
  const live = sessions.filter((session) => session.status !== "inactive" && session.tmux);
  const windows = new Set([hub, ...live.map((session) => session.tmux!.windowId)]);
  return [
    ...[...windows].flatMap((window): Setting[] => [
      [`border ${window}`, ["set-option", "-w", "-t", window, "pane-border-status", "top"], ["set-option", "-wu", "-t", window, "pane-border-status"]],
      [`format ${window}`, ["set-option", "-w", "-t", window, "pane-border-format", HEADER_FORMAT], ["set-option", "-wu", "-t", window, "pane-border-format"]],
    ]),
    [`header ${hub}`, ["set-option", "-p", "-t", hub, HEADER_OPTION, hubHeader()], ["set-option", "-pu", "-t", hub, HEADER_OPTION]],
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
  changes(sessions: Session[]): string[][] {
    const commands: string[][] = [];
    for (const [key, set, unset] of settings(sessions, this.hub)) {
      const value = set.join(" ");
      if (this.applied.get(key)?.value === value) continue;
      this.applied.set(key, { value, unset });
      commands.push(set);
    }
    return commands;
  }

  sync(sessions: Session[]): void {
    for (const command of this.changes(sessions)) Bun.spawn(["tmux", ...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  }

  /** On the way out, so a header that names an agent does not outlive what kept it true. */
  restore(): void {
    for (const { unset } of this.applied.values()) Bun.spawnSync(["tmux", ...unset], { stderr: "ignore" });
    this.applied.clear();
  }
}

import { shellQuote, succeeds } from "../lib/shell";
import { tildify } from "../lib/text";
import { type Session, workDir } from "../model/session";
import { needsAttention } from "../tui/theme";
import { HOME } from "../paths";
import { agtcShell, tmux } from "../tmux/env";
import { ANSI } from "../tui/ansi";
import { Key, paneKey } from "../tui/keys";
import { MENU_WIDTH, type Action, type MenuInfo, type Other, menuActions, moveSelection, renderMenu } from "../tui/menu";
import { openScreen } from "../tui/terminal";

const ID_LENGTH = 8;
const BORDER = "fg=cyan";
/** A popup cannot open over this one, so what opens one waits for it to close. */
const CLOSE_MS = 200;

export function menuInfo(session: Session | undefined, where: string, pane: string, hub: string, others: Other[] = []): MenuInfo {
  if (!session) return { pane, hub, where, others, kind: "none" };
  const { title, tool, status, branch } = session;
  return { pane, hub, where, others, kind: session.reviewOf ? "reviewer" : "agent", title, tool, status, branch, id: session.id.slice(0, ID_LENGTH) };
}

/** The hub's digits, so a number means one agent everywhere. Only an agent that waits for you shows its. */
export function otherAgents(targets: Session[], session: Session | undefined): Other[] {
  return targets
    .map(({ id, title, status }, index) => ({ id, title, status, digit: needsAttention(status) ? String(index + 1) : undefined }))
    .filter(({ id }) => id !== session?.id)
    .map(({ id, ...other }) => other);
}

const ACTIVE_BORDER = "pane-active-border-style";
const OUTLINE = "fg=cyan,bold";

/** Over the middle of the pane. tmux takes -y as the popup's bottom line. */
export function popupPlace(width: number, height: number): string[] {
  const x = `#{e|+:#{pane_left},#{e|/:#{e|-:#{pane_width},${width}},2}}`;
  const y = `#{e|+:#{pane_top},#{e|/:#{e|+:#{pane_height},${height}},2}}`;
  return ["-x", x, "-y", y];
}

/** Returns when the popup closes. The pane's border takes the popup's colour meanwhile, to tie the two together. */
export async function popupOver(pane: string, width: number, height: number, command: string): Promise<void> {
  const border = await tmux("show-options", "-wv", "-t", pane, ACTIVE_BORDER);
  await succeeds(["tmux", "set-option", "-w", "-t", pane, ACTIVE_BORDER, OUTLINE]);
  await succeeds(["tmux", "display-popup", "-E", "-t", pane, ...popupFrame(width, height), ...popupPlace(width, height), command]);
  await succeeds(["tmux", "set-option", "-w", ...(border ? [] : ["-u"]), "-t", pane, ACTIVE_BORDER, ...(border ? [border] : [])]);
}

export const popupFrame = (width: number, height: number) => ["-b", "rounded", "-S", BORDER, "-w", String(width), "-h", String(height)];

export async function showMenu(session: Session | undefined, pane: string, hub: string, others: Other[]): Promise<void> {
  const dir = session ? workDir(session) : await tmux("display", "-p", "-t", pane, "#{pane_current_path}");
  const info = menuInfo(session, tildify(dir, HOME), pane, hub, others);
  const packed = Buffer.from(JSON.stringify(info)).toString("base64url");
  await popupOver(pane, MENU_WIDTH + 2, renderMenu(info).length + 2, `${agtcShell()} menu ${shellQuote(packed)}`);
}

export function tmuxCommands({ pane, hub }: MenuInfo, action: Action, self: string): string[][] {
  const toHub = [["select-window", "-t", hub], ["select-pane", "-Z", "-t", hub]];
  if (action.does === "back") return toHub;
  if (action.does === "layout") return [["next-layout", "-t", pane]];
  if (action.does === "jump") return [["select-window", "-t", hub], ["send-keys", "-t", hub, action.key]];
  if (action.does === "own") return [["run-shell", "-b", `${self} ${action.command} --pane ${pane}`]];
  const typed = ["send-keys", "-t", hub, "-H", ...[...paneKey({ paneId: pane, key: action.key })].map((char) => char.charCodeAt(0).toString(16))];
  return action.opensPopup ? [["run-shell", "-b", `sleep ${CLOSE_MS / 1000}; tmux ${typed.join(" ")}`]] : [typed];
}

export function menuScreen(packed: string | undefined): Promise<number> {
  const info = unpack(packed);
  if (!info) {
    console.log("agtc menu runs from its tmux key: prefix space or option-space in a pane of the hub's session");
    return Promise.resolve(1);
  }
  const actions = menuActions(info);
  const arrows: string[] = [Key.up, Key.down, Key.left, Key.right];
  let selected: Action | undefined;
  return new Promise((done) => {
    const draw = () => process.stdout.write(ANSI.clearScreen + renderMenu(info, selected).join("\n"));
    const screen = openScreen({
      onResize: draw,
      onKey: (key) => {
        if (arrows.includes(key)) {
          selected = moveSelection(info, selected, key);
          return draw();
        }
        const action = key === Key.enter ? selected : actions.find((a) => a.key === key);
        if (!action && key !== Key.escape && key !== "q") return;
        screen.close();
        void runAll(action ? tmuxCommands(info, action, agtcShell()) : []).then(() => done(0));
      },
    });
    draw();
  });
}

async function runAll(commands: string[][]): Promise<void> {
  for (const command of commands) await succeeds(["tmux", ...command]);
}

function unpack(packed: string | undefined): MenuInfo | undefined {
  try {
    const info = JSON.parse(Buffer.from(packed ?? "", "base64url").toString());
    return info?.pane && info.hub ? info : undefined;
  } catch {
    return undefined;
  }
}

import { editorArgv, openInEditor } from "../desktop/editor";
import { editorKnows, openWindow, showCheckout, windowOpen } from "../desktop/vscode";
import { launch, succeeds } from "../lib/shell";
import { tildify } from "../lib/text";
import { agentIn } from "../model/lookup";
import { type Session, workDir } from "../model/session";
import { collectSessions } from "../model/sessions";
import { StateStore } from "../model/state-store";
import { HOME, STATE_FILE } from "../paths";
import { gitRootOfDir } from "../sources/git";
import { tmux, tmuxFreeEnv } from "../tmux/env";
import { askForIde } from "../tmux/ide";

const LOOKUP_DAYS = 1;

export interface CodeOptions {
  dir: string;
  pane?: string;
}

interface Target {
  checkout: string;
  session?: Session;
  say(text: string): void;
}

/** From a tmux key the answer goes to the status line: run-shell would put printed text over the pane. */
async function targetOf({ dir, pane }: CodeOptions): Promise<Target> {
  const say = (text: string) => (pane ? void succeeds(["tmux", "display-message", "-t", pane, `agtc: ${text}`]) : console.log(text));
  const session = pane ? await agentInPane(pane) : await agentIn(dir);
  const start = pane && !session ? await tmux("display", "-p", "-t", pane, "#{pane_current_path}") : dir;
  return { checkout: session ? workDir(session) : (gitRootOfDir(start) ?? start), session, say };
}

export async function codeCommand(options: CodeOptions): Promise<number> {
  const { checkout, session, say } = await targetOf(options);
  if (!checkout) {
    say("no directory to show");
    return 1;
  }
  const outcome = await showInCode(checkout, session);
  say(outcome.text);
  return outcome.ok ? 0 : 1;
}

export async function editCommand(options: CodeOptions): Promise<number> {
  const { checkout, session, say } = await targetOf(options);
  if (!checkout) {
    say("no directory to open");
    return 1;
  }
  const argv = editorArgv(checkout);
  const opened = session ? openInEditor(session) : launch(argv, tmuxFreeEnv()) ? argv.join(" ") : undefined;
  say(opened ? `opened: ${opened}` : "editor not found. Set AGTC_EDITOR.");
  return opened ? 0 : 1;
}

async function agentInPane(pane: string): Promise<Session | undefined> {
  const sessions = await collectSessions({ days: LOOKUP_DAYS, state: StateStore.load(STATE_FILE) });
  return sessions.find((s) => s.status !== "inactive" && s.tmux?.paneId === pane);
}

export interface Outcome {
  ok: boolean;
  text: string;
}

export async function showInCode(checkout: string, session: Session | undefined): Promise<Outcome> {
  const where = tildify(checkout, HOME);
  const wasOpen = windowOpen();
  showCheckout(checkout);
  if (!wasOpen && !openWindow()) return { ok: false, text: "VS Code not found: install its `code` shell command" };
  if (session?.tool !== "claude" || !session.tmux || session.status === "inactive") return { ok: true, text: `VS Code shows ${where}` };
  if (session.status === "busy" || session.status === "needs input") return { ok: true, text: `VS Code shows ${where}. Agent is ${session.status}: /ide there when it waits` };
  if (!(await editorKnows(checkout))) return { ok: true, text: `VS Code shows ${where}. Claude Code's extension did not report it: /ide by hand` };
  switch (await askForIde(session.tmux.paneId)) {
    case "asked":
      return { ok: true, text: `VS Code shows ${where}, agent linked` };
    case "draft":
      return { ok: true, text: `VS Code shows ${where}. Input has text: /ide by hand` };
    default:
      return { ok: true, text: `VS Code shows ${where}. /ide got no answer` };
  }
}

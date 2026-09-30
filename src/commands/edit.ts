import { editorArgv, openInEditor } from "../desktop/editor";
import { launch, succeeds } from "../lib/shell";
import { agentIn } from "../model/lookup";
import { type Session, workDir } from "../model/session";
import { collectSessions } from "../model/sessions";
import { StateStore } from "../model/state-store";
import { STATE_FILE } from "../paths";
import { gitRootOfDir } from "../sources/git";
import { tmux, tmuxFreeEnv } from "../tmux/env";

const LOOKUP_DAYS = 1;

export interface EditOptions {
  dir: string;
  pane?: string;
}

interface Target {
  checkout: string;
  session?: Session;
  say(text: string): void;
}

/** From a tmux key the answer goes to the status line: run-shell would put printed text over the pane. */
async function targetOf({ dir, pane }: EditOptions): Promise<Target> {
  const say = (text: string) => (pane ? void succeeds(["tmux", "display-message", "-t", pane, `agtc: ${text}`]) : console.log(text));
  const session = pane ? await agentInPane(pane) : await agentIn(dir);
  const start = pane && !session ? await tmux("display", "-p", "-t", pane, "#{pane_current_path}") : dir;
  return { checkout: session ? workDir(session) : (gitRootOfDir(start) ?? start), session, say };
}

export async function editCommand(options: EditOptions): Promise<number> {
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

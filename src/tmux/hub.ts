import { shellQuote, succeeds } from "../lib/shell";
import { OWN_PANE, tmuxFreeEnv, tmuxHasSession } from "./env";

export const HUB_SESSION = "agtc";
export const HUB_WINDOW = "hub";

export async function openHub(argv: string[]): Promise<number> {
  if (OWN_PANE) {
    console.log("already inside tmux. Run plain `agtc` here; this window becomes the hub.");
    return 1;
  }
  if (!(await tmuxHasSession(HUB_SESSION))) {
    if (!(await succeeds(["tmux", "new-session", "-d", "-s", HUB_SESSION, "-n", HUB_WINDOW]))) {
      console.log("tmux not found. Install it with: brew install tmux");
      return 1;
    }
    const self = [process.execPath, ...argv.filter((arg) => arg !== "tmux")].map(shellQuote).join(" ");
    await succeeds(["tmux", "send-keys", "-t", `${HUB_SESSION}:${HUB_WINDOW}`, self, "Enter"]);
  }
  const client = Bun.spawn(["tmux", "attach", "-t", `=${HUB_SESSION}`], { env: tmuxFreeEnv(), stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return client.exited;
}

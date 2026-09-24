import { run, succeeds } from "../lib/shell";

export let OWN_PANE = process.env.TMUX_PANE;

/**
 * Trusts TMUX_PANE only when this process really writes to that pane's tty. Zed keeps the
 * environment of the CLI call that opened a project and hands it to its terminals, so a
 * checkout opened from the hub carries the hub's tmux variables into Zed.
 */
export async function detectOwnPane(): Promise<void> {
  if (!OWN_PANE) return;
  const paneTty = await run(["tmux", "display", "-p", "-t", OWN_PANE, "#{pane_tty}"]);
  if (!paneTty || paneTty !== (await ownTty())) OWN_PANE = undefined;
}

async function ownTty(): Promise<string> {
  try {
    const proc = Bun.spawn(["tty"], { stdin: "inherit", stdout: "pipe", stderr: "ignore" });
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "";
  }
}

/** For a nested client or an editor that keeps what it is given. */
export function tmuxFreeEnv(): Record<string, string | undefined> {
  const { TMUX, TMUX_PANE, ...env } = process.env;
  return env;
}

export const tmux = (...args: string[]) => run(["tmux", ...args]);

export function tmuxHasSession(name: string): Promise<boolean> {
  return succeeds(["tmux", "has-session", "-t", `=${name}`]);
}

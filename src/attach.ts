import { agentIn } from "./lookup";
import { succeeds } from "./lib/shell";
import { OWN_PANE, tmuxHasSession } from "./sources/tmux";

/**
 * `agtc attach [DIR]`: shows the agent running in DIR (default cwd) in this terminal, live.
 * A tmux session grouped with the agent's shares its windows but keeps its own current
 * window, so this client can sit on the agent while the hub shows something else. No status
 * bar, and the grouped session dies when this terminal closes; the agent does not.
 */
export async function attachAgent(dir: string): Promise<number> {
  if (OWN_PANE) {
    console.log("already inside tmux. Use the hub's enter, or run this from a Zed or Terminal window.");
    return 1;
  }
  const agent = await agentIn(dir);
  if (!agent) {
    console.log(`no running agent in ${dir}`);
    return 1;
  }
  if (!agent.tmux) {
    console.log(`${agent.tool} "${agent.title}" runs outside tmux (${agent.tty ?? "no tty"}), nothing to attach to`);
    return 1;
  }
  const { session, windowId, paneId } = agent.tmux;
  const name = `${session}-view-${process.pid}`;
  if (await tmuxHasSession(name)) await succeeds(["tmux", "kill-session", "-t", `=${name}`]);
  // set-option and select-window reject the "=" exact-match prefix other commands accept.
  const created =
    (await succeeds(["tmux", "new-session", "-d", "-t", `=${session}`, "-s", name])) &&
    (await succeeds(["tmux", "set-option", "-t", name, "status", "off"])) &&
    (await succeeds(["tmux", "set-option", "-t", name, "destroy-unattached", "on"])) &&
    (await succeeds(["tmux", "select-window", "-t", `${name}:${windowId}`])) &&
    (await succeeds(["tmux", "select-pane", "-t", paneId]));
  if (!created) {
    console.log(`could not create a view on tmux session ${session}`);
    return 1;
  }
  const client = Bun.spawn(["tmux", "attach", "-t", `=${name}`], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  return client.exited;
}

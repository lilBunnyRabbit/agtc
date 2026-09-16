import { extname } from "node:path";
import { agentIn } from "./lookup";
import { succeeds } from "./lib/shell";

export interface SendOptions {
  dir: string;
  file?: string;
  row?: string;
  selection?: string;
}

/**
 * `agtc send`: puts a code reference into the input of the agent running in DIR, without
 * submitting. `file:row`, then the selection as a fenced block when there is one. Bracketed
 * paste keeps the newlines from being taken as enter.
 */
export async function sendToAgent({ dir, file, row, selection }: SendOptions): Promise<number> {
  const agent = await agentIn(dir);
  if (!agent) {
    console.log(`no running agent in ${dir}`);
    return 1;
  }
  if (!agent.tmux) {
    console.log(`${agent.tool} "${agent.title}" runs outside tmux, cannot type into it`);
    return 1;
  }
  const text = compose(file, row, selection);
  if (!text) {
    console.log("nothing to send: pass --file, --row or a selection in AGTC_SELECTION");
    return 1;
  }
  const buffer = `agtc-${process.pid}`;
  const loaded = Bun.spawnSync(["tmux", "load-buffer", "-b", buffer, "-"], { stdin: new TextEncoder().encode(text) }).exitCode === 0;
  const pasted = loaded && (await succeeds(["tmux", "paste-buffer", "-p", "-d", "-b", buffer, "-t", agent.tmux.paneId]));
  if (!pasted) {
    console.log(`could not paste into tmux pane ${agent.tmux.paneId}`);
    return 1;
  }
  return 0;
}

function compose(file: string | undefined, row: string | undefined, selection: string | undefined): string {
  const reference = file ? `${file}${row ? `:${row}` : ""}` : "";
  const body = selection?.replace(/\s+$/, "");
  if (!body) return reference ? `${reference} ` : "";
  const lang = file ? extname(file).slice(1) : "";
  return `${reference}\n\`\`\`${lang}\n${body}\n\`\`\`\n`;
}

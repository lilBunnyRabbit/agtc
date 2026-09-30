import { extname } from "node:path";
import { copyToClipboard } from "../lib/shell";
import { agentIn } from "../model/lookup";
import { postToInbox } from "../sources/claude/inbox";
import { pasteIntoPane } from "../tmux/windows";

export interface SendOptions {
  dir: string;
  file?: string;
  row?: string;
  selection?: string;
  message?: string;
}

/**
 * With a message, a Claude session takes it on its inbox and acts on it. A bare reference or
 * selection is typed into the input, unsent, for the instruction to follow; so is anything to
 * a session without an inbox.
 */
export async function sendToAgent({ dir, file, row, selection, message }: SendOptions): Promise<number> {
  const agent = await agentIn(dir);
  if (!agent) {
    console.log(`no running agent in ${dir}`);
    return 1;
  }
  const text = compose(file, row, selection, message);
  if (!text) {
    console.log("nothing to send: pass --message, --file, --row or a selection in AGTC_SELECTION");
    return 1;
  }
  const title = `${agent.tool} "${agent.title}"`;
  if (message?.trim() && agent.inbox && agent.pid) {
    const delivery = await postToInbox({ pid: agent.pid, socket: agent.inbox }, text);
    if (delivery === "delivered") {
      console.log(`delivered to ${title}`);
      return 0;
    }
    if (delivery !== "unreachable") {
      copyToClipboard(text);
      console.log(`${title} ${delivery} the message${delivery === "held" ? ", it wants its user's approval first" : ""}: copied, paste it there`);
      return 1;
    }
  }
  if (!agent.tmux) {
    console.log(`${title} runs outside tmux, cannot type into it`);
    return 1;
  }
  if (!(await pasteIntoPane(agent.tmux.paneId, text))) {
    console.log(`could not paste into tmux pane ${agent.tmux.paneId}`);
    return 1;
  }
  return 0;
}

export function compose(file: string | undefined, row: string | undefined, selection: string | undefined, message?: string): string {
  const reference = file ? `${file}${row ? `:${row}` : ""}` : "";
  const body = selection?.replace(/\s+$/, "");
  const note = message?.trim();
  if (!body && !note) return reference ? `${reference} ` : "";
  const lang = file ? extname(file).slice(1) : "";
  const parts = [...(body ? [`${reference}\n\`\`\`${lang}\n${body}\n\`\`\``] : reference ? [reference] : []), ...(note ? [note] : [])];
  return `${parts.join("\n")}\n`;
}

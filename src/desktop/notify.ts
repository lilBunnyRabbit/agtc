import { succeeds } from "../lib/shell";

/** AppleScript string literal: backslashes and quotes are the only characters it escapes. */
const quote = (text: string) => `"${text.replace(/[\\"]/g, "\\$&")}"`;

/** `osascript` works from inside tmux and needs nothing installed. */
export function notify(title: string, subtitle: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return succeeds(["osascript", "-e", `display notification with title ${quote(title)} subtitle ${quote(subtitle)}`]);
}

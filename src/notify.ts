import { succeeds } from "./lib/shell";

/** AppleScript string literal: backslashes and quotes are the only characters it escapes. */
const quote = (text: string) => `"${text.replace(/[\\"]/g, "\\$&")}"`;

/**
 * A macOS banner with the session's title and its status, no body. `osascript` works from
 * inside tmux and needs nothing installed; elsewhere there is nothing to show.
 */
export function notify(title: string, subtitle: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return succeeds(["osascript", "-e", `display notification with title ${quote(title)} subtitle ${quote(subtitle)}`]);
}

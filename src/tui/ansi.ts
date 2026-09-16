export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  blue: "\x1b[94m",
  white: "\x1b[97m",

  clearScreen: "\x1b[H\x1b[2J",
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  bell: "\x07",
} as const;

/** Wraps text in the given codes and resets afterwards. */
export function style(text: string, ...codes: string[]): string {
  return codes.join("") + text + ANSI.reset;
}

const ESCAPE_SEQUENCE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ESCAPE_SEQUENCE, "");
}

/** Number of terminal cells a styled string occupies. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

const ELLIPSIS = "…";

/** Cuts a styled string to `width` cells with an ellipsis, keeping escape sequences intact. */
export function clip(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let out = "";
  let room = Math.max(0, width - 1);
  for (const part of text.split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith("\x1b")) {
      out += part;
      continue;
    }
    out += part.slice(0, room);
    room = Math.max(0, room - part.length);
  }
  return out + ELLIPSIS + ANSI.reset;
}

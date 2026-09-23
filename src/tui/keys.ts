export const Key = {
  ctrlC: "\x03",
  ctrlU: "\x15",
  escape: "\x1b",
  enter: "\r",
  backspace: "\x7f",
  backspaceAlt: "\b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
} as const;

/** A legacy (X10) mouse report: CSI M then three bytes that would otherwise read as keys, `q` among them. */
const LEGACY_MOUSE = "\x1b[M";
const LEGACY_MOUSE_BYTES = 3;

/**
 * Splits a raw stdin chunk into key presses. Bun may deliver several keys in one
 * chunk; CSI sequences (ESC [ ... letter) stay whole, everything else is one char.
 */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\x1b" && chunk[i + 1] === "[") {
      let end = i + 2;
      while (end < chunk.length && !/[A-Za-z~]/.test(chunk[end])) end++;
      if (chunk.slice(i, end + 1) === LEGACY_MOUSE) end += LEGACY_MOUSE_BYTES;
      keys.push(chunk.slice(i, end + 1));
      i = end + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

export type MouseButton = "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "other";

export interface Mouse {
  button: MouseButton;
  /** 1-based terminal column. */
  x: number;
  /** 1-based terminal row. */
  y: number;
  release: boolean;
}

const SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/** The mouse event a key string is, SGR or legacy, or undefined for a real key. */
export function parseMouse(key: string): Mouse | undefined {
  const sgr = key.match(SGR_MOUSE);
  if (sgr) return mouseEvent(Number(sgr[1]), Number(sgr[2]), Number(sgr[3]), sgr[4] === "m");
  if (key.startsWith(LEGACY_MOUSE) && key.length === LEGACY_MOUSE.length + LEGACY_MOUSE_BYTES) {
    const [code, x, y] = [...key.slice(LEGACY_MOUSE.length)].map((c) => c.charCodeAt(0) - 32);
    return mouseEvent(code, x, y, (code & 3) === 3);
  }
  return undefined;
}

function mouseEvent(code: number, x: number, y: number, release: boolean): Mouse {
  const wheel = code & 64;
  const button: MouseButton = wheel ? ((code & 1) ? "wheelDown" : "wheelUp") : (["left", "middle", "right", "other"] as const)[code & 3];
  return { button, x, y, release };
}

export function isPrintable(key: string): boolean {
  return key.length === 1 && key >= " ";
}

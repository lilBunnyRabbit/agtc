export const Key = {
  ctrlC: "\x03",
  ctrlU: "\x15",
  escape: "\x1b",
  enter: "\r",
  backspace: "\x7f",
  backspaceAlt: "\b",
  up: "\x1b[A",
  down: "\x1b[B",
} as const;

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
      keys.push(chunk.slice(i, end + 1));
      i = end + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

export function isPrintable(key: string): boolean {
  return key.length === 1 && key >= " ";
}

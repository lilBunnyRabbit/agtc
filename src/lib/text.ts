const ELLIPSIS = "…";

/** Collapses all whitespace runs to one space and caps the length. */
export function collapse(text: string, maxLength = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > maxLength ? flat.slice(0, maxLength - 1) + ELLIPSIS : flat;
}

/** Cuts text to `width` characters, ending with an ellipsis when something was dropped. */
export function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  return width > 1 ? text.slice(0, width - 1) + ELLIPSIS : text.slice(0, width);
}

/** Truncates or space-pads to exactly `width` characters. */
export function padRight(text: string, width: number): string {
  return truncate(text, width).padEnd(width);
}

/** Greedy word wrap into at most `maxLines` lines; the last line ends with an ellipsis if text was cut. */
export function wrapWords(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const wasCut = lines.join(" ").length < text.length;
  if (wasCut && lines.length === maxLines) lines[maxLines - 1] += ELLIPSIS;
  return lines.map((line) => truncate(line, width));
}

/** Replaces a leading home directory with "~". */
export function tildify(path: string, home: string): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** Puts the home directory back in place of a leading `~`. */
export function untildify(path: string, home: string): string {
  return path === "~" || path.startsWith("~/") ? home + path.slice(1) : path;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Compact "how long ago" label: 12s, 5m, 3h, 2d. */
export function relativeAge(timestampMs: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestampMs);
  if (elapsed < MINUTE) return `${Math.floor(elapsed / SECOND)}s`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}

/** Parses the `ps` etime column ([[dd-]hh:]mm:ss) into milliseconds. */
export function parseElapsed(etime: string): number {
  const [days, clock] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = clock.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [hours, minutes, seconds] = parts;
  return Number(days) * DAY + hours * HOUR + minutes * MINUTE + seconds * SECOND;
}

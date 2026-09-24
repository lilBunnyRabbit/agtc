import type { Session } from "../model/session";

export type WorktreeState = "live" | "dirty" | "unpushed" | "pushed" | "detached" | "locked" | "fresh" | "gone" | "missing";

export const STATE_ORDER: WorktreeState[] = ["live", "dirty", "unpushed", "pushed", "detached", "locked", "fresh", "gone", "missing"];

export interface Worktree {
  dir: string;
  name: string;
  branch?: string;
  head: string;
  state: WorktreeState;
  dirty: number;
  /** Commits the upstream lacks; without an upstream, commits no other ref has. NaN when git could not count. */
  ahead: number;
  upstream?: string;
  gone: boolean;
  /** Another ref that holds every commit of a branch with none of its own, when that ref is not the base. */
  heldBy?: string;
  session?: Session;
  activeAt: number;
}

export interface ListEntry {
  dir: string;
  head: string;
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface Tracking {
  upstream?: string;
  gone: boolean;
  ahead: number;
  committedAt: number;
}

export interface StateInput {
  entry: ListEntry;
  missing: boolean;
  track?: Tracking;
  dirty: number;
  ahead: number;
  live: boolean;
}

export function stateOf({ entry, missing, track, dirty, ahead, live }: StateInput): WorktreeState {
  if (entry.locked) return "locked";
  if (missing) return "missing";
  if (live) return "live";
  if (dirty) return "dirty";
  if (track?.gone) return "gone";
  if (track?.upstream) return ahead > 0 ? "unpushed" : "pushed";
  if (ahead === 0) return "fresh";
  return entry.branch ? "unpushed" : "detached";
}

export const isRemovable = ({ state }: Pick<Worktree, "state">) => state === "fresh" || state === "gone" || state === "missing";

export const canRemove = ({ state }: Pick<Worktree, "state">) => state !== "live" && state !== "locked";

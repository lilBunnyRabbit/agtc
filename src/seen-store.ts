import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "./lib/files";

interface SeenState {
  /** session id -> when it was last looked at */
  seen: Record<string, number>;
  /** checkout path -> session last opened from agtc there, so attach and send pick that one */
  opened?: Record<string, string>;
}

/**
 * Remembers when you last looked at each session, so a "done" session can
 * turn back into "idle", and which session you last opened per checkout.
 * Persisted as JSON; every mark is written through.
 */
export class SeenStore {
  private seen: Record<string, number> = {};
  private opened: Record<string, string> = {};
  private fresh = true;

  private constructor(private readonly path: string) {}

  static load(path: string): SeenStore {
    const store = new SeenStore(path);
    const state = readJson<Partial<SeenState>>(path);
    if (state) {
      store.seen = state.seen ?? {};
      store.opened = state.opened ?? {};
      store.fresh = false;
    }
    return store;
  }

  /** True until the file exists: the very first run on this machine. */
  get isFresh(): boolean {
    return this.fresh;
  }

  seenAt(id: string): number {
    return this.seen[id] ?? 0;
  }

  /** Records a look at `at`. Never moves a mark backwards. */
  mark(id: string, at = Date.now()): void {
    if (this.seenAt(id) >= at) return;
    this.seen[id] = at;
    this.save();
  }

  markOpened(checkout: string, id: string): void {
    this.opened[checkout] = id;
    this.save();
  }

  openedIn(checkout: string): string | undefined {
    return this.opened[checkout];
  }

  save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ seen: this.seen, opened: this.opened } satisfies SeenState));
      this.fresh = false;
    } catch {
      // A read-only cache dir only costs persistence, not functionality.
    }
  }
}

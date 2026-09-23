import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "./lib/files";

/** An agent window as it last stood in tmux: enough to bring it back with `S`. */
export interface HubWindow {
  /** Session id to resume. */
  id: string;
  tool: "claude" | "codex";
  cwd: string;
  name: string;
  /** The session it reviews, when it is a reviewer: resumed read-only. */
  reviewOf?: string;
}

/** A reviewer started with `V` and the session it reviews. */
export interface ReviewLink {
  /** The reviewer's session id: known up front for Claude, learned from its pane for Codex. */
  id?: string;
  /** tmux pane the reviewer started in. */
  pane: string;
  /** The session under review. */
  of: string;
  /** When the reviewer started; a session in that pane from before is not it. */
  at: number;
}

interface SeenState {
  /** session id -> when it was last looked at */
  seen: Record<string, number>;
  /** checkout path -> session last opened from agtc there, so attach and send pick that one */
  opened?: Record<string, string>;
  /** The agent windows tmux held when agtc last looked, for restoring after the server is gone. */
  hub?: HubWindow[];
  reviews?: ReviewLink[];
}

const MAX_REVIEWS = 100;
/** `ps` reports start times in whole seconds, so a reviewer may look older than the key press that started it. */
const START_SLACK_MS = 5000;

/**
 * Remembers when you last looked at each session, so a "done" session can
 * turn back into "idle", and which session you last opened per checkout.
 * Persisted as JSON; every mark is written through.
 */
export class SeenStore {
  private seen: Record<string, number> = {};
  private opened: Record<string, string> = {};
  private hub: HubWindow[] = [];
  private reviews: ReviewLink[] = [];
  private fresh = true;

  private constructor(
    private readonly path: string,
    /** A second agtc beside the hub reads the file and never writes it, so no mark is lost. */
    private readonly readOnly: boolean,
  ) {}

  static load(path: string, { readOnly = false } = {}): SeenStore {
    const store = new SeenStore(path, readOnly);
    const state = readJson<Partial<SeenState>>(path);
    if (state) {
      store.seen = state.seen ?? {};
      store.opened = state.opened ?? {};
      store.hub = state.hub ?? [];
      store.reviews = state.reviews ?? [];
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

  /**
   * Records the agent windows tmux holds right now. An empty set is not recorded: after the
   * server died there is nothing to see, and that is exactly when the last picture matters.
   */
  rememberHub(windows: HubWindow[]): void {
    if (!windows.length || JSON.stringify(windows) === JSON.stringify(this.hub)) return;
    this.hub = windows;
    this.save();
  }

  lastHub(): HubWindow[] {
    return this.hub;
  }

  /** A link still waiting for its id in the same pane is stale: the pane was reused. */
  rememberReview(link: ReviewLink): void {
    this.reviews = [...this.reviews.filter((r) => r.id || r.pane !== link.pane), link].slice(-MAX_REVIEWS);
    this.save();
  }

  /**
   * The link a session belongs to: by id, or by pane for one whose id was not known when it
   * started. A pane match settles the id, except for a Codex process that has no thread yet
   * (its id is a placeholder until the first message).
   */
  reviewLinkOf(session: { id: string; tmux?: { paneId: string }; startedAt?: number }): ReviewLink | undefined {
    const byId = this.reviews.find((r) => r.id === session.id);
    if (byId) return byId;
    const pane = session.tmux?.paneId;
    if (!pane) return undefined;
    const link = this.reviews.find((r) => !r.id && r.pane === pane && (session.startedAt ?? Infinity) >= r.at - START_SLACK_MS);
    if (link && !session.id.startsWith("pid-")) {
      link.id = session.id;
      this.save();
    }
    return link;
  }

  save(): void {
    if (this.readOnly) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ seen: this.seen, opened: this.opened, hub: this.hub, reviews: this.reviews } satisfies SeenState));
      this.fresh = false;
    } catch {
      // A read-only cache dir only costs persistence, not functionality.
    }
  }
}

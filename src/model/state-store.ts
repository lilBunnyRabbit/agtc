import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJson } from "../lib/files";
import type { Tool } from "./tools";

export interface HubWindow {
  id: string;
  tool: Tool;
  cwd: string;
  name: string;
  reviewOf?: string;
}

export interface ReviewLink {
  /** Known up front for Claude, learned from its pane for Codex. */
  id?: string;
  pane: string;
  of: string;
  /** When the reviewer started; a session in that pane from before is not it. */
  at: number;
}

interface State {
  seen: Record<string, number>;
  opened?: Record<string, string>;
  hub?: HubWindow[];
  reviews?: ReviewLink[];
}

const MAX_REVIEWS = 100;
/** `ps` reports start times in whole seconds, so a reviewer may look older than the key press that started it. */
const START_SLACK_MS = 5000;

export class StateStore {
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

  static load(path: string, { readOnly = false } = {}): StateStore {
    const store = new StateStore(path, readOnly);
    const state = readJson<Partial<State>>(path);
    if (state) {
      store.seen = state.seen ?? {};
      store.opened = state.opened ?? {};
      store.hub = state.hub ?? [];
      store.reviews = state.reviews ?? [];
      store.fresh = false;
    }
    return store;
  }

  get isFresh(): boolean {
    return this.fresh;
  }

  seenAt(id: string): number {
    return this.seen[id] ?? 0;
  }

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

  /** An empty set is not recorded: after the server died there is nothing to see, and that is exactly when the last picture matters. */
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

  /** A pane match settles the id, except for a Codex process whose id is a placeholder until its first message. */
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
      writeFileSync(this.path, JSON.stringify({ seen: this.seen, opened: this.opened, hub: this.hub, reviews: this.reviews } satisfies State));
      this.fresh = false;
    } catch {
      // A read-only cache dir only costs persistence, not functionality.
    }
  }
}

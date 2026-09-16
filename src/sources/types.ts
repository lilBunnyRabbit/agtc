/** Where a session's terminal shows: a Terminal.app tab or a tmux pane, keyed by tty name. */
export interface Surface {
  title: string;
  /** Someone is looking at it right now. */
  viewed: boolean;
  tmux?: TmuxLocation;
}

export interface TmuxLocation {
  paneId: string;
  session: string;
  windowId: string;
  windowIndex: number;
  /** The window's name, or the name the pane's window had before it went on stage. */
  windowName: string;
  /** tty of a client attached to the pane's session, when there is one. */
  clientTty?: string;
}

export type Surfaces = Map<string, Surface>;

export interface SourceOptions {
  surfaces: Surfaces;
  /** Inactive sessions older than this timestamp are dropped. */
  sinceMs: number;
}

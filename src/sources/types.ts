export interface Surface {
  title: string;
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
  clientTty?: string;
}

export type Surfaces = Map<string, Surface>;

export interface SourceOptions {
  surfaces: Surfaces;
  sinceMs: number;
}

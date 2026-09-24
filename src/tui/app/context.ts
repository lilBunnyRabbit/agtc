import type { Options } from "../../cli";
import type { Session } from "../../model/session";
import type { StateStore } from "../../model/state-store";
import type { Prompt, UiState } from "../render";

export type Ask = Omit<Prompt, "value"> & { value?: string };

export interface AppContext {
  readonly options: Options;
  readonly state: StateStore;
  readonly ui: UiState;
  sessions: Session[];
  readonly visible: Session[];
  say(message: string): void;
  ask(prompt: Ask, submit: (value: string) => void): void;
  draw(): void;
  refresh(): Promise<void>;
  refreshSoon(): void;
  markSeen(session: Session): void;
  select(session: Session): void;
}

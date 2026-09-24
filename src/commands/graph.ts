import type { Options } from "../cli";
import type { Session } from "../model/session";
import { collectSessions } from "../model/sessions";
import { StateStore } from "../model/state-store";
import { STATE_FILE } from "../paths";
import { ANSI, style } from "../tui/ansi";
import { renderGraph } from "../tui/graph";
import { Key } from "../tui/keys";
import { computeLayout, terminalSize } from "../tui/layout";
import { renderHeader } from "../tui/render";
import { openScreen } from "../tui/terminal";

const HEADER_LINES = 2;
const MARGIN = " ";

export function watchGraph(options: Options): void {
  const out = process.stdout;
  let sessions: Session[] = [];
  let refreshedAt = Date.now();
  let refreshing = false;

  const draw = () => {
    const size = terminalSize();
    const layout = computeLayout(size);
    const live = sessions.filter((s) => s.status !== "inactive");
    const room = Math.max(1, size.rows - HEADER_LINES);
    const body = renderGraph(live, layout);
    const shown = body.length > room ? [...body.slice(0, room - 1), style(`${MARGIN}…`, ANSI.dim)] : body;
    out.write(ANSI.clearScreen + [renderHeader(sessions, live, { query: "", refreshedAt }, layout), "", ...shown].join("\n"));
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      // Loaded every poll: the hub owns the file, and its marks turn done into idle here too.
      sessions = await collectSessions({ days: options.days, state: StateStore.load(STATE_FILE, { readOnly: true }) });
      refreshedAt = Date.now();
      draw();
    } finally {
      refreshing = false;
    }
  };

  openScreen({
    onResize: draw,
    onKey: (key) => {
      if (key === "q" || key === Key.escape || key === Key.ctrlC) process.exit(0);
    },
  });
  draw();
  void refresh();
  setInterval(() => void refresh(), options.intervalMs);
}

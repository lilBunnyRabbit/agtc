// agtc — Agent Traffic Control. Entry point; see `agtc --help` or src/cli.ts for usage.
import pkg from "../package.json";
import { USAGE, parseArgs } from "./cli";
import { STATE_FILE } from "./paths";
import { SeenStore } from "./seen-store";
import { collectSessions } from "./sessions";
import { selfUpdate } from "./update";
import { App } from "./tui/app";
import { terminalSize } from "./tui/layout";
import { initialUiState, renderFrame } from "./tui/render";

const options = parseArgs(process.argv.slice(2));
const seen = () => SeenStore.load(STATE_FILE);

switch (options.mode) {
  case "help":
    console.log(USAGE);
    break;

  case "version":
    console.log(pkg.version);
    break;

  case "json": {
    const sessions = await collectSessions({ days: options.days, seen: seen() });
    console.log(JSON.stringify(sessions.map(({ searchText, prompts, ...session }) => session), null, 2));
    break;
  }

  case "once": {
    const sessions = await collectSessions({ days: options.days, seen: seen() });
    const ui = { ...initialUiState(true), showDetail: true };
    console.log(renderFrame(sessions, ui, terminalSize()).lines.join("\n"));
    break;
  }

  case "update":
    process.exit(await selfUpdate());

  case "tui":
    new App(options, seen()).start();
    break;
}

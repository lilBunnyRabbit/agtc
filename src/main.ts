// agtc — Agent Traffic Control. Entry point; see `agtc --help` or src/cli.ts for usage.
import pkg from "../package.json";
import { USAGE, parseArgs } from "./cli";
import { attachAgent } from "./attach";
import { openHub } from "./hub";
import { STATE_FILE } from "./paths";
import { SeenStore } from "./seen-store";
import { sendToAgent } from "./send";
import { collectSessions } from "./sessions";
import { detectOwnPane } from "./sources/tmux";
import { App } from "./tui/app";
import { terminalSize } from "./tui/layout";
import { initialUiState, renderFrame } from "./tui/render";
import { selfUpdate } from "./update";

const options = parseArgs(process.argv.slice(2));
const seen = () => SeenStore.load(STATE_FILE);
await detectOwnPane();

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

  case "tmux":
    process.exit(await openHub(process.argv.slice(1)));

  case "attach":
    process.exit(await attachAgent(options.dir));

  case "send":
    process.exit(await sendToAgent({ dir: options.dir, file: options.file, row: options.row, selection: process.env.AGTC_SELECTION }));

  case "tui":
    new App(options, seen()).start();
    break;
}

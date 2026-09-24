import pkg from "../package.json";
import { USAGE, parseArgs } from "./cli";
import { attachAgent } from "./commands/attach";
import { watchGraph } from "./commands/graph";
import { sendToAgent } from "./commands/send";
import { selfUpdate } from "./commands/update";
import { worktreesCommand } from "./commands/worktrees";
import { collectSessions } from "./model/sessions";
import { StateStore } from "./model/state-store";
import { STATE_FILE } from "./paths";
import { detectOwnPane } from "./tmux/env";
import { openHub } from "./tmux/hub";
import { App } from "./tui/app/app";
import { terminalSize } from "./tui/layout";
import { initialUiState, renderFrame } from "./tui/render";

const options = parseArgs(process.argv.slice(2));
const state = () => StateStore.load(STATE_FILE);
await detectOwnPane();

switch (options.mode) {
  case "help":
    console.log(USAGE);
    break;

  case "version":
    console.log(pkg.version);
    break;

  case "json": {
    const sessions = await collectSessions({ days: options.days, state: state() });
    console.log(JSON.stringify(sessions.map(({ searchText, prompts, ...session }) => session), null, 2));
    break;
  }

  case "once": {
    const sessions = await collectSessions({ days: options.days, state: state() });
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
    new App(options, state()).start();
    break;

  case "graph":
    watchGraph(options);
    break;

  case "worktrees":
    process.exit(await worktreesCommand(options));
}

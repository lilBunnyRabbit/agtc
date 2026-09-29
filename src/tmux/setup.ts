import { succeeds } from "../lib/shell";
import { ANSWER_KEY, MENU_KEY, paneKey } from "../tui/keys";
import { tmux } from "./env";

const BACK_KEYS: [table: string, key: string][] = [
  ["prefix", "a"],
  ["root", "M-a"],
];
const JUMP_KEYS: [key: string, agtcKey: string][] = [
  ["M-j", "J"],
  ["M-k", "K"],
  ...Array.from({ length: 9 }, (_, i): [string, string] => [`M-${i + 1}`, String(i + 1)]),
];
/** A binding of ours: an earlier run's pane id (list-keys prints it quoted), or the line the README used to ask for. */
const OUR_BINDING = /(select-pane -Z -t "?(%\d+|hub\.0)"?|send-keys -t "?%\d+"? \S+| (code|edit|menu) --pane #\{pane_id\}( --hub %\d+)?\\?"?|send-keys -t %\d+ -l '\S+'\\?"?|send-keys -t %\d+ #\{s\/d\/\/:mouse_status_range\}" \} \{ switch-client -t = \})$/;
/** Keys 1.9.0 bound to code and edit; the menu has both. */
const RETIRED_KEYS: [table: string, key: string][] = [
  ["prefix", "e"],
  ["root", "M-e"],
  ["root", "M-o"],
];
const RETIRED_BINDING = / (code|edit) --pane #\{pane_id\}\\?"?$/;
const MENU_KEYS: [table: string, key: string][] = [
  ["prefix", "Space"],
  ["root", "M-Space"],
];
/** A hub key for the row of the pane you are in. What it asks, it asks in a popup over that pane. */
const PANE_KEYS: [key: string, agtcKey: string][] = [
  ["M-n", "n"],
  ["M-y", ANSWER_KEY],
];
/** tmux's own bindings of prefix space and of a click on the status line; the menu keeps the first one more space away, the click falls back to the second. */
const STOCK_BINDINGS = ["next-layout", "switch-client -t ="];
const STATUS_CLICK = "MouseDown1Status";

/** One argument: tmux parses the string itself, an argv `;` would end the bind-key command instead. */
export const backToHub = (hubPane: string) => `select-window -t ${hubPane} ; select-pane -Z -t ${hubPane}`;
const KEY_LINE = /^bind-key\s+(?:-r\s+)?-T\s+(\S+)\s+(\S+)\s+(.*)$/;

/**
 * Runs on every start inside tmux since bindings live in the server and pane ids change.
 * A key the user bound to something else is left alone. Claude Code drops to 256 colours
 * under TMUX unless CLAUDE_CODE_TMUX_TRUECOLOR says otherwise.
 */
export async function setupTmux(ownPane: string): Promise<void> {
  if (process.env.AGTC_TMUX_SETUP === "0") return;
  await succeeds(["tmux", "set-option", "-t", ownPane, "mouse", "on"]);
  await succeeds(["tmux", "set-environment", "-t", ownPane, "CLAUDE_CODE_TMUX_TRUECOLOR", "1"]);
  const back = backToHub(ownPane);
  // Through run-shell: send-keys leaves formats in its keys alone. agtc holds the sessions, so it opens the menu.
  const typed = (key: string) => `run-shell -b "tmux send-keys -t ${ownPane} -l '${paneKey({ paneId: "%#{s/%//:pane_id}", key }).replace("\x1b", "\\e")}'"`;
  const menu = typed(MENU_KEY);
  const bindings: [table: string, key: string, command: string][] = [
    ...MENU_KEYS.map(([table, key]): [string, string, string] => [table, key, menu]),
    ...PANE_KEYS.map(([key, agtcKey]): [string, string, string] => ["root", key, typed(agtcKey)]),
    ["root", STATUS_CLICK, statusClick(ownPane)],
    ...BACK_KEYS.map(([table, key]): [string, string, string] => [table, key, back]),
    ...JUMP_KEYS.map(([key, agtcKey]): [string, string, string] => ["root", key, `select-window -t ${ownPane} ; send-keys -t ${ownPane} ${agtcKey}`]),
  ];
  for (const [table, key] of RETIRED_KEYS) {
    if (RETIRED_BINDING.test((await boundCommand(table, key)) ?? "")) await succeeds(["tmux", "unbind-key", "-T", table, key]);
  }
  for (const [table, key, command] of bindings) {
    const bound = await boundCommand(table, key);
    if (bound && !STOCK_BINDINGS.includes(bound) && !OUR_BINDING.test(bound)) continue;
    await succeeds(["tmux", "bind-key", "-T", table, key, command]);
  }
}

/** A digit in the status line is the hub's digit; any other click does what tmux did with it. */
export const statusClick = (hubPane: string) =>
  `if-shell -F "#{m:d*,#{mouse_status_range}}" { run-shell -b "tmux select-window -t ${hubPane} && tmux send-keys -t ${hubPane} #{s/d//:mouse_status_range}" } { switch-client -t = }`;

async function boundCommand(table: string, key: string): Promise<string | undefined> {
  for (const line of (await tmux("list-keys", "-T", table)).split("\n")) {
    const match = line.match(KEY_LINE);
    if (match && match[1] === table && match[2] === key) return match[3];
  }
  return undefined;
}

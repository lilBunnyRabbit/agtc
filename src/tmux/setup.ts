import { succeeds } from "../lib/shell";
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
const OUR_BINDING = /(select-pane -Z -t "?(%\d+|hub\.0)"?|send-keys -t "?%\d+"? \S+)$/;
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
  // One argument: tmux parses the string itself, an argv `;` would end the bind-key command instead.
  const back = `select-window -t ${ownPane} ; select-pane -Z -t ${ownPane}`;
  const bindings: [table: string, key: string, command: string][] = [
    ...BACK_KEYS.map(([table, key]): [string, string, string] => [table, key, back]),
    ...JUMP_KEYS.map(([key, agtcKey]): [string, string, string] => ["root", key, `select-window -t ${ownPane} ; send-keys -t ${ownPane} ${agtcKey}`]),
  ];
  for (const [table, key, command] of bindings) {
    const bound = await boundCommand(table, key);
    if (bound && !OUR_BINDING.test(bound)) continue;
    await succeeds(["tmux", "bind-key", "-T", table, key, command]);
  }
}

async function boundCommand(table: string, key: string): Promise<string | undefined> {
  for (const line of (await tmux("list-keys", "-T", table)).split("\n")) {
    const match = line.match(KEY_LINE);
    if (match && match[1] === table && match[2] === key) return match[3];
  }
  return undefined;
}

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseJsonLine, readJson } from "../../lib/files";
import { CLAUDE_DIR } from "../../paths";

/**
 * Every Claude session listens on a unix socket for messages from other sessions (what its
 * `SendMessage` tool uses). A line of JSON each: the auth line with the token the session
 * published next to its registration, then the message. Delivered, it is a turn of its own:
 * an idle session wakes, a busy one reads it between tool calls.
 */
export type Delivery = "delivered" | "held" | "refused" | "unreachable";

export interface Inbox {
  pid: number;
  socket: string;
}

const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");

/** The token sits in `<pid>.<hash>.key` beside `<pid>.json`. */
export function readPeerToken(pid: number): string | undefined {
  if (!existsSync(SESSIONS_DIR)) return undefined;
  const file = readdirSync(SESSIONS_DIR).find((f) => f.startsWith(`${pid}.`) && f.endsWith(".key"));
  return file ? readJson<{ peerToken?: string }>(join(SESSIONS_DIR, file))?.peerToken : undefined;
}

export const inboxFrames = (token: string | undefined, text: string): string =>
  [...(token ? [{ type: "auth", token }] : []), { type: "user", message: { role: "user", content: text } }].map((frame) => `${JSON.stringify(frame)}\n`).join("");

/** What the session answers on the same connection, when it does; a silent close counts as delivered. */
function readStatus(line: string): Delivery | undefined {
  const frame = parseJsonLine<{ type?: string; status?: string }>(line);
  if (frame?.type !== "peer_message_status") return undefined;
  if (frame.status === "held") return "held";
  if (frame.status === "refused" || frame.status === "dropped") return "refused";
  return "delivered";
}

const REPLY_WAIT_MS = 1500;

/** Bun sockets do not buffer: a write takes what fits (8 KB seen) and `drain` asks for the rest. */
class Outgoing {
  private sent = 0;
  constructor(private readonly bytes: Uint8Array) {}
  write(connection: Bun.Socket<undefined>): boolean {
    while (this.sent < this.bytes.length) {
      const written = connection.write(this.bytes.subarray(this.sent));
      if (written <= 0) return false;
      this.sent += written;
    }
    return true;
  }
}

export function postToInbox({ pid, socket }: Inbox, text: string): Promise<Delivery> {
  if (!existsSync(socket)) return Promise.resolve("unreachable");
  const outgoing = new Outgoing(new TextEncoder().encode(inboxFrames(readPeerToken(pid), text)));
  return new Promise((resolve) => {
    let received = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let open: Bun.Socket<undefined> | undefined;
    const settle = (delivery: Delivery) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      open?.end();
      resolve(delivery);
    };
    const flush = (connection: Bun.Socket<undefined>) => {
      if (outgoing.write(connection) && !timer) timer = setTimeout(() => settle("delivered"), REPLY_WAIT_MS);
    };
    const handlers: Bun.SocketHandler<undefined> = {
      open(connection) {
        open = connection;
        flush(connection);
      },
      drain: flush,
      data(_connection, data) {
        received += data.toString();
        for (const line of received.split("\n")) {
          const status = readStatus(line);
          if (status) return settle(status);
        }
      },
      close() {
        settle(timer ? "delivered" : "unreachable");
      },
      error() {
        settle("unreachable");
      },
      connectError() {
        settle("unreachable");
      },
    };
    Bun.connect({ unix: socket, socket: handlers }).catch(() => settle("unreachable"));
  });
}

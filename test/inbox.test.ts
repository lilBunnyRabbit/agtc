import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compose } from "../src/commands/send";
import { inboxFrames, postToInbox } from "../src/sources/claude/inbox";

describe("inbox frames", () => {
  test("the auth line first, then the message, one JSON line each", () => {
    const lines = inboxFrames("tok", "hello\nworld").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: "auth", token: "tok" },
      { type: "user", message: { role: "user", content: "hello\nworld" } },
    ]);
    expect(inboxFrames(undefined, "x").split("\n").filter(Boolean)).toHaveLength(1);
  });
});

/** A session's inbox stand-in: collects what arrives, answers or stays quiet, closes or not. */
interface Fake {
  path: string;
  received: () => string;
  stop: () => void;
}

function listen(reply: string | undefined, closeAfter: boolean): Fake {
  const path = join(tmpdir(), `agtc-inbox-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);
  let received = "";
  const server = Bun.listen<undefined>({
    unix: path,
    socket: {
      data(connection, data) {
        received += data.toString();
        if (!received.endsWith("\n")) return;
        if (reply) connection.write(`${reply}\n`);
        if (closeAfter) connection.end();
      },
    },
  });
  return { path, received: () => received, stop: () => server.stop(true) };
}

describe("postToInbox", () => {
  const fakes: Fake[] = [];
  const start = (reply?: string, closeAfter = true) => {
    const fake = listen(reply, closeAfter);
    fakes.push(fake);
    return fake;
  };
  afterEach(() => {
    for (const fake of fakes.splice(0)) {
      fake.stop();
      rmSync(fake.path, { force: true });
    }
  });

  test("a message far over one write arrives whole", async () => {
    const fake = start();
    const text = "x".repeat(200_000);
    expect(await postToInbox({ pid: 0, socket: fake.path }, text)).toBe("delivered");
    const lines = fake.received().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).message.content).toHaveLength(200_000);
  });

  test("the status line decides: held, refused, dropped", async () => {
    expect(await postToInbox({ pid: 0, socket: start('{"type":"peer_message_status","status":"held"}').path }, "x")).toBe("held");
    expect(await postToInbox({ pid: 0, socket: start('{"type":"peer_message_status","status":"refused"}').path }, "x")).toBe("refused");
    expect(await postToInbox({ pid: 0, socket: start('{"type":"peer_message_status","status":"dropped"}', false).path }, "x")).toBe("refused");
  });

  test("a silent receiver that keeps the connection open counts as delivered after the wait", async () => {
    expect(await postToInbox({ pid: 0, socket: start(undefined, false).path }, "x")).toBe("delivered");
  });

  test("no socket, or a socket file nobody listens on, is unreachable", async () => {
    expect(await postToInbox({ pid: 0, socket: "/definitely/missing.sock" }, "x")).toBe("unreachable");
    const fake = start();
    fake.stop();
    if (!existsSync(fake.path)) return;
    expect(await postToInbox({ pid: 0, socket: fake.path }, "x")).toBe("unreachable");
  });
});

describe("compose", () => {
  test("reference alone leaves room to type, a message or a selection ends the line", () => {
    expect(compose("a.ts", "3", undefined)).toBe("a.ts:3 ");
    expect(compose(undefined, undefined, undefined)).toBe("");
    expect(compose(undefined, undefined, undefined, " fix this ")).toBe("fix this\n");
    expect(compose("a.ts", "3", undefined, "rename it")).toBe("a.ts:3\nrename it\n");
    expect(compose("a.ts", "3", "const x = 1;\n", "why")).toBe("a.ts:3\n```ts\nconst x = 1;\n```\nwhy\n");
    expect(compose("a.ts", undefined, "x")).toBe("a.ts\n```ts\nx\n```\n");
  });
});

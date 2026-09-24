import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastAgentMessage, summarizeRollout } from "../src/sources/codex/rollout";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "agtc-rollout-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const T0 = "2026-09-24T10:00:00.000Z";
const T1 = "2026-09-24T10:00:10.000Z";
const T2 = "2026-09-24T10:00:20.000Z";

function rollout(name: string, events: object[]): string {
  const path = join(dir, name);
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

describe("summarizeRollout", () => {
  test("a completed task is idle at its completion time, prompts oldest first", () => {
    const path = rollout("done.jsonl", [
      { timestamp: T0, payload: { type: "user_message", message: "first" } },
      { timestamp: T0, payload: { type: "task_started" } },
      { timestamp: T1, payload: { type: "user_message", message: "second" } },
      { timestamp: T2, payload: { type: "task_complete", last_agent_message: "report" } },
    ]);
    const summary = summarizeRollout(path);
    expect(summary.status).toBe("idle");
    expect(summary.at).toBe(Date.parse(T2));
    expect(summary.prompts).toEqual(["first", "second"]);
    expect(summary.lastPromptAt).toBe(Date.parse(T1));
  });

  test("a started task is busy", () => {
    const path = rollout("busy.jsonl", [{ timestamp: T0, payload: { type: "task_complete" } }, { timestamp: T1, payload: { type: "task_started" } }]);
    expect(summarizeRollout(path).status).toBe("busy");
  });

  test("an approval request without output since is needs input, with output it was answered", () => {
    const waiting = rollout("wait.jsonl", [{ timestamp: T0, payload: { type: "task_started" } }, { timestamp: T1, payload: { type: "exec_approval_request" } }]);
    expect(summarizeRollout(waiting).status).toBe("needs input");
    const answered = rollout("answered.jsonl", [
      { timestamp: T0, payload: { type: "exec_approval_request" } },
      { timestamp: T1, payload: { type: "exec_command_output" } },
    ]);
    expect(summarizeRollout(answered).status).toBe("busy");
  });

  test("an empty log is idle now", () => {
    const path = rollout("empty.jsonl", []);
    const summary = summarizeRollout(path);
    expect(summary.status).toBe("idle");
    expect(summary.prompts).toEqual([]);
  });
});

describe("lastAgentMessage", () => {
  test("the last completed turn's message, nothing while a turn runs", () => {
    const done = rollout("msg.jsonl", [
      { timestamp: T0, payload: { type: "task_complete", last_agent_message: "old" } },
      { timestamp: T1, payload: { type: "task_started" } },
      { timestamp: T2, payload: { type: "task_complete", last_agent_message: "  new  " } },
    ]);
    expect(lastAgentMessage(done)).toBe("new");
    const running = rollout("running.jsonl", [
      { timestamp: T0, payload: { type: "task_complete", last_agent_message: "old" } },
      { timestamp: T1, payload: { type: "task_started" } },
    ]);
    expect(lastAgentMessage(running)).toBeUndefined();
  });
});

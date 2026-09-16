/** Runs a command and returns its trimmed stdout. Failures (including a missing binary) yield "". */
export async function run(argv: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim();
  } catch {
    return "";
  }
}

/** Runs a command and keeps its output either way, for messages that must show git's complaint. */
export async function exec(argv: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { ok: (await proc.exited) === 0, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: String(error) };
  }
}

/** Runs a command for its side effect. True when it exited with 0. */
export async function succeeds(argv: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** Starts a command and leaves it running. False when the binary is missing. */
export function launch(argv: string[], env: Record<string, string | undefined> = process.env): boolean {
  try {
    Bun.spawn(argv, { env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function copyToClipboard(text: string): void {
  Bun.spawnSync(["pbcopy"], { stdin: new TextEncoder().encode(text) });
}

/** Single-quotes a string for a POSIX shell, so nothing inside it expands. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

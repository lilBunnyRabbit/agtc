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

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

export async function exec(argv: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { ok: (await proc.exited) === 0, output: (stdout + stderr).trim() };
  } catch (error) {
    return { ok: false, output: String(error) };
  }
}

export async function succeeds(argv: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

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

export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

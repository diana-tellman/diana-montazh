/** Tiny argument parser: positional args + --key value / --flag. */
export function parseArgs(argv = process.argv.slice(2)) {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opt[key] = next;
        i++;
      } else opt[key] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

export function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Print machine-readable result for Skills, then a human line. */
export function out(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}

export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`ОШИБКА: ${msg}`);
    process.exit(1);
  }
}

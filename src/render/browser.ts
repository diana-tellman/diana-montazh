import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Use the Chromium headless shell pre-installed in Claude Code cloud containers
 * when present; otherwise Remotion downloads its own (needs network access).
 */
export function findBrowserExecutable(): string | null {
  if (process.env.REMOTION_BROWSER && existsSync(process.env.REMOTION_BROWSER)) return process.env.REMOTION_BROWSER;
  const base = "/opt/pw-browsers";
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()) {
    const exe = join(base, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (existsSync(exe)) return exe;
  }
  return null;
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { MODELS_DIR, ROOT } from "../core/store";
import { ensureModel, modelDir } from "../speech/models";

const run = promisify(execFile);

export const VENV = join(MODELS_DIR, ".venv");
const PY = join(VENV, "bin", "python");
const REQ = join(ROOT, "analysis", "requirements.txt");
const SCRIPT = join(ROOT, "analysis", "analyze.py");

async function has(cmd: string): Promise<boolean> {
  try {
    await run("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/** MediaPipe needs libEGL/libGLESv2 even on CPU. Installed automatically when missing (cloud runs as root). */
async function ensureSystemLibs(log: (s: string) => void): Promise<void> {
  const { stdout } = await run("sh", ["-c", "ldconfig -p | grep -c -E 'libEGL.so.1|libGLESv2.so.2' || true"]);
  if (Number(stdout.trim()) >= 2) return;
  log("Установка системных библиотек для анализа лица (один раз)…");
  const apt = "apt-get install -y -qq libegl1 libgles2 >/dev/null 2>&1 || (apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq libegl1 libgles2 >/dev/null 2>&1)";
  await run("sh", ["-c", apt], { timeout: 300_000 });
}

/**
 * Isolated Python env with pinned packages + verified models. Fully automatic:
 * the student never installs anything. Re-installs only when requirements change.
 */
export async function ensureAnalysisEnv(log: (s: string) => void = () => {}): Promise<{ python: string; models: string }> {
  await ensureSystemLibs(log);
  const reqHash = createHash("sha256").update(readFileSync(REQ)).digest("hex");
  const stamp = join(VENV, ".requirements.sha256");
  if (!existsSync(PY) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== reqHash) {
    log("Подготовка модуля анализа лица (один раз за сессию, ~1 мин)…");
    if (await has("uv")) {
      await run("uv", ["venv", "--allow-existing", "-q", VENV], { timeout: 300_000 });
      await run("uv", ["pip", "install", "-q", "--python", PY, "-r", REQ], { timeout: 900_000 });
    } else {
      await run("python3", ["-m", "venv", VENV], { timeout: 300_000 });
      await run(PY, ["-m", "pip", "install", "-q", "-r", REQ], { timeout: 900_000 });
    }
    writeFileSync(stamp, reqHash);
  }
  await ensureModel(MODELS_DIR, "mp-face-landmarker", log);
  await ensureModel(MODELS_DIR, "mp-selfie-multiclass", log);
  return { python: PY, models: modelDir(MODELS_DIR, "mp-face-landmarker") };
}

/** Run analysis/analyze.py with the managed env; returns its last JSON line. */
export async function runAnalysis<T>(args: string[], log?: (s: string) => void): Promise<T> {
  const env = await ensureAnalysisEnv(log);
  const { stdout } = await run(env.python, [SCRIPT, ...args], {
    env: { ...process.env, DMS_MP_MODELS: env.models, U2NET_HOME: join(MODELS_DIR, "rembg"), GLOG_minloglevel: "2", TF_CPP_MIN_LOG_LEVEL: "2" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 3_600_000,
  });
  const line = stdout.trim().split("\n").pop() ?? "null";
  return JSON.parse(line) as T;
}

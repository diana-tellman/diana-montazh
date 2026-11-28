/**
 * npm run hf -- new <dir> [--seconds 6] [--format 9:16|16:9|1:1]
 * npm run hf -- render <dir> [--out <file.mp4>]
 * npm run hf -- snapshot <dir> [--at 1,2.5,4]
 *
 * HyperFrames (HeyGen, Apache-2.0): animation written as HTML + GSAP, rendered to MP4.
 * Used for pure graphics WITHOUT a speaker: logo/intro, UI animation, kinetic typography, infographics.
 * Expert video (face, mattes, approval gate) stays on Remotion (plan / showcase).
 *
 * Works offline inside the cloud sandbox: GSAP and Kazakh-capable fonts are copied next to index.html
 * (no CDN), the pre-installed Chromium is used, telemetry and agent-skill downloads are off.
 * Never use HyperFrames' speech synthesis (TTS) or paid HeyGen features — studio rule: own voice only.
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ROOT } from "../src/core/store";
import { findBrowserExecutable } from "../src/render/browser";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const BIN = join(ROOT, "node_modules", ".bin", "hyperframes");

export function hfEnv(): NodeJS.ProcessEnv {
  const browser = findBrowserExecutable();
  return {
    ...process.env,
    HYPERFRAMES_NO_TELEMETRY: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    ...(browser ? { HYPERFRAMES_BROWSER_PATH: browser } : {}),
    HYPERFRAMES_CACHE_DIR: join(ROOT, "models", "hyperframes-cache"),
  };
}

const FONTS: Array<[string, string, string, string]> = [
  // [family, weight, style, fontsource file stem]
  ["Inter Tight", "900", "normal", "inter-tight/files/inter-tight"],
  ["Inter Tight", "700", "normal", "inter-tight/files/inter-tight"],
  ["Cormorant Garamond", "700", "italic", "cormorant-garamond/files/cormorant-garamond"],
  ["Bad Script", "400", "normal", "bad-script/files/bad-script"],
];

function template(seconds: number, w: number, h: number, faces: string): string {
  return `<!doctype html>
<html lang="kk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <script src="./vendor/gsap.min.js"></script>
    <style>
${faces}
      :root { --milk: #F7F5F2; --pink: #F2D5E4; --burgundy: #8D263E; --graphite: #191919; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: var(--graphite); }
      #root { width: 100%; height: 100%; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; }
      .label { font-family: "Inter Tight"; font-weight: 700; font-size: ${Math.round(w * 0.045)}px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--milk); }
      .big { font-family: "Inter Tight"; font-weight: 900; font-size: ${Math.round(w * 0.2)}px; letter-spacing: -0.045em; line-height: 0.9; color: var(--pink); }
      .italic { font-family: "Cormorant Garamond"; font-style: italic; font-weight: 700; font-size: ${Math.round(w * 0.11)}px; color: var(--milk); margin-top: -${Math.round(w * 0.02)}px; }
      .line { width: 0; height: ${Math.round(w * 0.008)}px; background: var(--burgundy); margin-top: ${Math.round(w * 0.03)}px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${seconds}" data-width="${w}" data-height="${h}">
      <!-- One clip = one block; the lines inside are animated by id. Replace the texts with the user's own words. Kazakh: Ә Ғ Қ Ң Ө Ұ Ү Һ І -->
      <div id="stack" class="clip" data-start="0" data-duration="${seconds}" data-track-index="0" style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
        <div id="label" class="label">телефоннан</div>
        <div id="big" class="big">МОНТАЖ</div>
        <div id="italic" class="italic">әдемі әрі оңай</div>
        <div id="line" class="line"></div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#label", { opacity: 0, letterSpacing: "0.6em" }, { opacity: 1, letterSpacing: "0.18em", duration: 0.6, ease: "power3.out" }, 0.2);
      tl.fromTo("#big", { opacity: 0, y: 80, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.7, ease: "power4.out" }, 0.6);
      tl.fromTo("#italic", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.8, ease: "power2.inOut" }, 1.3);
      tl.fromTo("#line", { width: 0 }, { width: ${Math.round(w * 0.5)}, duration: 0.6, ease: "power2.out" }, 1.9);
      tl.to(["#label", "#big", "#italic", "#line"], { opacity: 0, y: -40, duration: 0.3, stagger: 0.04 }, ${Math.max(1, seconds - 0.5)});
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

main(async () => {
  const { pos, opt } = parseArgs();
  const [cmd, d] = pos;
  if (!cmd || !d) throw new Error("Команды: new <папка> | render <папка> | snapshot <папка>");
  const dir = resolve(d);
  if (cmd === "new") {
    if (existsSync(join(dir, "index.html"))) throw new Error(`Уже есть ${dir}/index.html`);
    const seconds = Number(str(opt.seconds) ?? 6);
    const fmt = str(opt.format) ?? "9:16";
    const [w, h] = fmt === "16:9" ? [1920, 1080] : fmt === "1:1" ? [1080, 1080] : [1080, 1920];
    mkdirSync(join(dir, "vendor", "fonts"), { recursive: true });
    copyFileSync(join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js"), join(dir, "vendor", "gsap.min.js"));
    const faces: string[] = [];
    for (const [family, weight, style, stem] of FONTS) {
      for (const subset of ["cyrillic-ext", "cyrillic", "latin"]) {
        const f = join(ROOT, "node_modules", "@fontsource", `${stem}-${subset}-${weight}-${style}.woff2`);
        if (!existsSync(f)) continue;
        copyFileSync(f, join(dir, "vendor", "fonts", basename(f)));
        faces.push(`      @font-face { font-family: "${family}"; font-weight: ${weight}; font-style: ${style}; src: url("./vendor/fonts/${basename(f)}") format("woff2"); }`);
      }
    }
    writeFileSync(join(dir, "index.html"), template(seconds, w, h, faces.join("\n")));
    writeFileSync(join(dir, "hyperframes.json"), JSON.stringify({ name: basename(dir) }, null, 2));
    out({ dir, index: join(dir, "index.html"), fonts: readdirSync(join(dir, "vendor", "fonts")).length, next: `npm run hf -- render ${d}` });
    return;
  }
  if (cmd === "render") {
    const dest = resolve(str(opt.out) ?? join(dir, "out.mp4"));
    const { stdout, stderr } = await run(BIN, ["render", "-o", dest, "--quiet"], { cwd: dir, env: hfEnv(), maxBuffer: 64 << 20, timeout: 1_800_000 }).catch((e) => {
      throw new Error(`HyperFrames render: ${String(e.stderr || e.message).slice(-1500)}`);
    });
    const probe = (await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "json", dest])).stdout;
    out({ out: dest, probe: JSON.parse(probe), log: (stdout + stderr).slice(-400) });
    return;
  }
  if (cmd === "snapshot") {
    const at = str(opt.at) ?? "1,3";
    const { stdout } = await run(BIN, ["snapshot", "--at", at], { cwd: dir, env: hfEnv(), maxBuffer: 64 << 20, timeout: 600_000 });
    out({ dir, log: stdout.slice(-800) });
    return;
  }
  throw new Error("Команды: new | render | snapshot");
});

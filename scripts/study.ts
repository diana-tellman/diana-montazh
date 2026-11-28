/**
 * npm run study -- <video> [--out <dir>] [--transcript <transcript.json>]
 *
 * "Molecular" study of ANY video — the user's source or someone else's reference:
 *  - file: size, codec, fps, resolution, HDR, duration;
 *  - picture: every cut (scene change), shot lengths and pace, a frame at every shot, motion energy curve
 *    (where hands/camera move — good moments for cuts and accents);
 *  - sound: loudness/peaks, speech vs pauses, level in pauses (music bed or silence), transient onsets
 *    (candidate SFX hits / beat) and whether onsets line up with cuts;
 *  - words: speech rate and pauses when a transcript is given.
 * Output: <out>/study.md (readable on the phone), study.json, shots.jpg (one frame per shot), timeline.png (tracks).
 * Claude looks at shots.jpg + timeline.png and writes the style/edit breakdown from them (references/reference.md).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp, { type OverlayOptions } from "sharp";
import { probe } from "../src/core/media";
import { ROOT } from "../src/core/store";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const ff = (args: string[]) => run("ffmpeg", args, { maxBuffer: 256 << 20 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scene cuts via ffmpeg scene score. */
async function cuts(file: string, thr = 0.3): Promise<number[]> {
  const { stderr } = await ff(["-hide_banner", "-i", file, "-an", "-vf", `scale=270:-2,select='gt(scene,${thr})',showinfo`, "-f", "null", "-"]);
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => r2(Number(m[1]))).filter((t, i, a) => i === 0 || t - a[i - 1]! > 0.25);
}

/** Mono 8 kHz PCM → RMS envelope (dB) per 20 ms and spectral-flux-like onsets. */
async function audioEnvelope(file: string) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { encoding: "buffer", maxBuffer: 512 << 20 });
  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
  const hop = 160; // 20 ms
  const env: number[] = [];
  const hf: number[] = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let s = 0;
    let d = 0;
    for (let k = 0; k < hop; k++) {
      const x = pcm[i + k]! / 32768;
      s += x * x;
      if (k) d += Math.abs(x - pcm[i + k - 1]! / 32768);
    }
    env.push(10 * Math.log10(s / hop + 1e-10));
    hf.push(d / hop);
  }
  // onsets: sharp rise of high-frequency energy above the local median
  const onsets: number[] = [];
  for (let i = 3; i < hf.length - 1; i++) {
    const win = hf.slice(Math.max(0, i - 25), i).sort((a, b) => a - b);
    const med = win[Math.floor(win.length / 2)] ?? 0;
    if (hf[i]! > med * 2.6 && hf[i]! > hf[i - 1]! * 1.5 && hf[i]! >= hf[i + 1]! && env[i]! > -45 && (onsets.length === 0 || i * 0.02 - onsets.at(-1)! > 0.18)) onsets.push(r2(i * 0.02));
  }
  return { env, onsets, step: 0.02 };
}

/** Motion energy per frame (mean abs diff of a 54×96 grey thumbnail). */
async function motion(file: string, dur: number) {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-vf", "fps=15,scale=54:96,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 512 << 20 });
  const fsz = 54 * 96;
  const n = Math.floor(stdout.length / fsz);
  const m: number[] = [0];
  for (let f = 1; f < n; f++) {
    let d = 0;
    for (let k = 0; k < fsz; k++) d += Math.abs(stdout[f * fsz + k]! - stdout[(f - 1) * fsz + k]!);
    m.push(d / fsz);
  }
  return { m, step: dur / Math.max(1, n) };
}

main(async () => {
  const { pos, opt } = parseArgs();
  const file = resolve(pos[0] ?? "");
  if (!pos[0] || !existsSync(file)) throw new Error("Укажите видео: npm run study -- <файл>");
  const dir = resolve(str(opt.out) ?? join(ROOT, "out", "study-" + basename(file, extname(file)).replace(/[^\p{L}\p{N}_-]+/gu, "_")));
  mkdirSync(dir, { recursive: true });
  const info = await probe(file);
  const dur = info.durationSec;
  const v = info.video;

  // ---- picture ----
  const cut = v ? await cuts(file) : [];
  const bounds = [0, ...cut, dur];
  const shots = bounds.slice(0, -1).map((a, i) => ({ i: i + 1, start: r2(a), end: r2(bounds[i + 1]!), len: r2(bounds[i + 1]! - a) }));
  const mo = v ? await motion(file, dur) : { m: [], step: 1 };
  const peaks: number[] = [];
  mo.m.forEach((x, i) => {
    const mean = mo.m.reduce((a, b) => a + b, 0) / Math.max(1, mo.m.length);
    if (x > mean * 1.8 && x >= (mo.m[i - 1] ?? 0) && x >= (mo.m[i + 1] ?? 0) && !cut.some((c) => Math.abs(c - i * mo.step) < 0.2) && (peaks.length === 0 || i * mo.step - peaks.at(-1)! > 0.5)) peaks.push(r2(i * mo.step));
  });

  // ---- sound ----
  const a = info.audio ? await audioEnvelope(file) : { env: [], onsets: [], step: 0.02 };
  const { stderr: ln } = info.audio ? await ff(["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]) : { stderr: "" };
  const lufs = Number(ln.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? NaN);
  const peak = Number(ln.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? NaN);
  const { stderr: sd } = info.audio ? await ff(["-hide_banner", "-i", file, "-vn", "-af", "silencedetect=noise=-38dB:d=0.25", "-f", "null", "-"]) : { stderr: "" };
  const sil = [...sd.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [r2(Number(m[1])), r2(Number(m[2]))] as [number, number]);
  // level in pauses: speech-free 20 ms windows below the speech level → music bed if they stay loud
  const sorted = [...a.env].sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const speechLvl = sorted[Math.floor(sorted.length * 0.8)] ?? -20;
  const music = floor > -42 ? "вероятно есть фоновая музыка/шум (в паузах звук не падает ниже −42 дБ)" : "в паузах тишина — музыки, скорее всего, нет";
  const onsetOnCut = a.onsets.filter((o) => cut.some((c) => Math.abs(c - o) < 0.12)).length;

  // ---- words ----
  const trFile = str(opt.transcript);
  let words: Array<{ text: string; start: number; end: number }> = [];
  if (trFile && existsSync(trFile)) {
    const tr = JSON.parse(readFileSync(trFile, "utf8")) as { segments: Array<{ words: Array<{ text: string; startMs: number; endMs: number }> }> };
    words = tr.segments.flatMap((s) => s.words.map((w) => ({ text: w.text.replace(/\*/g, ""), start: w.startMs / 1000, end: w.endMs / 1000 })));
  }
  const speechSec = words.length ? words.at(-1)!.end - words[0]!.start - sil.filter(([s, e]) => s > words[0]!.start && e < words.at(-1)!.end).reduce((x, [s, e]) => x + e - s, 0) : 0;

  // ---- shots.jpg ----
  const tiles: OverlayOptions[] = [];
  const tw = 216;
  const th = v ? Math.round((tw * v.height) / v.width) : 384;
  const cols = Math.min(6, Math.max(1, shots.length));
  for (const s of shots) {
    const f = join(dir, `shot-${s.i}.jpg`);
    await ff(["-v", "error", "-y", "-ss", ((s.start + s.end) / 2).toFixed(2), "-i", file, "-frames:v", "1", "-vf", `scale=${tw}:${th}`, f]);
    const k = s.i - 1;
    tiles.push({ input: f, left: 8 + (k % cols) * (tw + 8), top: 8 + Math.floor(k / cols) * (th + 40) });
    tiles.push({ input: Buffer.from(`<svg width="${tw}" height="32" xmlns="http://www.w3.org/2000/svg"><text x="2" y="24" font-family="Inter,sans-serif" font-size="20" font-weight="700" fill="#fff">${s.i} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} с</text></svg>`), left: 8 + (k % cols) * (tw + 8), top: 8 + Math.floor(k / cols) * (th + 40) + th + 4 });
  }
  if (v) await sharp({ create: { width: cols * (tw + 8) + 8, height: Math.ceil(shots.length / cols) * (th + 40) + 8, channels: 3, background: "#141414" } }).composite(tiles).jpeg({ quality: 82 }).toFile(join(dir, "shots.jpg"));

  // ---- timeline.png: tracks ----
  const TW = 1600;
  const px = (t: number) => 120 + (t / dur) * (TW - 140);
  const rows: string[] = [];
  const row = (y: number, label: string) => rows.push(`<text x="8" y="${y + 22}" font-size="18" fill="#bbb" font-family="Inter,sans-serif">${label}</text>`);
  row(20, "кадры");
  shots.forEach((s, i) => rows.push(`<rect x="${px(s.start)}" y="20" width="${Math.max(1, px(s.end) - px(s.start) - 2)}" height="30" fill="${i % 2 ? "#5b6b8c" : "#7d8fb3"}"/><text x="${px(s.start) + 4}" y="41" font-size="14" fill="#fff" font-family="Inter,sans-serif">${s.i}</text>`));
  row(70, "движение");
  const mmax = Math.max(1, ...mo.m);
  rows.push(`<polyline fill="none" stroke="#f2d5e4" stroke-width="2" points="${mo.m.map((x, i) => `${px(i * mo.step)},${100 - (x / mmax) * 30}`).join(" ")}"/>`);
  peaks.forEach((t) => rows.push(`<circle cx="${px(t)}" cy="72" r="4" fill="#ff7aa8"/>`));
  row(120, "звук");
  rows.push(`<polyline fill="none" stroke="#9fd3a8" stroke-width="1.5" points="${a.env.filter((_, i) => i % 2 === 0).map((x, i) => `${px(i * 2 * a.step)},${170 - Math.max(0, x + 60) * 0.8}`).join(" ")}"/>`);
  sil.forEach(([s, e]) => rows.push(`<rect x="${px(s)}" y="174" width="${Math.max(1, px(e) - px(s))}" height="6" fill="#555"/>`));
  row(190, "удары/SFX?");
  a.onsets.forEach((t) => rows.push(`<line x1="${px(t)}" y1="192" x2="${px(t)}" y2="214" stroke="#ffd27a" stroke-width="2"/>`));
  if (words.length) {
    row(230, "слова");
    words.forEach((w, i) => rows.push(`<text x="${px(w.start)}" y="${250 + (i % 3) * 16}" font-size="13" fill="#ddd" font-family="Inter,sans-serif">${w.text.replace(/[<&>]/g, "")}</text>`));
  }
  for (let s = 0; s <= dur; s += 1) rows.push(`<line x1="${px(s)}" y1="0" x2="${px(s)}" y2="${s % 5 === 0 ? 300 : 8}" stroke="#333"/>${s % 5 === 0 ? `<text x="${px(s) + 2}" y="298" font-size="13" fill="#888">${s}s</text>` : ""}`);
  writeFileSync(join(dir, "timeline.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="305"><rect width="100%" height="100%" fill="#141414"/>${rows.join("")}</svg>`);
  await sharp(join(dir, "timeline.svg")).png().toFile(join(dir, "timeline.png"));

  const study = {
    file: basename(file), durationSec: r2(dur), video: v ? { w: v.width, h: v.height, fps: v.fps, codec: v.codec, hdr: v.hdr, orientation: v.orientation } : null,
    audio: info.audio ? { codec: info.audio.codec, sampleRate: info.audio.sampleRate, lufs: lufs, peakDb: peak, pauses: sil, musicGuess: music, floorDb: r2(floor), speechDb: r2(speechLvl) } : null,
    pace: { cuts: cut, shots, avgShotSec: r2(dur / shots.length), cutsPerMin: r2((cut.length / dur) * 60) },
    motionPeaks: peaks, onsets: a.onsets, onsetsOnCuts: onsetOnCut,
    speech: words.length ? { words: words.length, wordsPerSec: r2(words.length / Math.max(1, speechSec)), first: r2(words[0]!.start), last: r2(words.at(-1)!.end) } : null,
  };
  writeFileSync(join(dir, "study.json"), JSON.stringify(study, null, 2));
  const md = `# Видео зерттеу: ${basename(file)}

## Файл
${r2(dur)} с · ${v ? `${v.width}×${v.height} · ${v.fps} fps · ${v.codec} · ${v.hdr}` : "видео жоқ"} · ${info.audio ? `${info.audio.codec} ${info.audio.sampleRate} Гц` : "дыбыс жоқ"}

## Кадрлар мен ырғақ
- Склейкалар: ${cut.length ? cut.join(", ") + " с" : "жоқ (бір план)"} → ${shots.length} план, орташа ұзақтығы ${study.pace.avgShotSec} с, минутына ${study.pace.cutsPerMin} склейка.
- Қозғалыс шыңдары (қол/камера; акцент пен склейкаға ыңғайлы сәттер): ${peaks.join(", ") || "—"} с.
${shots.map((s) => `- План ${s.i}: ${s.start}–${s.end} с (${s.len} с)`).join("\n")}

## Дыбыс
- Қаттылығы: ${isNaN(lufs) ? "—" : lufs + " LUFS"}, шың ${isNaN(peak) ? "—" : peak + " dBFS"}.
- Кідірістер (≥0.25 с): ${sil.map(([s, e]) => `${s}–${e}`).join(", ") || "—"}.
- Музыка: ${music}.
- Өткір дыбыс соққылары (SFX/бит болуы мүмкін): ${a.onsets.length} — ${a.onsets.slice(0, 40).join(", ")}${a.onsets.length > 40 ? "…" : ""}; склейкамен сәйкес келгені: ${onsetOnCut}.
${study.speech ? `\n## Сөз\n- ${study.speech.words} сөз, секундына ${study.speech.wordsPerSec} сөз; сөз ${study.speech.first}–${study.speech.last} с.\n` : ""}
Файлдар: shots.jpg (әр планнан кадр), timeline.png (жолдар: кадрлар, қозғалыс, дыбыс, соққылар, сөздер).
`;
  writeFileSync(join(dir, "study.md"), md);
  out({ dir, md: join(dir, "study.md"), shots: join(dir, "shots.jpg"), timeline: join(dir, "timeline.png"), summary: { shots: shots.length, cuts: cut, motionPeaks: peaks.length, onsets: a.onsets.length, music, lufs } });
});

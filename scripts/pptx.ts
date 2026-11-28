/**
 * npm run pptx -- <presentation.json> [--out <file.pptx>]
 *
 * Builds an EDITABLE PowerPoint file (opens in Keynote / PowerPoint / Google Slides on the phone)
 * from the approved slide plan (format: src/present/deck.ts), then checks it:
 * LibreOffice opens it → PDF → PNG preview of every slide (preview.jpg) → slide count, size and
 * every text string present in the exported file. Look at preview.jpg yourself before sending.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import PptxGenJS from "pptxgenjs";
import sharp, { type OverlayOptions } from "sharp";
import { DECK_SIZE, DeckSchema, deckWarnings, slideTexts, type Deck, type DeckSlide } from "../src/present/deck";
import { main, out, parseArgs, str } from "./_cli";

const run = promisify(execFile);
const hex = (c: string) => c.replace("#", "").toUpperCase();

function addSlide(pptx: PptxGenJS, d: Deck, s: DeckSlide, i: number, base: string) {
  const { w, h } = DECK_SIZE[d.format];
  const t = d.theme;
  const portrait = h > w;
  const m = Math.min(w, h) * 0.08; // margin
  const slide = pptx.addSlide();
  const dark = s.layout === "title" || s.layout === "end" || s.layout === "quote";
  slide.background = { color: hex(dark ? t.accent : t.bg) };
  const fg = hex(dark ? "#FFFFFF" : t.text);
  const font = t.font;
  const titleSize = portrait ? 34 : 36;
  const bodySize = portrait ? 22 : 22;
  const img = s.image ? resolve(base, s.image) : null;
  if (img && !existsSync(img)) throw new Error(`Слайд ${i + 1}: нет файла картинки ${s.image}`);

  // thin accent line + slide number (not on cover)
  if (s.layout !== "title") {
    slide.addShape(pptx.ShapeType.rect, { x: m, y: m * 0.6, w: Math.min(1.2, w * 0.12), h: 0.06, fill: { color: hex(dark ? t.accent2 : t.accent) }, line: { color: hex(dark ? t.accent2 : t.accent) } });
    slide.addText(String(i + 1), { x: w - m - 0.8, y: h - m * 0.9, w: 0.8, h: 0.4, fontFace: font, fontSize: 11, color: fg, align: "right", transparency: 40 });
  }

  switch (s.layout) {
    case "title":
    case "end":
      slide.addText(s.title, { x: m, y: h * 0.3, w: w - 2 * m, h: h * 0.25, fontFace: font, fontSize: portrait ? 44 : 48, bold: true, color: "FFFFFF", valign: "bottom", fit: "shrink" });
      if (s.subtitle) slide.addText(s.subtitle, { x: m, y: h * 0.57, w: w - 2 * m, h: h * 0.15, fontFace: font, fontSize: 22, color: hex(t.accent2), valign: "top", fit: "shrink" });
      if (img) slide.addImage({ path: img, x: w - m - Math.min(w, h) * 0.3, y: m, w: Math.min(w, h) * 0.3, h: Math.min(w, h) * 0.3, sizing: { type: "cover", w: Math.min(w, h) * 0.3, h: Math.min(w, h) * 0.3 }, rounding: true });
      break;
    case "quote":
      slide.addText(`«${s.title}»`, { x: m, y: h * 0.2, w: w - 2 * m, h: h * 0.5, fontFace: font, fontSize: portrait ? 36 : 40, bold: true, color: "FFFFFF", align: "center", valign: "middle", fit: "shrink" });
      if (s.subtitle) slide.addText(s.subtitle, { x: m, y: h * 0.72, w: w - 2 * m, h: h * 0.1, fontFace: font, fontSize: 18, color: hex(t.accent2), align: "center" });
      break;
    case "number":
      slide.addText(s.value ?? "", { x: m, y: h * 0.18, w: w - 2 * m, h: h * 0.4, fontFace: font, fontSize: portrait ? 110 : 130, bold: true, color: hex(t.accent), align: "center", valign: "middle", fit: "shrink" });
      slide.addText(s.title, { x: m, y: h * 0.6, w: w - 2 * m, h: h * 0.18, fontFace: font, fontSize: 28, color: fg, align: "center", valign: "top", fit: "shrink" });
      if (s.subtitle) slide.addText(s.subtitle, { x: m, y: h * 0.78, w: w - 2 * m, h: h * 0.1, fontFace: font, fontSize: 18, color: fg, align: "center", transparency: 30 });
      break;
    case "compare": {
      slide.addText(s.title, { x: m, y: m, w: w - 2 * m, h: h * 0.14, fontFace: font, fontSize: titleSize, bold: true, color: fg, valign: "bottom", fit: "shrink" });
      const cols = [s.left, s.right];
      const gap = m * 0.5;
      const top = m + h * 0.2;
      const cw = portrait ? w - 2 * m : (w - 2 * m - gap) / 2;
      const ch = portrait ? (h - top - m - gap) / 2 : h - top - m;
      cols.forEach((c, k) => {
        if (!c) return;
        const x = portrait ? m : m + k * (cw + gap);
        const y = portrait ? top + k * (ch + gap) : top;
        slide.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: hex(k === 0 ? "#FFFFFF" : t.accent) }, line: { color: hex(t.accent), width: 1.5 }, rectRadius: 0.15 });
        const col = k === 0 ? hex(t.text) : "FFFFFF";
        slide.addText(c.title, { x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.7, fontFace: font, fontSize: 24, bold: true, color: col, fit: "shrink" });
        slide.addText(c.points.map((p) => ({ text: p, options: { bullet: true, breakLine: true } })), { x: x + 0.25, y: y + 0.95, w: cw - 0.5, h: ch - 1.15, fontFace: font, fontSize: 18, color: col, valign: "top", fit: "shrink", paraSpaceAfter: 6 });
      });
      break;
    }
    case "steps": {
      slide.addText(s.title, { x: m, y: m, w: w - 2 * m, h: h * 0.14, fontFace: font, fontSize: titleSize, bold: true, color: fg, valign: "bottom", fit: "shrink" });
      const items = s.bullets ?? [];
      const top = m + h * 0.2;
      const rowH = Math.min(1.1, (h - top - m) / Math.max(1, items.length));
      items.forEach((b, k) => {
        const y = top + k * rowH;
        slide.addShape(pptx.ShapeType.ellipse, { x: m, y: y + 0.05, w: rowH * 0.7, h: rowH * 0.7, fill: { color: hex(t.accent) }, line: { color: hex(t.accent) } });
        slide.addText(String(k + 1), { x: m, y: y + 0.05, w: rowH * 0.7, h: rowH * 0.7, fontFace: font, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
        slide.addText(b, { x: m + rowH * 0.9, y, w: w - 2 * m - rowH * 0.9, h: rowH * 0.8, fontFace: font, fontSize: bodySize, color: fg, valign: "middle", fit: "shrink" });
      });
      break;
    }
    case "image":
    case "bullets":
    default: {
      slide.addText(s.title, { x: m, y: m, w: w - 2 * m, h: h * 0.14, fontFace: font, fontSize: titleSize, bold: true, color: fg, valign: "bottom", fit: "shrink" });
      const top = m + h * 0.2;
      const hasImg = !!img;
      const imgBox = hasImg ? (portrait ? { x: m, y: top, w: w - 2 * m, h: (h - top - m) * 0.5 } : { x: w / 2 + m * 0.25, y: top, w: w / 2 - m * 1.25, h: h - top - m }) : null;
      if (imgBox && img) slide.addImage({ path: img, ...imgBox, sizing: { type: "contain", w: imgBox.w, h: imgBox.h } });
      const tb = hasImg ? (portrait ? { x: m, y: top + (h - top - m) * 0.55, w: w - 2 * m, h: (h - top - m) * 0.45 } : { x: m, y: top, w: w / 2 - m * 1.25, h: h - top - m }) : { x: m, y: top, w: w - 2 * m, h: h - top - m };
      const pts = s.bullets ?? [];
      if (pts.length) slide.addText(pts.map((p) => ({ text: p, options: { bullet: { code: "25CF" }, breakLine: true } })), { ...tb, fontFace: font, fontSize: bodySize, color: fg, valign: "top", fit: "shrink", paraSpaceAfter: 10 });
      else if (s.subtitle) slide.addText(s.subtitle, { ...tb, fontFace: font, fontSize: bodySize, color: fg, valign: "top", fit: "shrink" });
    }
  }
  if (s.notes) slide.addNotes(s.notes);
}

main(async () => {
  const { pos, opt } = parseArgs();
  const file = resolve(pos[0] ?? "");
  if (!pos[0] || !existsSync(file)) throw new Error("Укажите описание презентации: npm run pptx -- <presentation.json>");
  const deck = DeckSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const base = dirname(file);
  const outFile = resolve(str(opt.out) ?? join(base, (deck.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "presentation") + ".pptx"));
  mkdirSync(dirname(outFile), { recursive: true });

  const pptx = new PptxGenJS();
  const { w, h } = DECK_SIZE[deck.format];
  pptx.defineLayout({ name: "DIANA", width: w, height: h });
  pptx.layout = "DIANA";
  pptx.title = deck.title;
  if (deck.author) pptx.author = deck.author;
  deck.slides.forEach((s, i) => addSlide(pptx, deck, s, i, base));
  await pptx.writeFile({ fileName: outFile });

  // ---- verification: open with LibreOffice, render every slide, compare text ----
  const prev = join(dirname(outFile), basename(outFile, ".pptx") + "-preview");
  rmSync(prev, { recursive: true, force: true });
  mkdirSync(prev, { recursive: true });
  await run("soffice", ["--headless", "--convert-to", "pdf", "--outdir", prev, outFile], { timeout: 180_000 });
  const pdf = join(prev, basename(outFile, ".pptx") + ".pdf");
  if (!existsSync(pdf)) throw new Error("Файл PPTX не открылся в LibreOffice — экспорт неисправен.");
  const info = (await run("pdfinfo", [pdf])).stdout;
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  const ratio = pageSize ? Number(pageSize[1]) / Number(pageSize[2]) : 0;
  const norm = (s: string) => s.replace(/[«»"“”]/g, "").replace(/\s+/g, " ").trim();
  const text = norm((await run("pdftotext", [pdf, "-"])).stdout);
  const missing = deck.slides.flatMap((s, i) => slideTexts(s).filter((x) => !text.includes(norm(x).slice(0, 24))).map((x) => `слайд ${i + 1}: «${x}»`));
  await run("pdftoppm", ["-r", "40", "-png", pdf, join(prev, "p")]);
  const pngs = readdirSync(prev).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const meta = await sharp(join(prev, pngs[0]!)).metadata();
  const tw = meta.width!;
  const th = meta.height!;
  const cols = Math.min(3, pngs.length);
  const gap = 12;
  const comps: OverlayOptions[] = pngs.map((f, i) => ({ input: join(prev, f), left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) }));
  const preview = join(dirname(outFile), basename(outFile, ".pptx") + "-preview.jpg");
  await sharp({ create: { width: cols * (tw + gap) + gap, height: Math.ceil(pngs.length / cols) * (th + gap) + gap, channels: 3, background: "#202020" } }).composite(comps).jpeg({ quality: 85 }).toFile(preview);
  const expectRatio = w / h;
  const checks = {
    opens: true,
    slides: pages === deck.slides.length,
    size: Math.abs(ratio - expectRatio) < 0.02,
    allText: missing.length === 0,
  };
  out({ pptx: outFile, preview, slides: pages, format: deck.format, checks, missing, warnings: deckWarnings(deck), ok: Object.values(checks).every(Boolean) });
});

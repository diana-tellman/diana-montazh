import { z } from "zod";

/**
 * Editable presentation (PPTX) description. Claude writes it from the approved slide plan:
 * projects/<id>/storyboard/presentation.json (or any path) → `npm run pptx -- <file>`.
 * All text comes from the user's material / approved plan. Fonts are ones every phone opens with
 * Kazakh letters (Arial family); the preview is checked with LibreOffice.
 */
export const DeckSlideSchema = z.object({
  /** title = cover; bullets = title + points; image = picture + title + caption; compare = A | B;
   *  number = big figure + label; steps = numbered process; quote = one big thought; end = final call to action. */
  layout: z.enum(["title", "bullets", "image", "compare", "number", "steps", "quote", "end"]).default("bullets"),
  title: z.string().default(""),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).max(7).optional(),
  /** compare: left / right columns. */
  left: z.object({ title: z.string(), points: z.array(z.string()).max(5) }).optional(),
  right: z.object({ title: z.string(), points: z.array(z.string()).max(5) }).optional(),
  /** number: the figure as text (e.g. "87%", "8 жыл"). */
  value: z.string().optional(),
  /** Path to a picture (user photo, slide image, screenshot). Relative to the JSON file. */
  image: z.string().optional(),
  /** Speaker notes (what to say on this slide). */
  notes: z.string().optional(),
});

export const DeckSchema = z.object({
  title: z.string(),
  author: z.string().optional(),
  format: z.enum(["16:9", "9:16", "4:3", "1:1"]).default("16:9"),
  theme: z
    .object({
      bg: z.string().default("#F4F1EE"),
      text: z.string().default("#141414"),
      accent: z.string().default("#9B1C40"),
      accent2: z.string().default("#F4A6C0"),
      font: z.string().default("Arial"),
    })
    .default({ bg: "#F4F1EE", text: "#141414", accent: "#9B1C40", accent2: "#F4A6C0", font: "Arial" }),
  slides: z.array(DeckSlideSchema).min(1).max(60),
});

export type Deck = z.infer<typeof DeckSchema>;
export type DeckSlide = z.infer<typeof DeckSlideSchema>;

/** Slide size in inches for each format. */
export const DECK_SIZE: Record<Deck["format"], { w: number; h: number }> = {
  "16:9": { w: 13.333, h: 7.5 },
  "9:16": { w: 7.5, h: 13.333 },
  "4:3": { w: 10, h: 7.5 },
  "1:1": { w: 7.5, h: 7.5 },
};

/** Every text string of a slide (used to verify nothing was lost in the export). */
export function slideTexts(s: DeckSlide): string[] {
  return [s.title, s.subtitle, s.value, ...(s.bullets ?? []), s.left?.title, ...(s.left?.points ?? []), s.right?.title, ...(s.right?.points ?? [])].filter(
    (x): x is string => !!x && x.trim().length > 0,
  );
}

/** Readability checks before export: too much text per slide, too long lines. */
export function deckWarnings(d: Deck): string[] {
  const w: string[] = [];
  d.slides.forEach((s, i) => {
    const words = slideTexts(s).join(" ").split(/\s+/).filter(Boolean).length;
    if (words > 45) w.push(`Слайд ${i + 1}: ${words} слов — тяжело читать, лучше разделить на два.`);
    if ((s.bullets?.length ?? 0) > 5) w.push(`Слайд ${i + 1}: больше 5 пунктов.`);
    if (s.title.length > 70) w.push(`Слайд ${i + 1}: длинный заголовок (${s.title.length} символов).`);
  });
  return w;
}

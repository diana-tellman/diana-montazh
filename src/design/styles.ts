import { z } from "zod";
import type { FontId } from "./fonts";

/** Brand palette (default). User colours override it via the storyboard `style.colors`. */
export const BRAND = { graphite: "#141414", burgundy: "#6B1732", softWhite: "#F7F5F2", white: "#FFFFFF" } as const;

export const StylePresetSchema = z.enum(["brand", "minimal", "kinetic", "glass", "lime"]);
export type StylePreset = z.infer<typeof StylePresetSchema>;

export const ColorsSchema = z.object({
  /** Main caption text. */
  text: z.string(),
  /** Accent: emphasis words, active-word pill, progress bar. */
  accent: z.string(),
  /** Text drawn on top of the accent (pill text). */
  onAccent: z.string(),
  /** Spoken-not-yet words (dimmed) — or same as text. */
  upcoming: z.string(),
});
export type Colors = z.infer<typeof ColorsSchema>;

export type StyleDef = {
  label: string;
  description: string;
  font: FontId;
  weight: number;
  uppercase: boolean;
  /** Caption font size as a fraction of the frame's short side (1080 → px). Standard Reels size ≈ 48–56 px. */
  size: number;
  lineHeight: number;
  letterSpacing: number;
  colors: Colors;
  /** How the active (being spoken) word is shown. */
  active: "pill" | "color" | "scale" | "underline";
  /** Words not yet spoken: hidden (karaoke reveal) or dimmed. */
  upcoming: "dim" | "hidden" | "visible";
  /** Readability treatment behind text. */
  backdrop: "shadow" | "glass" | "none";
  /** Entrance of a caption block. */
  enter: "pop" | "rise" | "fade" | "slide";
  maxWordsPerPhrase: number;
  maxCharsPerLine: number;
  emphasisScale: number;
};

export const STYLES: Record<StylePreset, StyleDef> = {
  brand: {
    label: "Diana Brand",
    description: "Графит/бордо/белый, Onest, активное слово на бордовой плашке.",
    font: "onest", weight: 800, uppercase: false, size: 0.048, lineHeight: 1.08, letterSpacing: -0.01,
    colors: { text: BRAND.white, accent: BRAND.burgundy, onAccent: BRAND.white, upcoming: "rgba(255,255,255,0.72)" },
    active: "pill", upcoming: "dim", backdrop: "shadow", enter: "pop", maxWordsPerPhrase: 4, maxCharsPerLine: 22, emphasisScale: 1.06,
  },
  minimal: {
    label: "Minimal",
    description: "Спокойный белый текст с мягкой тенью, акцент — золотистый цвет слова.",
    font: "inter", weight: 700, uppercase: false, size: 0.044, lineHeight: 1.12, letterSpacing: -0.005,
    colors: { text: BRAND.white, accent: "#E6B43C", onAccent: "#141414", upcoming: BRAND.white },
    active: "color", upcoming: "visible", backdrop: "shadow", enter: "fade", maxWordsPerPhrase: 5, maxCharsPerLine: 22, emphasisScale: 1.0,
  },
  kinetic: {
    label: "Kinetic",
    description: "Капс Montserrat, слова выпрыгивают, акцент — красная плашка (без обводки).",
    font: "montserrat", weight: 900, uppercase: true, size: 0.052, lineHeight: 1.0, letterSpacing: 0,
    colors: { text: BRAND.white, accent: "#FF2D2D", onAccent: BRAND.white, upcoming: BRAND.white },
    active: "pill", upcoming: "hidden", backdrop: "shadow", enter: "pop", maxWordsPerPhrase: 3, maxCharsPerLine: 16, emphasisScale: 1.1,
  },
  glass: {
    label: "Glass",
    description: "Текст на стеклянной плашке в стиле iOS, слова плавно поднимаются.",
    font: "onest", weight: 700, uppercase: false, size: 0.045, lineHeight: 1.1, letterSpacing: -0.01,
    colors: { text: BRAND.white, accent: "#7FD3FF", onAccent: "#0B1A24", upcoming: "rgba(255,255,255,0)" },
    active: "color", upcoming: "hidden", backdrop: "glass", enter: "rise", maxWordsPerPhrase: 4, maxCharsPerLine: 20, emphasisScale: 1.06,
  },
  lime: {
    label: "Lime",
    description: "Брутальный стикер: чёрный текст на лаймовой плашке, капс.",
    font: "montserrat", weight: 900, uppercase: true, size: 0.05, lineHeight: 1.02, letterSpacing: 0.005,
    colors: { text: "#141414", accent: "#C8FF2E", onAccent: "#141414", upcoming: "#141414" },
    active: "scale", upcoming: "visible", backdrop: "none", enter: "slide", maxWordsPerPhrase: 3, maxCharsPerLine: 16, emphasisScale: 1.08,
  },
};

/** WCAG relative luminance contrast ratio of two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = hex.replace("#", "");
    const v = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Named colours a user may say in kk/ru/en ("қызыл", "красный", "red"…). */
export const NAMED_COLORS: Record<string, string> = {
  red: "#E5192F", "қызыл": "#E5192F", "красный": "#E5192F", "красным": "#E5192F",
  white: "#FFFFFF", "ақ": "#FFFFFF", "белый": "#FFFFFF", "белым": "#FFFFFF",
  black: "#141414", "қара": "#141414", "чёрный": "#141414", "черный": "#141414",
  yellow: "#FFD60A", "сары": "#FFD60A", "жёлтый": "#FFD60A", "желтый": "#FFD60A",
  gold: "#E6B43C", "алтын": "#E6B43C", "золотой": "#E6B43C",
  burgundy: "#6B1732", "бордо": "#6B1732", "бордовый": "#6B1732",
  pink: "#FF5C8A", "қызғылт": "#FF5C8A", "розовый": "#FF5C8A",
  blue: "#3EC5FF", "көк": "#3EC5FF", "синий": "#2D6BFF", "голубой": "#3EC5FF",
  green: "#2ECC71", "жасыл": "#2ECC71", "зелёный": "#2ECC71", "зеленый": "#2ECC71",
  lime: "#C8FF2E", "лайм": "#C8FF2E", "orange": "#FF8A00", "қызғылт сары": "#FF8A00", "оранжевый": "#FF8A00",
};

export function resolveColor(c: string): string {
  const k = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(k)) return k.toUpperCase();
  const v = NAMED_COLORS[k];
  if (!v) throw new Error(`Неизвестный цвет: ${c}. Используйте HEX (#RRGGBB) или название.`);
  return v;
}

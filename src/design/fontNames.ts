/** Font names only (no CSS imports) — safe to use from Node scripts. */
export const FONT_FAMILIES = {
  onest: "'Onest', 'Inter', sans-serif",
  inter: "'Inter', 'Onest', sans-serif",
  montserrat: "'Montserrat', 'Inter', sans-serif",
  ptserif: "'PT Serif', Georgia, serif",
  oswald: "'Oswald', 'Inter', sans-serif",
  rubik: "'Rubik', 'Inter', sans-serif",
  raleway: "'Raleway', 'Inter', sans-serif",
  nunito: "'Nunito', 'Inter', sans-serif",
  intertight: "'Inter Tight', 'Inter', sans-serif",
  geologica: "'Geologica', 'Onest', sans-serif",
  cormorant: "'Cormorant Garamond', 'PT Serif', Georgia, serif",
  badscript: "'Bad Script', 'Cormorant Garamond', cursive",
  montalt: "'Montserrat Alternates', 'Montserrat', sans-serif",
} as const;

/** Visual classes Claude names when describing a reference → bundled font with Kazakh letters. */
export const FONT_CLASSES: Record<string, FontId> = {
  "modern-sans": "onest", "neutral-sans": "inter", "geometric-bold": "montserrat", serif: "ptserif",
  condensed: "oswald", rounded: "nunito", "rounded-bold": "rubik", elegant: "raleway",
  "tight-display": "intertight", "soft-geometric": "geologica", "editorial-serif": "cormorant", script: "badscript", handwritten: "badscript", "geometric-alt": "montalt", "bold-reels": "montalt",
};
export type FontId = keyof typeof FONT_FAMILIES;


// Fonts are bundled from npm (@fontsource, SIL OFL 1.1) — no network at render time.
// All three families were verified to contain Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І (Manrope does not).
import "@fontsource/onest/500.css";
import "@fontsource/onest/700.css";
import "@fontsource/onest/800.css";
import "@fontsource/onest/900.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import { continueRender, delayRender } from "remotion";

export const FONT_FAMILIES = {
  onest: "'Onest', 'Inter', sans-serif",
  inter: "'Inter', 'Onest', sans-serif",
  montserrat: "'Montserrat', 'Inter', sans-serif",
} as const;
export type FontId = keyof typeof FONT_FAMILIES;

const KZ = "Әә Ғғ Құ Ңң Өө Ұұ Үү Һһ Іі АБВ abc 123";
let started = false;

/** Block rendering until every face used by the styles is loaded (no fallback-font frames). */
export function ensureFontsLoaded(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  const handle = delayRender("Loading fonts");
  const faces = [
    ["Onest", [500, 700, 800, 900]],
    ["Inter", [500, 600, 700, 800]],
    ["Montserrat", [700, 800, 900]],
  ] as const;
  Promise.all(faces.flatMap(([fam, ws]) => ws.map((w) => document.fonts.load(`${w} 64px '${fam}'`, KZ))))
    .then(() => document.fonts.ready)
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle));
}

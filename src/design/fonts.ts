// Fonts are bundled from npm (@fontsource, SIL OFL 1.1) — no network at render time.
// All families were verified to contain Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І (Manrope does not).
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
import "@fontsource/pt-serif/400.css";
import "@fontsource/pt-serif/700.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import "@fontsource/rubik/500.css";
import "@fontsource/rubik/700.css";
import "@fontsource/rubik/800.css";
import "@fontsource/raleway/500.css";
import "@fontsource/raleway/700.css";
import "@fontsource/raleway/800.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "@fontsource/inter-tight/600.css";
import "@fontsource/inter-tight/800.css";
import "@fontsource/inter-tight/900.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/cormorant-garamond/700-italic.css";
import "@fontsource/bad-script/400.css";
import { continueRender, delayRender } from "remotion";

export { FONT_FAMILIES, FONT_CLASSES, type FontId } from "./fontNames";

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
    ["PT Serif", [400, 700]],
    ["Oswald", [500, 700]],
    ["Rubik", [500, 700, 800]],
    ["Raleway", [500, 700, 800]],
    ["Nunito", [700, 800, 900]],
    ["Inter Tight", [600, 800, 900]],
    ["Cormorant Garamond", [600]],
    ["Bad Script", [400]],
  ] as const;
  const italics = ["600 italic 64px 'Cormorant Garamond'", "700 italic 64px 'Cormorant Garamond'"];
  Promise.all([...faces.flatMap(([fam, ws]) => ws.map((w) => document.fonts.load(`${w} 64px '${fam}'`, KZ))), ...italics.map((f) => document.fonts.load(f, KZ))])
    .then(() => document.fonts.ready)
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle));
}

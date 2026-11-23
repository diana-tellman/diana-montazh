import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStyle } from "../src/design/styles";
import { referenceOptions } from "../src/plan/reference";

describe("reference scheme", () => {
  it("maps what Claude saw into style overrides; nulls keep defaults; grade only if LUT exists", () => {
    const root = mkdtempSync(join(tmpdir(), "ref-"));
    const sbDir = join(root, "storyboard");
    const work = join(root, "work");
    mkdirSync(sbDir);
    mkdirSync(join(work, "reference"), { recursive: true });
    writeFileSync(join(sbDir, "reference-style.json"), JSON.stringify({ source: "ref.mp4", font: "serif", weight: 650, uppercase: true, size: "small", textColor: "#ffffff", accentColor: "қызыл", position: "bottom", wordsPerPhrase: 2, activeWord: "pill", animation: "rise", backdrop: null, icons: false }));
    writeFileSync(join(work, "reference", "analysis.json"), JSON.stringify({ suggestedEnergy: 2 }));
    const o = referenceOptions(root, sbDir, work);
    expect(o.styleOverrides).toMatchObject({ font: "ptserif", weight: 700, uppercase: true, size: 0.04, maxWordsPerPhrase: 2, active: "pill", enter: "rise" });
    expect(o.styleOverrides?.backdrop).toBeUndefined();
    expect(o.colors).toEqual({ text: "#FFFFFF", accent: "#E5192F" });
    expect(o.captionPosition).toBe("bottom");
    expect(o.icons).toBe(false);
    expect(o.cameraEnergy).toBe(2);
    expect(o.grade).toBeNull();
    const st = resolveStyle("brand", o.styleOverrides);
    expect(st.font).toBe("ptserif");
    expect(st.backdrop).toBe("shadow"); // from the preset
  });
});

import { describe, expect, it } from "vitest";
import type { Project } from "../src/core/project";
import { canTransition, transition, TransitionError } from "../src/core/state";

const mk = (mode: Project["mode"], status: Project["status"]): Project => ({
  schemaVersion: 2, id: "t", createdAt: "", updatedAt: "", mode, status, language: "kk", styleRequest: "", assets: [],
  voiceAssetId: null, scriptFile: null, history: [],
});

describe("state machine", () => {
  it("cannot render before approval", () => {
    expect(canTransition("expert-video", "storyboard_draft", "rendered")).toBe(false);
    expect(() => transition(mk("expert-video", "storyboard_draft"), "rendered", "")).toThrow(TransitionError);
  });
  it("both modes share one pipeline", () => {
    expect(canTransition("voice-over-visuals", "approved", "rendered")).toBe(true);
    expect(canTransition("voice-over-visuals", "storyboard_draft", "rendered")).toBe(false);
  });
  it("editing storyboard after approval drops back to draft", () => {
    expect(canTransition("expert-video", "approved", "storyboard_draft")).toBe(true);
    expect(canTransition("expert-video", "rendered", "storyboard_draft")).toBe(true);
  });
  it("cover only after render", () => {
    expect(canTransition("expert-video", "approved", "cover_done")).toBe(false);
    expect(canTransition("expert-video", "rendered", "cover_done")).toBe(true);
  });
  it("records history", () => {
    const p = transition(mk("expert-video", "approved"), "rendered", "ok", new Date("2026-01-01"));
    expect(p.history.at(-1)).toEqual({ at: "2026-01-01T00:00:00.000Z", status: "rendered", note: "ok" });
  });
});

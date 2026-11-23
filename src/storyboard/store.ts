import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FacesSchema, type Faces } from "../analysis/faces";
import { pathsFor } from "../core/store";
import { TranscriptSchema, type Transcript } from "../speech/transcript";
import { StoryboardSchema, type Storyboard } from "./schema";

export const sbFile = (id: string) => join(pathsFor(id).storyboard, "storyboard.json");
export const approvalFile = (id: string) => join(pathsFor(id).storyboard, "approval.json");
export const previewStamp = (id: string) => join(pathsFor(id).storyboard, "preview.json");

/** Hash of everything that affects the render (ignores timestamps and checks). */
export function storyboardHash(sb: Storyboard): string {
  const { updatedAt: _u, checks: _c, scenes, version: _v, ...rest } = sb;
  const sc = scenes.map(({ checks: _x, ...s }) => s);
  return createHash("sha256").update(JSON.stringify({ ...rest, scenes: sc })).digest("hex");
}

export function loadStoryboard(id: string): Storyboard {
  const f = sbFile(id);
  if (!existsSync(f)) throw new Error("Сториборд ещё не создан: npm run plan -- <id>");
  return StoryboardSchema.parse(JSON.parse(readFileSync(f, "utf8")));
}

export function saveStoryboard(sb: Storyboard): void {
  const f = sbFile(sb.projectId);
  writeFileSync(f + ".tmp", JSON.stringify(StoryboardSchema.parse(sb), null, 2));
  renameSync(f + ".tmp", f);
}

export type Approval = { version: number; hash: string; approvedAt: string };
export function readApproval(id: string): Approval | null {
  const f = approvalFile(id);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Approval) : null;
}
export function revokeApproval(id: string): boolean {
  const f = approvalFile(id);
  if (!existsSync(f)) return false;
  rmSync(f);
  return true;
}

export function loadFaces(id: string): Faces | null {
  const f = join(pathsFor(id).work, "faces.json");
  return existsSync(f) ? FacesSchema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
}
export function loadTranscript(id: string): Transcript {
  const f = join(pathsFor(id).work, "transcript.json");
  if (!existsSync(f)) throw new Error("Нет транскрипта: npm run transcribe -- <id>");
  return TranscriptSchema.parse(JSON.parse(readFileSync(f, "utf8")));
}

import { z } from "zod";

const Face = z.object({
  x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number(), cx: z.number(), cy: z.number(),
  eyeY: z.number(), chinY: z.number(), foreheadY: z.number(), headTop: z.number(), mouthOpen: z.number(),
});
const Person = z.object({ x0: z.number(), x1: z.number(), y0: z.number(), y1: z.number(), area: z.number() });
export const FacesSchema = z.object({
  version: z.literal(1),
  width: z.number(),
  height: z.number(),
  durationSec: z.number(),
  sampleFps: z.number(),
  cuts: z.array(z.number()),
  faceCoverage: z.number(),
  samples: z.array(z.object({ t: z.number(), faces: z.number(), face: Face.nullable(), person: Person.nullable() })),
});
export type Faces = z.infer<typeof FacesSchema>;
export type FaceBox = z.infer<typeof Face>;

/** Union of face/head boxes over [t0, t1] (normalised): the zone text must never cover. */
export function faceZone(f: Faces, t0: number, t1: number): { x0: number; x1: number; y0: number; y1: number } | null {
  const s = f.samples.filter((x) => x.t >= t0 - 0.25 && x.t <= t1 + 0.25 && x.face);
  if (!s.length) return null;
  return {
    x0: Math.min(...s.map((x) => x.face!.x0)),
    x1: Math.max(...s.map((x) => x.face!.x1)),
    y0: Math.min(...s.map((x) => x.face!.headTop)),
    y1: Math.max(...s.map((x) => x.face!.chinY)),
  };
}

/** Median face centre over an interval — a stable anchor for crops/zooms (no jitter). */
export function faceAnchor(f: Faces, t0: number, t1: number): { cx: number; cy: number; h: number } | null {
  const s = f.samples.filter((x) => x.t >= t0 && x.t <= t1 && x.face).map((x) => x.face!);
  if (!s.length) return null;
  const med = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  return { cx: med(s.map((x) => x.cx)), cy: med(s.map((x) => x.eyeY)), h: med(s.map((x) => x.chinY - x.headTop)) };
}

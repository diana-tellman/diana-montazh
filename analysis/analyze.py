"""
Subject analysis for DIANA MOBILE MOTION STUDIO.

  analyze <video> <out.json> [--fps 5]
      Per sampled frame: main face box, eyes, chin, real head top (from hair/face
      segmentation), mouth openness, person box. Plus scene cuts.
  matte <video> <out_dir> --start S --end E [--fps 30]
      Person cut-out WebP frames (RGBA) for "text behind subject", temporally smoothed.
  cover-candidates <video> <faces.json> <out_dir> [--n 6]
      Best cover frames: big centred face, mouth closed, sharp.

All coordinates are normalised 0..1 in the video's display frame.
Models: MediaPipe Face Landmarker + Selfie Multiclass Segmenter (Apache-2.0).
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

MODELS = os.environ.get("DMS_MP_MODELS", os.path.join(os.path.dirname(__file__), "..", "models", "mediapipe"))


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", path],
        capture_output=True, text=True, check=True,
    ).stdout
    d = json.loads(out)
    s = d["streams"][0]
    return int(s["width"]), int(s["height"]), float(d["format"]["duration"])


def frames(path, fps, w, h, start=None, end=None):
    """Yield (t, rgb uint8 HxWx3) at a fixed rate. The proxy is already rotated/SDR."""
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", path]
    if end is not None:
        cmd += ["-t", f"{max(0.0, end - (start or 0)):.3f}"]
    cmd += ["-vf", f"fps={fps},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = w * h * 3
    i = 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield (start or 0) + i / fps, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        i += 1
    p.wait()


def scene_cuts(path, threshold=0.33):
    r = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", path, "-vf", f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    cuts = []
    for line in r.stderr.splitlines():
        if "showinfo" in line and "pts_time:" in line:
            cuts.append(round(float(line.split("pts_time:")[1].split()[0]), 3))
    return cuts


def make_tasks(video_mode=True):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    mode = vision.RunningMode.VIDEO if video_mode else vision.RunningMode.IMAGE
    lm = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=os.path.join(MODELS, "face_landmarker.task")),
            running_mode=mode, num_faces=3, min_face_detection_confidence=0.5, min_tracking_confidence=0.5,
        )
    )
    seg = vision.ImageSegmenter.create_from_options(
        vision.ImageSegmenterOptions(
            base_options=BaseOptions(model_asset_path=os.path.join(MODELS, "selfie_multiclass.tflite")),
            running_mode=mode, output_category_mask=True, output_confidence_masks=True,
        )
    )
    return mp, lm, seg


# Selfie multiclass categories: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories.
def person_conf(seg_result):
    masks = seg_result.confidence_masks
    bg = np.squeeze(masks[0].numpy_view())
    return np.clip(1.0 - bg, 0.0, 1.0)


def square_pad(rgb):
    """Face Landmarker distorts landmarks on non-square input (NORM_RECT without image dims):
    letterbox to a square and map coordinates back."""
    h, w = rgb.shape[:2]
    S = max(w, h)
    px, py = (S - w) // 2, (S - h) // 2
    sq = np.zeros((S, S, 3), np.uint8)
    sq[py:py + h, px:px + w] = rgb
    return sq, S, px, py


def analyze_frame(mp, lm, seg, rgb, ts_ms, video_mode=True):
    h, w = rgb.shape[:2]
    img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
    sq, S, px, py = square_pad(rgb)
    sq_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=sq)
    res = lm.detect_for_video(sq_img, ts_ms) if video_mode else lm.detect(sq_img)
    sres = seg.segment_for_video(img, ts_ms) if video_mode else seg.segment(img)
    cat = np.squeeze(sres.category_mask.numpy_view())
    person = cat > 0
    head = (cat == 1) | (cat == 3)

    out = {"face": None, "person": None, "faces": 0}
    if person.any():
        ys, xs = np.where(person)
        out["person"] = {"x0": xs.min() / w, "x1": (xs.max() + 1) / w, "y0": ys.min() / h, "y1": (ys.max() + 1) / h, "area": float(person.mean())}

    faces = []
    for pts in res.face_landmarks or []:
        xs = (np.array([p.x for p in pts]) * S - px) / w
        ys = (np.array([p.y for p in pts]) * S - py) / h
        faces.append((xs, ys))
    out["faces"] = len(faces)
    if faces:
        xs, ys = max(faces, key=lambda f: (f[0].max() - f[0].min()) * (f[1].max() - f[1].min()))
        x0, x1, y0, y1 = float(xs.min()), float(xs.max()), float(ys.min()), float(ys.max())
        fh = max(1e-6, y1 - y0)
        # 10 forehead, 152 chin, 13/14 inner lips, 33/263 eye corners.
        mouth = abs(ys[14] - ys[13]) / fh
        eye_y = float((ys[33] + ys[263]) / 2)
        # Real head top: highest hair/face pixel in a column band around the face.
        top = y0 - 0.35 * fh
        bx0, bx1 = max(0, int((x0 - 0.15 * (x1 - x0)) * w)), min(w, int((x1 + 0.15 * (x1 - x0)) * w))
        band = head[:, bx0:bx1]
        rows = np.where(band.any(axis=1))[0]
        if rows.size:
            cand = rows[rows < int(y1 * h)]
            if cand.size:
                top = cand.min() / h
        out["face"] = {
            "x0": x0, "x1": x1, "y0": y0, "y1": y1,
            "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2,
            "eyeY": eye_y, "chinY": float(ys[152]), "foreheadY": float(ys[10]),
            "headTop": float(max(0.0, min(top, y0))), "mouthOpen": float(mouth),
        }
    return out, sres


def cmd_analyze(a):
    W, H, dur = probe(a.video)
    sw = 360
    sh = int(round(H * sw / W / 2) * 2)
    mp, lm, seg = make_tasks(True)
    samples = []
    for t, rgb in frames(a.video, a.fps, sw, sh):
        r, _ = analyze_frame(mp, lm, seg, rgb, int(t * 1000))
        r["t"] = round(t, 3)
        samples.append(r)
    out = {
        "version": 1, "width": W, "height": H, "durationSec": dur, "sampleFps": a.fps,
        "cuts": scene_cuts(a.video), "samples": samples,
        "faceCoverage": round(sum(1 for s in samples if s["face"]) / max(1, len(samples)), 3),
    }
    lm.close(); seg.close()
    with open(a.out, "w") as f:
        json.dump(out, f)
    print(json.dumps({"samples": len(samples), "faceCoverage": out["faceCoverage"], "cuts": out["cuts"]}))


def cmd_matte(a):
    from PIL import Image

    W, H, _ = probe(a.video)
    mp, lm, seg = make_tasks(True)
    os.makedirs(a.out_dir, exist_ok=True)
    prev = None
    n = 0
    for t, rgb in frames(a.video, a.fps, W, H, a.start, a.end):
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        conf = person_conf(seg.segment_for_video(img, int(t * 1000)))
        if conf.shape != (H, W):
            conf = np.asarray(Image.fromarray((conf * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), np.float32) / 255
        # Temporal smoothing against flicker, then a soft but tight edge.
        conf = conf if prev is None else 0.6 * conf + 0.4 * prev
        prev = conf
        alpha = np.clip((conf - 0.35) / 0.3, 0, 1)
        rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
        n += 1
        Image.fromarray(rgba, "RGBA").save(os.path.join(a.out_dir, f"{n:05d}.webp"), quality=88, method=2)
    lm.close(); seg.close()
    print(json.dumps({"frames": n, "dir": a.out_dir, "fps": a.fps, "start": a.start}))


def sharpness(gray):
    # Variance of a discrete Laplacian (higher = sharper).
    lap = -4 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:]
    return float(lap.var())


def cmd_cover(a):
    from PIL import Image

    W, H, dur = probe(a.video)
    data = json.load(open(a.faces))
    scored = []
    for s in data["samples"]:
        f = s["face"]
        if not f or s["faces"] > 2:
            continue
        size = (f["y1"] - f["y0"])
        centred = 1 - min(1, abs(f["cx"] - 0.5) * 2)
        closed = 1 - min(1, f["mouthOpen"] / 0.25)
        edge = 0.6 if s["t"] < 0.4 or s["t"] > dur - 0.4 else 1.0
        scored.append(((size * 2 + centred + closed * 1.5) * edge, s["t"]))
    scored.sort(reverse=True)
    picked = []
    for sc, t in scored:
        if all(abs(t - p) > 1.5 for _, p in picked):
            picked.append((sc, t))
        if len(picked) >= a.n * 2:
            break
    os.makedirs(a.out_dir, exist_ok=True)
    res = []
    for sc, t in picked:
        rgb = next(frames(a.video, 1, W, H, t, t + 1.0))[1]
        gray = rgb.mean(axis=2)[::2, ::2]
        sh = sharpness(gray)
        res.append({"t": t, "score": round(sc, 3), "sharpness": round(sh, 1), "rgb": rgb})
    res.sort(key=lambda r: r["score"] * (0.7 + 0.3 * min(1, r["sharpness"] / 150)), reverse=True)
    out = []
    for i, r in enumerate(res[: a.n]):
        p = os.path.join(a.out_dir, f"cand-{i + 1}.jpg")
        Image.fromarray(r["rgb"]).save(p, quality=92)
        out.append({"file": p, "t": r["t"], "score": r["score"], "sharpness": r["sharpness"]})
    print(json.dumps(out))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("analyze")
    p.add_argument("video"); p.add_argument("out"); p.add_argument("--fps", type=float, default=5)
    p = sub.add_parser("matte")
    p.add_argument("video"); p.add_argument("out_dir"); p.add_argument("--start", type=float, required=True)
    p.add_argument("--end", type=float, required=True); p.add_argument("--fps", type=float, default=30)
    p = sub.add_parser("cover-candidates")
    p.add_argument("video"); p.add_argument("faces"); p.add_argument("out_dir"); p.add_argument("--n", type=int, default=6)
    a = ap.parse_args()
    {"analyze": cmd_analyze, "matte": cmd_matte, "cover-candidates": cmd_cover}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())

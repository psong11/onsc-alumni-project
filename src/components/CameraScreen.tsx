"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadScanner } from "@/lib/scanner";
import type { Batch } from "@/lib/types";

type Status =
  | "starting"
  | "denied"
  | "error"
  | "scanning"
  | "capturing"
  | "captured";

const VIDEO_W_IDEAL = 2560;
const VIDEO_H_IDEAL = 1440;
const CAPTURE_MAX_EDGE = 1568; // matches the resolution Claude effectively sees
const PROC_WIDTH = 480; // downscaled width for detection (speed)
const COVERAGE_MIN = 0.3; // document must fill >= 30% of the frame
const DETECT_STREAK_FRAMES = 20; // ~0.7s of continuous detection → auto-capture
const SHARP_SAMPLES = 7; // frames sampled per capture
const SHARP_INTERVAL_MS = 40; // spacing between samples (~280ms total)

type Pt = [number, number];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function quadArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(a) / 2;
}

function drawQuad(
  ctx: CanvasRenderingContext2D,
  p: Pt[],
  sx: number,
  sy: number,
  color: string,
) {
  ctx.beginPath();
  ctx.moveTo(p[0][0] * sx, p[0][1] * sy);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * sx, p[i][1] * sy);
  ctx.closePath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();
}

// Sharpness = variance of the Laplacian on a small grayscale copy. Higher = crisper.
function sharpnessFromVideo(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
): number {
  const w = 320;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float64Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -4 * g[idx] + g[idx - 1] + g[idx + 1] + g[idx - w] + g[idx + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

export default function CameraScreen({
  batch,
  onCapture,
  onChangeBatch,
}: {
  batch: Batch;
  onCapture: (blob: Blob) => void;
  onChangeBatch: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const procRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<any>(null);
  const cvLoadedRef = useRef(false);
  const streakRef = useRef(0);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<Status>("starting");
  const [hint, setHint] = useState("Point at a form");
  const [autoReady, setAutoReady] = useState(false);

  // Grab several frames, keep the sharpest → big win against hand-shake blur.
  const captureSharpest = useCallback(async () => {
    const video = videoRef.current;
    if (capturedRef.current || !video || !video.videoWidth) return;
    capturedRef.current = true;
    setStatus("capturing");
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(vw, vh));
    const cw = Math.round(vw * scale);
    const ch = Math.round(vh * scale);
    const scratch = document.createElement("canvas");
    const best = document.createElement("canvas");
    best.width = cw;
    best.height = ch;
    const bestCtx = best.getContext("2d")!;
    let bestScore = -1;

    for (let i = 0; i < SHARP_SAMPLES; i++) {
      const score = sharpnessFromVideo(video, scratch);
      if (score > bestScore) {
        bestScore = score;
        bestCtx.drawImage(video, 0, 0, cw, ch); // same frame we just scored
      }
      if (i < SHARP_SAMPLES - 1) await delay(SHARP_INTERVAL_MS);
    }

    navigator.vibrate?.(40);
    setStatus("captured");
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    best.toBlob(
      (b) => {
        if (b) onCapture(b);
      },
      "image/jpeg",
      0.92,
    );
  }, [onCapture]);

  // Start the rear camera.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: VIDEO_W_IDEAL },
            height: { ideal: VIDEO_H_IDEAL },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // Best-effort continuous autofocus (support varies by device).
        try {
          const track = stream.getVideoTracks()[0];
          const caps = (track.getCapabilities?.() ?? {}) as any;
          if (caps.focusMode?.includes?.("continuous")) {
            await track.applyConstraints({
              advanced: [{ focusMode: "continuous" } as any],
            });
          }
        } catch {
          /* ignore */
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setStatus("scanning");
      } catch (e: any) {
        if (cancelled) return;
        setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      }
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Load detection (best-effort) and run the per-frame loop.
  useEffect(() => {
    if (status !== "scanning") return;
    let active = true;

    function detectFrame(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
      const w = window as any;
      const octx = overlay.getContext("2d")!;
      const rect = video.getBoundingClientRect();
      if (overlay.width !== rect.width || overlay.height !== rect.height) {
        overlay.width = rect.width;
        overlay.height = rect.height;
      }
      octx.clearRect(0, 0, overlay.width, overlay.height);

      let detected = false;
      let coverage = 0;

      if (scannerRef.current && w.cv) {
        if (!procRef.current) procRef.current = document.createElement("canvas");
        const proc = procRef.current;
        const pw = PROC_WIDTH;
        const ph = Math.round((video.videoHeight / video.videoWidth) * PROC_WIDTH);
        proc.width = pw;
        proc.height = ph;
        proc.getContext("2d")!.drawImage(video, 0, 0, pw, ph);

        let mat: any;
        try {
          mat = w.cv.imread(proc);
          const contour = scannerRef.current.findPaperContour(mat);
          if (contour) {
            const c = scannerRef.current.getCornerPoints(contour);
            const pts: Pt[] = [
              [c.topLeftCorner.x, c.topLeftCorner.y],
              [c.topRightCorner.x, c.topRightCorner.y],
              [c.bottomRightCorner.x, c.bottomRightCorner.y],
              [c.bottomLeftCorner.x, c.bottomLeftCorner.y],
            ];
            coverage = quadArea(pts) / (pw * ph);
            detected = coverage >= COVERAGE_MIN;
            drawQuad(
              octx,
              pts,
              overlay.width / pw,
              overlay.height / ph,
              detected ? "#22c55e" : "#eab308",
            );
          }
        } catch {
          /* ignore frame */
        }
        mat?.delete?.();
      }

      if (detected) {
        streakRef.current += 1;
        setHint("Hold still…");
        if (streakRef.current >= DETECT_STREAK_FRAMES) captureSharpest();
      } else {
        streakRef.current = 0;
        setHint(coverage > 0 ? "Move closer — fill the frame" : "Point at a form");
      }

      if (hudRef.current) {
        hudRef.current.textContent = `cv:${cvLoadedRef.current ? "y" : "n"} det:${
          detected ? "y" : "n"
        } cov:${Math.round(coverage * 100)}% streak:${streakRef.current}`;
      }
    }

    function loop() {
      if (!active || capturedRef.current) return;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (video && overlay && video.videoWidth) detectFrame(video, overlay);
      rafRef.current = requestAnimationFrame(loop);
    }

    (async () => {
      const ok = await loadScanner();
      if (!active) return;
      cvLoadedRef.current = ok;
      if (ok) {
        try {
          scannerRef.current = new (window as any).jscanify();
          setAutoReady(true);
        } catch {
          cvLoadedRef.current = false;
          setAutoReady(false);
        }
      }
      loop();
    })();

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, captureSharpest]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-black">
      <div className="absolute top-0 z-20 flex w-full items-center justify-between bg-black/60 px-3 py-2 text-sm text-white">
        <span>
          Batch: {batch.program} · {batch.year}
        </span>
        <button
          onClick={() => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            onChangeBatch();
          }}
          className="text-neutral-300 underline"
        >
          Change batch
        </button>
      </div>

      {/* debug HUD — remove once auto-capture is dialed in */}
      <div
        ref={hudRef}
        className="absolute left-2 top-12 z-20 rounded bg-black/60 px-2 py-1 font-mono text-[11px] text-green-300"
      />

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-dvh w-full object-cover"
      />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {status === "scanning" && (
        <>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
            <div
              className="w-full rounded-2xl border-2 border-white/40"
              style={{ aspectRatio: "3 / 4", maxHeight: "70%" }}
            />
          </div>
          <div className="absolute bottom-0 z-20 flex w-full flex-col items-center gap-4 bg-gradient-to-t from-black/70 to-transparent px-6 pb-10 pt-14">
            <p className="text-center text-sm text-white">
              {autoReady ? hint : "Tap the button to capture"}
            </p>
            <button
              onClick={captureSharpest}
              aria-label="Capture"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition active:scale-95"
            />
          </div>
        </>
      )}

      {status === "capturing" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 text-lg text-white">
          Capturing…
        </div>
      )}
      {status === "captured" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 text-lg text-white">
          Captured ✓
        </div>
      )}
      {status === "starting" && <Centered>Starting camera…</Centered>}
      {status === "denied" && (
        <Centered>
          Camera access was denied. Enable the camera for this site in Settings,
          then reload.
        </Centered>
      )}
      {status === "error" && <Centered>Couldn&rsquo;t start the camera.</Centered>}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-8 text-center text-white">
      {children}
    </div>
  );
}

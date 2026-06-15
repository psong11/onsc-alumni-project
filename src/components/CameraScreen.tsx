"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
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

// Auto-capture tuning (all surfaced in the on-screen HUD for calibration):
const METRIC_W = 200; // width of the small gray frame used for metrics
const MOTION_MAX = 4.0; // mean per-pixel gray-diff below this = "steady"
const SHARP_MIN = 40; // Laplacian variance above this = "in focus / has content"
const LOCK_MS = 900; // must stay steady + focused this long before auto-snap

const SHARP_SAMPLES = 7; // frames sampled per capture, sharpest kept
const SHARP_INTERVAL_MS = 40;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Returns { sharp, motion } from a small grayscale copy of the current frame.
// sharp = variance of Laplacian (focus/content). motion = mean abs diff vs the
// previous frame (camera shake). Both are cheap at 200px wide.
function computeMetrics(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  prevGray: { current: Float64Array | null },
): { sharp: number; motion: number } {
  const w = METRIC_W;
  const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float64Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }

  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  const mean = n ? sum / n : 0;
  const sharp = n ? sum2 / n - mean * mean : 0;

  let motion = 999;
  const prev = prevGray.current;
  if (prev && prev.length === gray.length) {
    let s = 0;
    for (let i = 0; i < gray.length; i++) s += Math.abs(gray[i] - prev[i]);
    motion = s / gray.length;
  }
  prevGray.current = gray;

  return { sharp, motion };
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
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const prevGrayRef = useRef<Float64Array | null>(null);
  const lockStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<Status>("starting");
  const [hint, setHint] = useState("Point at a form");

  const setHintOnce = useCallback((h: string) => {
    setHint((prev) => (prev === h ? prev : h));
  }, []);

  // Grab several frames, keep the sharpest → beats hand-shake motion blur.
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
    const metric = document.createElement("canvas");
    const prevGray = { current: null as Float64Array | null };
    const best = document.createElement("canvas");
    best.width = cw;
    best.height = ch;
    const bestCtx = best.getContext("2d")!;
    let bestScore = -1;

    for (let i = 0; i < SHARP_SAMPLES; i++) {
      const { sharp } = computeMetrics(video, metric, prevGray);
      if (sharp > bestScore) {
        bestScore = sharp;
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

  // Per-frame metrics → steady+focused lock → auto-capture.
  useEffect(() => {
    if (status !== "scanning") return;
    let active = true;

    function drawGuide(overlay: HTMLCanvasElement, locking: boolean) {
      const octx = overlay.getContext("2d")!;
      octx.clearRect(0, 0, overlay.width, overlay.height);
      const m = overlay.width * 0.06;
      const w = overlay.width - m * 2;
      const h = Math.min(overlay.height - m * 2, w * (4 / 3));
      const x = (overlay.width - w) / 2;
      const y = (overlay.height - h) / 2;
      const r = 16;
      octx.beginPath();
      octx.moveTo(x + r, y);
      octx.arcTo(x + w, y, x + w, y + h, r);
      octx.arcTo(x + w, y + h, x, y + h, r);
      octx.arcTo(x, y + h, x, y, r);
      octx.arcTo(x, y, x + w, y, r);
      octx.closePath();
      octx.lineWidth = locking ? 6 : 3;
      octx.strokeStyle = locking ? "#22c55e" : "rgba(255,255,255,0.5)";
      octx.stroke();
    }

    function loop() {
      if (!active || capturedRef.current) return;
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (video && overlay && video.videoWidth) {
        const rect = video.getBoundingClientRect();
        if (overlay.width !== rect.width || overlay.height !== rect.height) {
          overlay.width = rect.width;
          overlay.height = rect.height;
        }
        if (!scratchRef.current) scratchRef.current = document.createElement("canvas");

        const { sharp, motion } = computeMetrics(
          video,
          scratchRef.current,
          prevGrayRef,
        );
        const steady = motion < MOTION_MAX;
        const focused = sharp > SHARP_MIN;
        const locking = steady && focused;

        drawGuide(overlay, locking);

        const now = performance.now();
        let held = 0;
        if (locking) {
          if (lockStartRef.current == null) lockStartRef.current = now;
          held = now - lockStartRef.current;
          setHintOnce("Hold still…");
          if (held >= LOCK_MS) {
            captureSharpest();
            return;
          }
        } else {
          lockStartRef.current = null;
          setHintOnce(focused ? "Hold steady" : "Point at a form");
        }

        if (hudRef.current) {
          hudRef.current.textContent = `sharp:${Math.round(sharp)} mot:${motion.toFixed(
            1,
          )} held:${Math.round(held)}ms`;
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    loop();
    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, captureSharpest, setHintOnce]);

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
        <div className="absolute bottom-0 z-20 flex w-full flex-col items-center gap-4 bg-gradient-to-t from-black/70 to-transparent px-6 pb-10 pt-14">
          <p className="text-center text-sm text-white">{hint}</p>
          <button
            onClick={captureSharpest}
            aria-label="Capture"
            className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition active:scale-95"
          />
        </div>
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

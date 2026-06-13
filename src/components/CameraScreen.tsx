"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadScanner } from "@/lib/scanner";
import type { Batch } from "@/lib/types";

type Status = "starting" | "denied" | "error" | "scanning" | "captured";

const PROC_WIDTH = 480; // downscaled width used for detection (speed)
const CAPTURE_MAX_EDGE = 1568; // matches the resolution we send to Claude
const COVERAGE_MIN = 0.35; // document must fill >= 35% of the frame
const STABLE_FRAMES = 12; // ~0.4s held steady before auto-snap
const MOVE_TOLERANCE = 14; // px of corner drift allowed (in proc space)

type Pt = [number, number];

function quadArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(a) / 2;
}

function maxCornerDelta(a: Pt[], b: Pt[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]));
  }
  return m;
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
  const procRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<any>(null);
  const prevCornersRef = useRef<Pt[] | null>(null);
  const stableCountRef = useRef(0);
  const capturedRef = useRef(false);

  const [status, setStatus] = useState<Status>("starting");
  const [hint, setHint] = useState("Point at a form");
  const [autoReady, setAutoReady] = useState(false);

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (capturedRef.current || !video || !video.videoWidth) return;
    capturedRef.current = true;
    setStatus("captured");
    navigator.vibrate?.(40); // no-op on iOS, nice on Android

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(vw, vh));
    const cw = Math.round(vw * scale);
    const ch = Math.round(vh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext("2d")!.drawImage(video, 0, 0, cw, ch);
    stopAll();
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      "image/jpeg",
      0.9,
    );
  }, [onCapture, stopAll]);

  // Start the rear camera.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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
      stopAll();
    };
  }, [stopAll]);

  // Load detection (best-effort) and run the per-frame loop.
  useEffect(() => {
    if (status !== "scanning") return;
    let active = true;

    function resetStable() {
      stableCountRef.current = 0;
      prevCornersRef.current = null;
    }

    function detectFrame(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
      const w = window as any;
      const octx = overlay.getContext("2d")!;
      const rect = video.getBoundingClientRect();
      if (overlay.width !== rect.width || overlay.height !== rect.height) {
        overlay.width = rect.width;
        overlay.height = rect.height;
      }
      octx.clearRect(0, 0, overlay.width, overlay.height);

      if (!scannerRef.current || !w.cv) return; // manual-only

      if (!procRef.current) procRef.current = document.createElement("canvas");
      const proc = procRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const pw = PROC_WIDTH;
      const ph = Math.round((vh / vw) * PROC_WIDTH);
      proc.width = pw;
      proc.height = ph;
      proc.getContext("2d")!.drawImage(video, 0, 0, pw, ph);

      let mat: any;
      let contour: any;
      try {
        mat = w.cv.imread(proc);
        contour = scannerRef.current.findPaperContour(mat);
      } catch {
        mat?.delete?.();
        return;
      }
      if (!contour) {
        mat.delete();
        resetStable();
        setHint("Point at a form");
        return;
      }

      let c: any;
      try {
        c = scannerRef.current.getCornerPoints(contour);
      } catch {
        mat.delete();
        resetStable();
        return;
      }
      mat.delete();

      const pts: Pt[] = [
        [c.topLeftCorner.x, c.topLeftCorner.y],
        [c.topRightCorner.x, c.topRightCorner.y],
        [c.bottomRightCorner.x, c.bottomRightCorner.y],
        [c.bottomLeftCorner.x, c.bottomLeftCorner.y],
      ];
      const coverage = quadArea(pts) / (pw * ph);
      const enough = coverage >= COVERAGE_MIN;

      drawQuad(
        octx,
        pts,
        overlay.width / pw,
        overlay.height / ph,
        enough ? "#22c55e" : "#eab308",
      );

      if (!enough) {
        setHint("Move closer — fill the frame");
        resetStable();
        return;
      }

      const prev = prevCornersRef.current;
      const steady = prev ? maxCornerDelta(pts, prev) < MOVE_TOLERANCE : false;
      prevCornersRef.current = pts;
      setHint("Hold steady…");
      if (steady) {
        stableCountRef.current += 1;
        if (stableCountRef.current >= STABLE_FRAMES) capture();
      } else {
        stableCountRef.current = 0;
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
      if (ok) {
        try {
          scannerRef.current = new (window as any).jscanify();
          setAutoReady(true);
        } catch {
          setAutoReady(false);
        }
      }
      loop();
    })();

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [status, capture]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-black">
      <div className="absolute top-0 z-20 flex w-full items-center justify-between bg-black/60 px-3 py-2 text-sm text-white">
        <span>
          Batch: {batch.program} · {batch.year}
        </span>
        <button
          onClick={() => {
            stopAll();
            onChangeBatch();
          }}
          className="text-neutral-300 underline"
        >
          Change batch
        </button>
      </div>

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
              onClick={capture}
              aria-label="Capture"
              className="h-16 w-16 rounded-full border-4 border-white bg-white/20 transition active:scale-95"
            />
          </div>
        </>
      )}

      {status === "captured" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 text-lg text-white">
          Captured ✓
        </div>
      )}

      {status === "starting" && (
        <Centered>Starting camera…</Centered>
      )}
      {status === "denied" && (
        <Centered>
          Camera access was denied. Enable the camera for this site in your
          browser settings, then reload.
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

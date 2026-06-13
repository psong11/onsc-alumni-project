// Lazily loads OpenCV.js + jscanify (from CDN) for in-browser document-edge
// detection, used to drive auto-capture. This is a best-effort enhancement:
// loadScanner() resolves to `false` if anything fails to load, and the camera
// falls back to the manual shutter so the app is always usable.

const OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";
const JSCANIFY_URL =
  "https://cdn.jsdelivr.net/gh/puffinsoft/jscanify@master/src/jscanify.min.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = Window & { cv?: any; jscanify?: any };

let promise: Promise<boolean> | null = null;

function inject(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function waitForCv(w: Win, timeoutMs = 20000): Promise<void> {
  // Some OpenCV builds export `cv` as a factory/promise; resolve it first.
  if (typeof w.cv === "function") {
    try {
      w.cv = await w.cv();
    } catch {
      /* fall through to polling */
    }
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (w.cv && w.cv.Mat && typeof w.cv.imread === "function") return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error("OpenCV did not initialize in time");
}

/** Loads OpenCV + jscanify. Returns true if document detection is available. */
export function loadScanner(): Promise<boolean> {
  if (promise) return promise;
  promise = (async () => {
    const w = window as Win;
    await inject(OPENCV_URL);
    await waitForCv(w);
    await inject(JSCANIFY_URL);
    if (!w.jscanify) throw new Error("jscanify unavailable");
    return true;
  })().catch(() => false);
  return promise;
}

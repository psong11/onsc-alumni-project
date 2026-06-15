"use client";

import { useCallback, useEffect, useState } from "react";
import PasscodeScreen from "./PasscodeScreen";
import BatchScreen from "./BatchScreen";
import CameraScreen from "./CameraScreen";
import { authHeader, clearToken, getToken, setToken } from "@/lib/session";
import type { Batch } from "@/lib/types";

export default function App() {
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [programs, setPrograms] = useState<string[] | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [captured, setCaptured] = useState<Blob | null>(null);

  useEffect(() => {
    setTok(getToken());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!token) {
      setPrograms(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/programs", { headers: authHeader() });
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as { programs: string[] };
        if (!cancelled) setPrograms(data.programs);
      } catch {
        if (!cancelled) setPrograms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAuthed = (t: string) => {
    setToken(t);
    setTok(t);
  };

  const lock = () => {
    clearToken();
    setTok(null);
    setBatch(null);
    setCaptured(null);
    setPrograms(null);
  };

  const handleAddProgram = useCallback(async (name: string) => {
    setPrograms((prev) =>
      prev && !prev.includes(name) ? [...prev, name] : prev,
    );
    try {
      await fetch("/api/programs", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({ program: name }),
      });
    } catch {
      /* session-local add still works; persistence lands in phase 7 */
    }
  }, []);

  if (!ready) return null;
  if (!token) return <PasscodeScreen onAuthed={handleAuthed} />;
  if (programs === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-neutral-500">
        Loading…
      </main>
    );
  }
  if (!batch) {
    return (
      <BatchScreen
        programs={programs}
        onAddProgram={handleAddProgram}
        onStart={setBatch}
        onLock={lock}
      />
    );
  }
  if (!captured) {
    return (
      <CameraScreen
        batch={batch}
        onCapture={setCaptured}
        onChangeBatch={() => setBatch(null)}
      />
    );
  }

  // Temporary capture preview — phase 5 replaces this with the extract +
  // confirm/edit screen. Kept now so capture quality is testable on-device.
  return (
    <CapturedPreview
      blob={captured}
      batch={batch}
      onAgain={() => setCaptured(null)}
      onChangeBatch={() => {
        setCaptured(null);
        setBatch(null);
      }}
    />
  );
}

function CapturedPreview({
  blob,
  batch,
  onAgain,
  onChangeBatch,
}: {
  blob: Blob;
  batch: Batch;
  onAgain: () => void;
  onChangeBatch: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  return (
    <main className="flex h-dvh flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-3 text-sm text-neutral-500">
        <span>
          Batch: {batch.program} · {batch.year}
        </span>
        <button onClick={onChangeBatch} className="underline">
          Change batch
        </button>
      </div>
      <p className="px-4 pb-2 text-center text-sm text-neutral-500">
        Captured ✓ — reading the form is the next phase.
      </p>
      <div className="min-h-0 flex-1 px-4">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Captured form"
            className="mx-auto h-full w-auto max-w-full rounded-xl border border-neutral-200 object-contain"
          />
        )}
      </div>
      <div className="p-4">
        <button
          onClick={onAgain}
          className="w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-lg font-medium text-white"
        >
          Scan another
        </button>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import PasscodeScreen from "./PasscodeScreen";
import BatchScreen from "./BatchScreen";
import CameraScreen from "./CameraScreen";
import ConfirmScreen from "./ConfirmScreen";
import { authHeader, clearToken, getToken, setToken } from "@/lib/session";
import type { Batch, ExtractedFields } from "@/lib/types";

export default function App() {
  const [token, setTok] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [programs, setPrograms] = useState<string[] | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [captured, setCaptured] = useState<Blob | null>(null);
  const [fields, setFields] = useState<ExtractedFields | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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

  // After a capture, send the photo to Claude for extraction. `attempt` lets the
  // user retry the same photo without re-scanning.
  useEffect(() => {
    if (!captured) return;
    let cancelled = false;
    setExtracting(true);
    setExtractError(null);
    setFields(null);
    (async () => {
      try {
        const form = new FormData();
        form.append("image", captured, "form.jpg");
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: authHeader(),
          body: form,
        });
        if (!res.ok) {
          const msg = (await res.json().catch(() => ({})))?.error || "Extraction failed";
          throw new Error(msg);
        }
        const data = (await res.json()) as { fields: ExtractedFields };
        if (!cancelled) setFields(data.fields);
      } catch (e) {
        if (!cancelled) {
          setExtractError(e instanceof Error ? e.message : "Extraction failed");
        }
      } finally {
        if (!cancelled) setExtracting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [captured, attempt]);

  const handleAuthed = (t: string) => {
    setToken(t);
    setTok(t);
  };

  // Back to the camera for the next form; keeps the batch.
  const rescan = () => {
    setCaptured(null);
    setFields(null);
    setExtractError(null);
  };

  const lock = () => {
    clearToken();
    setTok(null);
    setBatch(null);
    setCaptured(null);
    setFields(null);
    setExtractError(null);
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

  if (extracting) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 text-neutral-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
        <p>Reading the form…</p>
      </main>
    );
  }

  if (extractError || !fields) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 p-6 text-center">
        <p className="text-neutral-700">{extractError ?? "Couldn't read the form."}</p>
        <div className="flex w-full flex-col gap-3">
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-lg font-medium text-white"
          >
            Try reading again
          </button>
          <button
            onClick={rescan}
            className="w-full rounded-xl border border-neutral-300 px-4 py-3.5 text-lg font-medium"
          >
            Rescan
          </button>
        </div>
      </main>
    );
  }

  return (
    <ConfirmScreen
      fields={fields}
      batch={batch}
      image={captured}
      onSaved={rescan}
      onRescan={rescan}
      onChangeBatch={() => {
        rescan();
        setBatch(null);
      }}
    />
  );
}

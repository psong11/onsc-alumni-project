"use client";

import { useEffect, useMemo, useState } from "react";
import { authHeader } from "@/lib/session";
import type { Batch, ExtractedFields } from "@/lib/types";

// Step after extraction: the volunteer verifies the 6 read fields against the
// photo, fills any blanks Claude left, and saves. program/year are carried in
// from the batch (editable here in case a single form deviates).

const FIELDS: {
  key: keyof ExtractedFields;
  label: string;
  type?: string;
  placeholder?: string;
}[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "dob", label: "Date of birth", placeholder: "YYYY-MM-DD" },
  { key: "cell_phone", label: "Cell phone", type: "tel", placeholder: "(XXX) XXX-XXXX" },
  { key: "email", label: "Email", type: "email" },
  { key: "address", label: "Address" },
];

export default function ConfirmScreen({
  fields,
  batch,
  image,
  onSaved,
  onRescan,
  onChangeBatch,
}: {
  fields: ExtractedFields;
  batch: Batch;
  image: Blob;
  onSaved: () => void;
  onRescan: () => void;
  onChangeBatch: () => void;
}) {
  const [vals, setVals] = useState<ExtractedFields>(fields);
  const [program, setProgram] = useState(batch.program);
  const [year, setYear] = useState<number>(batch.year);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(image);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  const hasName = vals.first_name.trim() !== "" && vals.last_name.trim() !== "";
  const hasContact = vals.email.trim() !== "" || vals.cell_phone.trim() !== "";
  const valid = useMemo(
    () => hasName && hasContact && program.trim() !== "" && !!year,
    [hasName, hasContact, program, year],
  );

  function set(key: keyof ExtractedFields, v: string) {
    setVals((prev) => ({ ...prev, [key]: v }));
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeader() },
        body: JSON.stringify({
          fields: vals,
          batch: { program: program.trim(), year },
        }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({})))?.error || "Save failed";
        throw new Error(msg);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 pb-2 pt-3">
        <h1 className="text-lg font-semibold">Confirm details</h1>
        <button onClick={onChangeBatch} className="text-sm text-neutral-400 underline">
          Change batch
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Reference photo — collapsed by default to keep fields above the fold */}
        {url && (
          <button
            onClick={() => setShowPhoto((s) => !s)}
            className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 p-2 text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Captured form"
              className="h-14 w-14 shrink-0 rounded object-cover"
            />
            <span className="text-sm text-neutral-500">
              {showPhoto ? "Hide photo" : "Tap to view the photo"}
            </span>
          </button>
        )}
        {showPhoto && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Captured form"
            className="max-h-[60vh] w-full rounded-xl border border-neutral-200 object-contain"
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Program">
            <input
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              className={inputClass(program)}
            />
          </Field>
          <Field label="Year">
            <input
              type="number"
              inputMode="numeric"
              value={year || ""}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : 0)}
              className={inputClass(year ? String(year) : "")}
            />
          </Field>
        </div>

        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              type={f.type ?? "text"}
              value={vals[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              autoCapitalize={f.key === "email" ? "none" : "words"}
              autoCorrect="off"
              className={inputClass(vals[f.key])}
            />
          </Field>
        ))}

        {!valid && (
          <p className="text-sm text-amber-600">
            Need first + last name and at least one of email or cell phone.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex gap-3 border-t border-neutral-200 p-4">
        <button
          onClick={onRescan}
          disabled={saving}
          aria-label="Discard and rescan"
          className="flex h-14 w-16 shrink-0 items-center justify-center rounded-xl border border-neutral-300 text-2xl text-red-600 disabled:opacity-40"
        >
          ✕
        </button>
        <button
          onClick={save}
          disabled={!valid || saving}
          className="flex h-14 flex-1 items-center justify-center rounded-xl bg-neutral-900 text-lg font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "✓ Save to sheet"}
        </button>
      </div>
    </main>
  );
}

// Empty fields (blanks Claude left, or required gaps) get an amber border to
// pull the volunteer's eye to what still needs a human.
function inputClass(value: string) {
  const base =
    "w-full rounded-lg border px-3 py-2.5 text-base outline-none focus:border-neutral-900";
  return value.trim() === ""
    ? `${base} border-amber-300 bg-amber-50`
    : `${base} border-neutral-300`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

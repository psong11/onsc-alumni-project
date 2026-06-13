"use client";

import { useMemo, useState } from "react";
import type { Batch } from "@/lib/types";

const ADD_NEW = "__add_new__";
const EARLIEST_YEAR = 2005;

export default function BatchScreen({
  programs,
  onAddProgram,
  onStart,
  onLock,
}: {
  programs: string[];
  onAddProgram: (name: string) => Promise<void> | void;
  onStart: (batch: Batch) => void;
  onLock: () => void;
}) {
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const list: number[] = [];
    for (let y = now; y >= EARLIEST_YEAR; y--) list.push(y);
    return list;
  }, []);

  const [program, setProgram] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function handleProgramSelect(value: string) {
    if (value === ADD_NEW) {
      setAdding(true);
      setNewName("");
      return;
    }
    setProgram(value);
  }

  async function confirmAdd() {
    const name = newName.trim();
    if (!name) return;
    if (!programs.includes(name)) await onAddProgram(name);
    setProgram(name);
    setAdding(false);
  }

  const canStart = program !== "" && year !== "";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 p-6">
      <header className="flex items-center justify-between pt-2">
        <h1 className="text-xl font-semibold">Start a batch</h1>
        <button onClick={onLock} className="text-sm text-neutral-400">
          Lock
        </button>
      </header>

      <p className="text-sm text-neutral-500">
        Set the program and year for this stack of forms. They&rsquo;ll auto-fill
        on every scan until you change the batch.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Program</span>
          {adding ? (
            <div className="flex items-stretch gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New program name"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-base outline-none focus:border-neutral-900"
              />
              <button
                onClick={confirmAdd}
                disabled={!newName.trim()}
                className="rounded-lg bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-40"
              >
                Add
              </button>
              <button
                onClick={() => setAdding(false)}
                className="px-1 text-sm text-neutral-500"
              >
                Cancel
              </button>
            </div>
          ) : (
            <select
              value={program}
              onChange={(e) => handleProgramSelect(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-neutral-900"
            >
              <option value="" disabled>
                Select a program…
              </option>
              {programs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value={ADD_NEW}>➕ Add a new program…</option>
            </select>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Year</span>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : "")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-base outline-none focus:border-neutral-900"
          >
            <option value="" disabled>
              Select a year…
            </option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        onClick={() => canStart && onStart({ program, year: year as number })}
        disabled={!canStart}
        className="mt-2 w-full rounded-xl bg-neutral-900 px-4 py-3.5 text-lg font-medium text-white disabled:opacity-40"
      >
        Start scanning →
      </button>
    </main>
  );
}

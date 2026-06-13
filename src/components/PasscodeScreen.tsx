"use client";

import { useState } from "react";

export default function PasscodeScreen({
  onAuthed,
}: {
  onAuthed: (token: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: value }),
      });
      if (!res.ok) {
        setError("Incorrect passcode.");
        setLoading(false);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      onAuthed(token);
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">ONSC Alumni</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Enter the passcode to continue.
        </p>
      </div>
      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Passcode"
          autoComplete="off"
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-lg outline-none focus:border-neutral-900"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading || value.length === 0}
          className="w-full rounded-xl bg-neutral-900 px-4 py-3 text-lg font-medium text-white disabled:opacity-40"
        >
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}

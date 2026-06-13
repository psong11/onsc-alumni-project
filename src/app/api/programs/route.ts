import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { SEED_PROGRAMS } from "@/lib/programs";

// GET: the program list for the dropdown. Loaded once by the client and cached.
// POST: register a newly-typed program name.
//
// TODO(phase 7): back both by the Google Sheet "Programs" tab —
//   GET reads it (cached), POST appends if not already present.
// For now GET returns the seed list and POST just validates + acknowledges.

export async function GET(req: Request) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ programs: SEED_PROGRAMS });
}

export async function POST(req: Request) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { program?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const program = typeof body.program === "string" ? body.program.trim() : "";
  if (!program) {
    return NextResponse.json({ error: "Empty program name" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, program });
}

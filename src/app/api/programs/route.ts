import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { SEED_PROGRAMS } from "@/lib/programs";
import { appendRows, ensureTab, getValues } from "@/lib/sheets";

// The program list lives in a "Programs" tab of the Sheet (column A, row 1 is a
// header). GET reads it; POST appends a newly-typed program. On first run the
// tab is created and seeded with SEED_PROGRAMS so the dropdown isn't empty.
// If the Sheet is unreachable, GET falls back to the seed list so the app still
// works for capture/extract.

export const maxDuration = 30;

const PROGRAMS_TAB = "Programs";
const HEADER = ["Program"];

async function readPrograms(): Promise<string[]> {
  await ensureTab(PROGRAMS_TAB, HEADER);
  let rows = await getValues(`${PROGRAMS_TAB}!A2:A`);
  if (rows.length === 0) {
    // Freshly created tab — seed it once.
    await appendRows(PROGRAMS_TAB, SEED_PROGRAMS.map((p) => [p]));
    rows = SEED_PROGRAMS.map((p) => [p]);
  }
  return rows.map((r) => r[0]?.trim()).filter((p): p is string => !!p);
}

export async function GET(req: Request) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ programs: await readPrograms() });
  } catch {
    // Don't block the volunteer if Sheets is misconfigured; serve the seed.
    return NextResponse.json({ programs: SEED_PROGRAMS });
  }
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

  try {
    await ensureTab(PROGRAMS_TAB, HEADER);
    const existing = (await getValues(`${PROGRAMS_TAB}!A2:A`)).map((r) =>
      r[0]?.trim().toLowerCase(),
    );
    if (!existing.includes(program.toLowerCase())) {
      await appendRows(PROGRAMS_TAB, [[program]]);
    }
    return NextResponse.json({ ok: true, program });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save program";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

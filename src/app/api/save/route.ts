import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { appendRows, ensureTab } from "@/lib/sheets";
import type { Batch, ExtractedFields } from "@/lib/types";

// Appends one confirmed enrollment as a row in the Google Sheet (the only
// datastore). On any write failure we return 502 so the client blocks and lets
// the volunteer retry without losing the typed data.

export const maxDuration = 30;

const DATA_TAB = "Entries";
const HEADER = [
  "First Name",
  "Last Name",
  "DOB",
  "Cell Phone",
  "Email",
  "Address",
  "Program",
  "Year",
  "Saved At",
];

type SaveBody = { fields?: Partial<ExtractedFields>; batch?: Partial<Batch> };

export async function POST(req: Request) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const f = body.fields ?? {};
  const b = body.batch ?? {};

  const hasName = !!f.first_name?.trim() && !!f.last_name?.trim();
  const hasContact = !!f.email?.trim() || !!f.cell_phone?.trim();
  if (!hasName || !hasContact) {
    return NextResponse.json(
      { error: "First + last name and at least one contact are required." },
      { status: 400 },
    );
  }
  if (!b.program?.trim() || !b.year) {
    return NextResponse.json({ error: "Missing batch program/year." }, { status: 400 });
  }

  const row = [
    f.first_name!.trim(),
    f.last_name!.trim(),
    f.dob?.trim() ?? "",
    f.cell_phone?.trim() ?? "",
    f.email?.trim() ?? "",
    f.address?.trim() ?? "",
    b.program.trim(),
    b.year,
    new Date().toISOString(),
  ];

  try {
    await ensureTab(DATA_TAB, HEADER);
    await appendRows(DATA_TAB, [row]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

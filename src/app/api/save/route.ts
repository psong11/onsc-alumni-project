import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { Batch, ExtractedFields } from "@/lib/types";

// Appends one confirmed enrollment as a row in the Google Sheet.
//
// TODO(phase 7): write to the Sheet via the service account.
//   - read GOOGLE_SERVICE_ACCOUNT_JSON + SHEET_ID from env
//   - auth with googleapis, sheets.spreadsheets.values.append
//   - row order: [year, program, first_name, last_name, dob, cell_phone, email, address, savedAt]
//   - on write failure return 502 so the client blocks + lets the volunteer retry
// For now this validates the payload and acknowledges, so the capture →
// extract → confirm flow is testable end-to-end before the Sheet is wired.

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

  // Phase 7 replaces this no-op with the Sheets append.
  return NextResponse.json({ ok: true });
}

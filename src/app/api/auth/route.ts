import { NextResponse } from "next/server";
import { createToken } from "@/lib/auth";

// Checks the submitted passcode against APP_PASSCODE (server-side env var) and,
// on match, issues a signed session token the client stores in sessionStorage.
export async function POST(req: Request) {
  const expected = process.env.APP_PASSCODE ?? "";

  let body: { passcode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!expected || typeof body.passcode !== "string" || body.passcode !== expected) {
    return NextResponse.json({ error: "Incorrect passcode" }, { status: 401 });
  }

  return NextResponse.json({ token: createToken() });
}

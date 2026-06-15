import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import type { ExtractedFields } from "@/lib/types";

// Reads one photographed registration form and returns the per-person fields.
// The prompt + schema are lifted verbatim from poc/extract.mjs, which was
// validated against real forms. program/year are NOT extracted here — they
// come from the batch context the volunteer set once for the whole stack.

export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6"; // one-line swap point (e.g. claude-opus-4-8 for max accuracy)

const SCHEMA = {
  type: "object",
  properties: {
    first_name: { type: "string", description: "Participant first name. Empty string if unreadable." },
    last_name: { type: "string", description: "Participant last name. Empty string if unreadable." },
    dob: { type: "string", description: "Date of birth, ISO YYYY-MM-DD. Empty string if missing/unreadable." },
    cell_phone: { type: "string", description: "CELL number only, formatted (XXX) XXX-XXXX. Empty string if missing/unreadable." },
    email: { type: "string", description: "Email address. Empty string if missing/unreadable." },
    address: { type: "string", description: "Full mailing address on one line: street, city, ST ZIP. Empty string if missing/unreadable." },
  },
  required: ["first_name", "last_name", "dob", "cell_phone", "email", "address"],
  additionalProperties: false,
};

const PROMPT = `This is a photo of a handwritten "ONSC Participant Registration Form" (a youth science-camp sign-up sheet). The photo may be rotated sideways — read it in whatever orientation it is in.

Extract these fields for the single participant on the form:
- first_name / last_name — from "Participant Name".
- dob — date of birth as ISO YYYY-MM-DD. The form usually writes it as M-D-YY. Participants are youth, so interpret a 2-digit year 30-99 as 19xx and 00-29 as 20xx (e.g. "1-17-98" -> "1998-01-17").
- cell_phone — the CELL number ONLY. The form has separate Home / Work / Cell / Other number fields; ignore every one except Cell. Format as (XXX) XXX-XXXX.
- email — the email address.
- address — combine Mailing Address, City, State, and ZIP into a single line: "street, city, ST ZIP".

Transcribe exactly what is written. If a field is blank, missing, or you cannot read it confidently, return an empty string "" for it. Do NOT guess.`;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

export async function POST(req: Request) {
  if (!requireAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let bytes: ArrayBuffer;
  let mediaType = "image/jpeg";
  try {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }
    if (file.type) mediaType = file.type;
    bytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const b64 = Buffer.from(bytes).toString("base64");

  try {
    // output_config / adaptive thinking aren't in this SDK version's TS types yet;
    // cast keeps the proven request shape from the PoC.
    const resp: Anthropic.Message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const textBlock = resp.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text : "";
    let fields: ExtractedFields;
    try {
      fields = JSON.parse(text) as ExtractedFields;
    } catch {
      return NextResponse.json(
        { error: "Couldn't read the form. Try again with a clearer photo." },
        { status: 502 },
      );
    }
    return NextResponse.json({ fields });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

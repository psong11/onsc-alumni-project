// Extraction proof-of-concept for the ONSC alumni digitizer.
// Sends a photographed registration form to Claude Sonnet 4.6 and prints the
// structured fields. This is the viability test: can the model read the
// handwriting well enough? Run:
//   node --env-file=.env extract.mjs samples/IMG_6731.jpg [more.jpg ...]

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const MODEL = "claude-sonnet-4-6"; // one-line swap point (e.g. claude-opus-4-8 for max accuracy)

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Only the per-person fields. program_name + year are batch-sourced (set once
// per stack in the real app), NOT extracted from the form — so they're absent here.
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

async function extract(path) {
  const b64 = readFileSync(path).toString("base64");
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" }, // let the model reason over messy handwriting
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const ms = Date.now() - t0;
  const textBlock = resp.content.find((b) => b.type === "text");
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    parsed = { _unparsed: textBlock?.text ?? "(no text block)" };
  }
  return { ms, usage: resp.usage, parsed };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node --env-file=.env extract.mjs <image.jpg> [more.jpg ...]");
  process.exit(1);
}

for (const f of files) {
  try {
    const { ms, usage, parsed } = await extract(f);
    console.log(`\n=== ${basename(f)}  (${ms} ms · in ${usage.input_tokens} tok · out ${usage.output_tokens} tok) ===`);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log(`\n=== ${basename(f)} ===\nERROR: ${e?.message || e}`);
  }
}

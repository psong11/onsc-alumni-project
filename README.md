# ONSC Alumni Digitizer

> The Ozark Natural Science Center has spent decades introducing kids to the outdoors — and decades of their stories sit in boxes of handwritten registration forms. This app helps volunteers bring those records back to life: snap a photo, let the AI read it, confirm, and it's saved — so ONSC can reconnect with the alumni it once inspired.

A phone-first web app that turns a closet full of paper into clean, searchable alumni data — one photograph at a time.

---

## The problem

Every kid who attended an ONSC camp filled out a paper registration form. Across the years that's thousands of handwritten sheets, sitting in storage boxes by program and year. Reaching back out to those alumni meant someone re-typing each form by hand — a task measured in months of volunteer time.

This tool replaces that with a few seconds per form, from any phone.

## How it works

```
   📷  Photograph        🤖  AI reads          ✅  Volunteer         📊  Saved to
       the form     →        the handwriting →     confirms / edits →    Google Sheet
```

1. **Sign in** with a shared passcode (the whole team uses one).
2. **Set the batch** — pick the program and year once for the stack you're working through; it auto-fills on every scan.
3. **Point at a form.** The camera detects when a page is framed and steady, then captures automatically — no perfect tap required.
4. **Review.** An AI vision model transcribes the fields (name, date of birth, contact, address). Anything it couldn't read confidently is left blank and highlighted, so a human fills only the gaps.
5. **Save.** One tap appends a clean row to a Google Sheet. On to the next form.

## Why it's built this way

The design choices are driven by the fact that these forms carry **children's personal information**, and that the people using the tool are volunteers, not engineers.

- **Privacy-first and stateless.** There is no database and no image storage. Photos live only in the phone's memory long enough to be read, and the only thing that persists is the confirmed text row in the Sheet.
- **The spreadsheet *is* the database.** ONSC staff already live in Google Sheets, so the data lands somewhere they can sort, filter, and share immediately — no new system to learn or maintain.
- **On-device auto-capture.** A lightweight detector watches the live camera feed for a page that's framed, in focus, and held still, then grabs the sharpest of several frames — so even a shaky hand produces a crisp, readable photo.
- **Structured extraction with guardrails.** The vision model is constrained to a strict schema and explicitly instructed to leave a field blank rather than guess, keeping bad data out of the record.
- **Human-in-the-loop by design.** Nothing is ever saved automatically. A volunteer confirms every record, and unreadable fields are visually flagged for attention.
- **Lightweight, server-enforced auth.** A shared passcode is exchanged for an HMAC-signed session token that's checked on every API call, so the data endpoints can't be hit without it — without the overhead of full user accounts.

## Architecture

```
 ┌─────────────────┐        ┌──────────────────────────┐        ┌──────────────────┐
 │  Phone browser  │        │   Serverless API routes  │        │  External         │
 │  (Next.js/React)│        │      (Next.js on Vercel) │        │  services         │
 │                 │        │                          │        │                  │
 │  camera +       │  JPEG  │  /api/extract  ──────────┼──────► │  Claude (vision)  │
 │  confirm UI     │ ─────► │  /api/save     ──────────┼──────► │  Google Sheets    │
 │                 │        │  /api/auth /api/programs  │        │  (service account)│
 └─────────────────┘        └──────────────────────────┘        └──────────────────┘
```

Stateless throughout: the browser holds transient state, the API routes hold none, and the Sheet is the single source of truth.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · Anthropic SDK (Claude vision) · Google Sheets API · deployed on Vercel.

## Project structure

```
src/
├── app/
│   ├── page.tsx            # entry point
│   └── api/
│       ├── auth/           # passcode → signed session token
│       ├── programs/       # program list, backed by a "Programs" sheet tab
│       ├── extract/        # photo → structured fields (Claude vision)
│       └── save/           # confirmed record → appended Sheet row
├── components/
│   ├── App.tsx             # flow state machine
│   ├── PasscodeScreen.tsx
│   ├── BatchScreen.tsx     # program + year for the current stack
│   ├── CameraScreen.tsx    # live camera + auto-capture
│   └── ConfirmScreen.tsx   # review / edit / save
└── lib/
    ├── auth.ts             # HMAC token create / verify (server)
    ├── session.ts          # client-side token handling
    ├── sheets.ts           # Google Sheets access via service account
    ├── programs.ts         # seed program list
    └── types.ts
```

## Running locally

**Prerequisites**

- Node.js
- An [Anthropic API key](https://console.anthropic.com/)
- A Google Cloud service account with the Sheets API enabled, and a target spreadsheet shared with the service account's email

**Setup**

```bash
npm install
```

Create a `.env` file (never committed) with:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Authenticates the vision extraction calls |
| `APP_PASSCODE` | The shared passcode volunteers enter |
| `SESSION_SECRET` | Random string used to sign session tokens |
| `GOOGLE_SERVICE_ACCOUNT_B64` | Base64-encoded service-account JSON key |
| `SHEET_ID` | The destination Google Sheet's ID |

Then:

```bash
npm run dev
```

On first save, the app creates an `Entries` tab (with headers) and a `Programs` tab in the spreadsheet automatically.

## Status & roadmap

**v1 — shipped.** The full capture → extract → confirm → save flow works end to end, validated on real forms and phones.

Consciously deferred to a future version:

- **Roster forms** — extracting multiple participants from a single multi-row sheet.
- **Duplicate detection** — flagging a participant who's already been entered.
- **Per-volunteer accounts** — replacing the shared passcode if usage grows.

---

Built as a volunteer project for the Ozark Natural Science Center.

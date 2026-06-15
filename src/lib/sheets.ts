import { JWT } from "google-auth-library";

// Server-only Google Sheets access via the service account. The whole service
// account JSON is stored base64-encoded in GOOGLE_SERVICE_ACCOUNT_B64 (so the
// multi-line private key survives env vars cleanly); SHEET_ID is the target
// spreadsheet. The Sheet must be shared (Editor) with the service account email.

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function credentials(): { client_email: string; private_key: string } {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 is not set");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

function sheetId(): string {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("SHEET_ID is not set");
  return id;
}

let jwt: JWT | null = null;
async function accessToken(): Promise<string> {
  if (!jwt) {
    const c = credentials();
    jwt = new JWT({ email: c.client_email, key: c.private_key, scopes: SCOPES });
  }
  const t = await jwt.getAccessToken();
  if (!t.token) throw new Error("Failed to obtain Google access token");
  return t.token;
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/${sheetId()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await accessToken()}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Read a range, e.g. "Entries!A2:A". Returns [] when empty. */
export async function getValues(range: string): Promise<string[][]> {
  const data = await api<{ values?: string[][] }>(
    `/values/${encodeURIComponent(range)}`,
  );
  return data.values ?? [];
}

/** Append one or more rows to the bottom of a tab. */
export async function appendRows(
  tab: string,
  rows: (string | number)[][],
): Promise<void> {
  await api(
    `/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

async function listTabs(): Promise<string[]> {
  const data = await api<{ sheets?: { properties: { title: string } }[] }>(
    `?fields=sheets.properties.title`,
  );
  return (data.sheets ?? []).map((s) => s.properties.title);
}

// Tabs we've already verified this process lifetime — avoids re-checking every
// request. Idempotent across instances since we check existence before adding.
const ensured = new Set<string>();

/**
 * Ensure a tab exists; if a header is given, write it when the tab is empty.
 * Safe to call before every read/write — does real work only once per process.
 */
export async function ensureTab(title: string, header?: string[]): Promise<void> {
  if (ensured.has(title)) return;
  const tabs = await listTabs();
  if (!tabs.includes(title)) {
    await api(`:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    if (header) await appendRows(title, [header]);
  } else if (header) {
    const first = await getValues(`${title}!A1:A1`);
    if (first.length === 0) await appendRows(title, [header]);
  }
  ensured.add(title);
}

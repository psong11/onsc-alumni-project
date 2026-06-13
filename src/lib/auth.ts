import crypto from "node:crypto";

// Server-only. Issues and verifies HMAC-signed session tokens so the API
// endpoints (/extract, /save) can't be called without a valid passcode session.
// The passcode itself never reaches the browser; only a signed token does.

const SECRET = process.env.SESSION_SECRET ?? "";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h ceiling; sessionStorage already clears on app close

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function createToken(): string {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token || !SECRET) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;

  try {
    const { iat } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof iat === "number" && Date.now() - iat < MAX_AGE_MS;
  } catch {
    return false;
  }
}

/** Returns true if the request carries a valid `Authorization: Bearer <token>`. */
export function requireAuth(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return verifyToken(token);
}

"use client";

// Client-side session token handling. Stored in sessionStorage so it is cleared
// when the app is fully closed — forcing passcode re-entry, per the design.

const TOKEN_KEY = "onsc_session_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** Authorization header for authenticated API calls. */
export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

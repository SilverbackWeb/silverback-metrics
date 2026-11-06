/** Signed session cookie (same approach as the Silverback Scorecard). Edge-safe: no DB access here. */
import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "sbm_session";
const DAYS = 30;

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set (at least 16 characters).");
  return new TextEncoder().encode(s);
}

export type Session = { userId: string; name: string; agency: boolean };

export async function signSession(s: Session) {
  return new SignJWT({ name: s.name, agency: s.agency })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${DAYS}d`)
    .sign(key());
}

export async function readSession(token?: string | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { userId: String(payload.sub), name: String(payload.name ?? ""), agency: payload.agency === true };
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DAYS * 24 * 60 * 60,
};

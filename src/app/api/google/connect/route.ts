/** Start the one-time Google sign-in (agency admins only). */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/access";
import { authUrl, googleConfigured } from "@/lib/google";
import { randomToken } from "@/lib/password";

export async function GET(req: Request) {
  const user = await requireAgency();
  if (user.agencyRole !== "agency_admin" || !googleConfigured()) notFound();
  const u = new URL(req.url);
  const back = u.searchParams.get("back") ?? "/";
  const state = randomToken();
  (await cookies()).set("sbm_gstate", JSON.stringify({ state, back: back.startsWith("/") ? back : "/" }), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: 600 });
  return Response.redirect(authUrl(`${process.env.APP_URL?.replace(/\/$/, "") ?? u.origin}/api/google/callback`, state), 302);
}

/** Google sends the team back here after sign-in; store the refresh token (encrypted). */
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/access";
import { exchangeCode, saveConnection } from "@/lib/google";

export async function GET(req: Request) {
  const user = await requireAgency();
  if (user.agencyRole !== "agency_admin") notFound();
  const u = new URL(req.url);
  const jar = await cookies();
  let saved: { state: string; back: string } | null = null;
  try { saved = JSON.parse(jar.get("sbm_gstate")?.value ?? "null"); } catch { saved = null; }
  jar.delete("sbm_gstate");
  const back = saved?.back ?? "/";
  const go = (q: string) => Response.redirect(new URL(`${back}${back.includes("?") ? "&" : "?"}${q}`, u.origin), 302);
  if (!saved || saved.state !== u.searchParams.get("state")) return go("google=badstate");
  const code = u.searchParams.get("code");
  if (!code) return go(`google=${encodeURIComponent(u.searchParams.get("error") ?? "cancelled")}`);
  try {
    await saveConnection(await exchangeCode(code, `${process.env.APP_URL?.replace(/\/$/, "") ?? u.origin}/api/google/callback`));
  } catch (e) {
    console.error("google connect failed", e);
    return go("google=failed");
  }
  return go("google=connected");
}

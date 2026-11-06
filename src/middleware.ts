import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, readSession } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const session = await readSession(req.cookies.get(COOKIE)?.value);
  if (session) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

// Public: login, first-time setup, the tracking snippet and its endpoints, webhooks and cron.
export const config = {
  matcher: ["/((?!login|setup|t\\.js|api/collect|api/ingest|api/cron|_next|favicon.ico).*)"],
};

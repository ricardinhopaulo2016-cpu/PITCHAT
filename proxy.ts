import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` and `middleware()` -> `proxy()`.
// Runtime is always `nodejs` here (no `edge` option). See docs/PITCHAT_ARCHITECTURE.md §2.

const PROTECTED_PREFIXES = ["/dashboard"];
const AUTH_PAGES = ["/login"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const { response, user, configured, unauthorized } = await updateSession(request);

  // Supabase isn't configured yet (no project created / .env.local not filled).
  // Unlike PitBrain, PITCHAT has no local-storage fallback — send everyone to
  // a setup page instead of letting them hit broken data calls.
  if (!configured) {
    if (path === "/setup" || path.startsWith("/_next") || path.startsWith("/api")) {
      return response;
    }
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  if (unauthorized) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "unauthorized");
    return NextResponse.redirect(loginUrl);
  }

  if (path === "/") {
    return NextResponse.redirect(new URL(user ? "/dashboard" : "/login", request.url));
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  const isAuthPage = AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`));

  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

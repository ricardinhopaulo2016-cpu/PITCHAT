import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isEmailAllowed } from "@/lib/auth/allowed-emails";

/**
 * Refreshes the Supabase session cookie for the current request and reports
 * whether a user is logged in and allowlisted. Used by proxy.ts.
 *
 * Unlike PitBrain, there is no "local mode" fallback here: PITCHAT's data
 * (messages, contacts, automation runs) cannot live in localStorage, so an
 * unconfigured Supabase means the whole app is unusable, not degraded.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { response, user: null, configured: false as const, unauthorized: false };
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && !isEmailAllowed(user.email)) {
    // Valid Supabase session, but not on the allowlist — sign out immediately
    // instead of letting them use the app.
    await supabase.auth.signOut();
    return { response, user: null, configured: true as const, unauthorized: true };
  }

  return { response, user, configured: true as const, unauthorized: false };
}

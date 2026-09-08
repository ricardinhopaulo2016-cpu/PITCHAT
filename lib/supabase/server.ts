import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cookie-bound client for Server Components / Route Handlers — publishable
 * key (not the secret key — this client acts AS the logged-in user, RLS
 * still applies), carries the current request's session so `auth.getUser()`
 * and RLS work. Returns null if Supabase isn't configured.
 *
 * Note: uses `SUPABASE_URL` (server-only var name), not the `NEXT_PUBLIC_`
 * one — same value, but this file never runs in the browser.
 */
export async function getSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) return null;

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component render — safe to ignore since
          // proxy.ts already refreshes the session cookie on navigation.
        }
      },
    },
  });
}

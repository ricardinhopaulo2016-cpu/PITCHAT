import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null | undefined;

/**
 * Browser client for client components (login/logout). Publishable key only
 * (`sb_publishable_...`, Supabase's new key format) — safe to expose, this is
 * the only Supabase key that's ever allowed in client-bundled code. Returns
 * null if Supabase isn't configured.
 */
export function getSupabaseBrowserClient() {
  if (client !== undefined) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    client = null;
    return client;
  }

  client = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return client;
}

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null | undefined;

/**
 * Browser client for client components (login/logout). Anon key only —
 * safe to expose. Returns null if Supabase isn't configured.
 */
export function getSupabaseBrowserClient() {
  if (client !== undefined) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    client = null;
    return client;
  }

  client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}

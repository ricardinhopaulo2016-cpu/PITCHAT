import { createClient, SupabaseClient } from "@supabase/supabase-js";
import "server-only";

let cachedAdminClient: SupabaseClient | null | undefined;

/**
 * Privileged, secret-key client. Imports "server-only" so any accidental
 * import from a Client Component fails the build instead of leaking the
 * secret key into the browser bundle — belt-and-suspenders on top of the
 * `typeof window` check below.
 *
 * Bypasses RLS: every handler that uses this MUST validate workspace_id
 * itself (see docs/PITCHAT_ARCHITECTURE.md §4 — RLS here is defense in
 * depth, not the only barrier).
 *
 * Uses Supabase's new key format (`sb_secret_...`) — see
 * docs/PITCHAT_ARCHITECTURE.md §2 for why we're on SUPABASE_URL /
 * SUPABASE_SECRET_KEY instead of the legacy SUPABASE_SERVICE_ROLE_KEY name.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdminClient() cannot be called in the browser — it would expose the secret key."
    );
  }

  if (cachedAdminClient !== undefined) return cachedAdminClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    cachedAdminClient = null;
    return cachedAdminClient;
  }

  cachedAdminClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdminClient;
}

/** True when Supabase (URL + secret key) is fully configured server-side. */
export function isSupabaseConfigured(): boolean {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY;
}

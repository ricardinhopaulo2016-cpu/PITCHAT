import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;
let cachedAdminClient: SupabaseClient | null | undefined;

/**
 * Public, anon-key client. Safe client-side or server-side, but has no
 * session attached — use lib/supabase/server.ts or lib/supabase/browser.ts
 * instead when you need the logged-in user's session (RLS-aware).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  return cachedClient;
}

/**
 * Privileged, service-role client. Server-side only — throws if called in the
 * browser, because the service role key must never reach client bundles.
 * Bypasses RLS: every handler that uses this MUST validate workspace_id
 * itself (see docs/PITCHAT_ARCHITECTURE.md §4 — RLS here is defense in depth,
 * not the only barrier).
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdminClient() cannot be called in the browser — it would expose the service role key."
    );
  }

  if (cachedAdminClient !== undefined) return cachedAdminClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    cachedAdminClient = null;
    return cachedAdminClient;
  }

  cachedAdminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedAdminClient;
}

/** True when Supabase (URL + service role key) is fully configured server-side. */
export function isSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AdminClient = SupabaseClient;

export function adminClient(): AdminClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be available to the Edge Function.");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Edge Functions run behind Supabase's JWT gateway, which also accepts the
 * public anon key. Publishing and cleanup are privileged operations, so the
 * worker additionally requires the exact service role key.
 */
export function assertServiceRole(req: Request): boolean {
  const header = req.headers.get("Authorization") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return key.length > 0 && header === `Bearer ${key}`;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

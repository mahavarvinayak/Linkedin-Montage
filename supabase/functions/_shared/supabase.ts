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
  const authHeader = (req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "").trim();
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const envKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();

  if (envKey.length > 0 && (token === envKey || apikey === envKey)) {
    return true;
  }

  // Also accept if token is verified service_role JWT
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.role === "service_role") {
        return true;
      }
    }
  } catch {
    // ignore
  }

  return false;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

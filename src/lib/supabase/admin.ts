import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv, isServiceRoleConfigured } from "@/lib/env";

let adminClient: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service role key. Never import this
 * module from a Client Component. Used for signed media URLs, OAuth token
 * storage and invoking the publishing worker.
 */
export function createAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const { url, serviceRoleKey } = getSupabaseEnv();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase service role is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.",
    );
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

export function tryCreateAdminClient(): SupabaseClient | null {
  if (!isServiceRoleConfigured()) return null;
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

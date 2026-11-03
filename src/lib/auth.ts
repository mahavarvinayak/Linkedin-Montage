import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminEmail, isSupabaseConfigured } from "@/lib/env";

export async function isAllowedAdmin(
  supabase: SupabaseClient,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;

  const normalized = email.trim().toLowerCase();
  const configured = getAdminEmail();

  if (configured && normalized !== configured) return false;

  const { data, error } = await supabase
    .from("app_admins")
    .select("email")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    console.error("Admin allowlist check failed", error.message);
    return false;
  }

  return Boolean(data);
}

export async function getSessionUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

export const requireAdminPage = cache(async (): Promise<{
  supabase: SupabaseClient;
  user: User;
}> => {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=not_configured");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const allowed = await isAllowedAdmin(supabase, user.email);
  if (!allowed) redirect("/login?error=unauthorized");

  return { supabase, user };
});

export type ApiAdminResult =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; response: NextResponse };

export async function requireAdminApi(): Promise<ApiAdminResult> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase is not configured on this deployment." },
        { status: 503 },
      ),
    };
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "You must sign in." }, { status: 401 }),
    };
  }

  if (!(await isAllowedAdmin(supabase, user.email))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "This account is not the dashboard admin." }, { status: 403 }),
    };
  }

  return { ok: true, supabase, user };
}

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAllowedAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export const runtime = "nodejs";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function isLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase is not configured. Finish setup before signing in." },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  if (isLimited(key)) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  let email = "";
  let password = "";

  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!email || !password || password.length > 200) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const allowed = await isAllowedAdmin(supabase, data.user.email);
  if (!allowed) {
    await supabase.auth.signOut();
    return NextResponse.json(
      {
        error:
          "This account is not on the dashboard allowlist. Add the email to public.app_admins and ADMIN_EMAIL.",
      },
      { status: 403 },
    );
  }

  buckets.delete(key);
  return NextResponse.json({ ok: true });
}

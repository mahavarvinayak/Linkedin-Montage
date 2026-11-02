import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getEnvironmentStatus, isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

function SetupView() {
  const env = getEnvironmentStatus();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Brand />
      <p className="mt-10 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Setup required
      </p>
      <h1 className="mt-2 font-serif text-4xl leading-[1.08] tracking-[-0.02em]">
        Connect the workspace before signing in.
      </h1>
      <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
        Cadence is a private app. It needs a Supabase project and one admin account before the
        login screen can work. Nothing below exposes a secret.
      </p>

      <div className="mt-8 space-y-3">
        {[
          {
            title: "Create .env.local",
            done: env.supabase.urlConfigured && env.supabase.anonKeyConfigured,
            body: (
              <>
                Copy <code className="font-mono text-[11px]">.env.example</code> to{" "}
                <code className="font-mono text-[11px]">.env.local</code> and set{" "}
                <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
                <code className="font-mono text-[11px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
                <code className="font-mono text-[11px]">SUPABASE_SERVICE_ROLE_KEY</code> and{" "}
                <code className="font-mono text-[11px]">ADMIN_EMAIL</code>.
              </>
            ),
          },
          {
            title: "Run the database migrations",
            done: false,
            body: (
              <>
                Run <code className="font-mono text-[11px]">supabase db push</code> (or{" "}
                <code className="font-mono text-[11px]">supabase db reset</code> locally). This
                creates the tables, RLS policies and the private media bucket.
              </>
            ),
          },
          {
            title: "Allow your admin account",
            done: env.auth.adminEmailConfigured,
            body: (
              <>
                Create the user in Supabase Authentication, then run{" "}
                <code className="font-mono text-[11px]">
                  select public.bootstrap_admin(&apos;you@example.com&apos;);
                </code>{" "}
                in the SQL editor. Restart the dev server afterwards.
              </>
            ),
          },
        ].map((step, index) => (
          <div
            key={step.title}
            className="flex gap-4 rounded-xl border border-border bg-card p-5"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-muted-foreground">
              {index + 1}
            </span>
            <div>
              <p className="text-[13.5px] font-medium">{step.title}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[11.5px] text-muted-foreground">
        Full instructions are in <code className="font-mono text-[11px]">README.md</code> and{" "}
        <code className="font-mono text-[11px]">docs/DEPLOYMENT.md</code>.
      </p>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-14">
        <SetupView />
      </main>
    );
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-border bg-[#f1f1ec] p-12 lg:flex">
        <Brand />
        <div className="max-w-md">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Private workspace
          </p>
          <h1 className="mt-3 font-serif text-[44px] leading-[1.04] tracking-[-0.025em] text-foreground">
            A calm publishing desk for your LinkedIn.
          </h1>
          <p className="mt-5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
            Draft in peace. Schedule in IST. Publish through LinkedIn’s official API. A single
            admin, a private queue, and no news feed competing for your attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-2 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Official API</span>
          <span>IST scheduling</span>
          <span>Single admin</span>
        </div>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[370px]">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>

          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Dashboard access
          </p>
          <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.025em]">Welcome back</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Sign in with the private admin account for this workspace.
          </p>

          <div className="mt-8">
            <LoginForm initialError={params.error} />
          </div>
        </div>
      </main>
    </div>
  );
}

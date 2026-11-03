import type { Metadata } from "next";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  HardDrive,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { PageHeader } from "@/components/page-header";
import { LinkedInConnectionPanel, TelegramPanel } from "@/components/settings-panels";
import { getIntegrationStatus, listLinkedInAccounts } from "@/lib/queries";
import { MEDIA_BUCKET } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

function StatusRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linkedin?: string; message?: string }>;
}) {
  const [status, accounts, params] = await Promise.all([
    getIntegrationStatus(),
    listLinkedInAccounts(),
    searchParams,
  ]);
  const env = status.environment;

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connect LinkedIn, manage multiple profiles, tune notifications and verify that this private workspace is configured correctly."
      />

      {params.linkedin === "connected" ? (
        <Alert tone="success" title="LinkedIn connected">
          The profile is connected and the OAuth token is stored in Supabase Vault. Send a test
          message from the notification panel to confirm Telegram at the same time.
        </Alert>
      ) : params.linkedin === "error" ? (
        <Alert tone="danger" title="LinkedIn could not be connected">
          {params.message || "LinkedIn returned an error. Check the callback URL and try again."}
        </Alert>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em]">LinkedIn Profiles & Accounts</h2>
        <LinkedInConnectionPanel
          configured={env.linkedin.configured}
          settings={status.settings}
          accounts={accounts}
          tokenExpired={status.tokenExpired}
          tokenExpiringSoon={status.tokenExpiringSoon}
        />

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[12.5px] font-medium">App configuration</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                These values must match your LinkedIn Developer App exactly.
              </p>
            </div>
            <span className="rounded-full bg-stone-50 px-2 py-0.5 text-[10px] text-stone-500 ring-1 ring-stone-200">
              API version {env.linkedin.version}
            </span>
          </div>

          <dl className="mt-4 space-y-3">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                OAuth redirect URL
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-stone-50 px-2 py-1.5 font-mono text-[10.5px] text-stone-700">
                  {env.linkedin.redirectUri}
                </code>
                <CopyButton value={env.linkedin.redirectUri} label="Copy URL" />
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Requested scopes
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {env.linkedin.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-md border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-stone-600"
                  >
                    {scope}
                  </span>
                ))}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Need help? The step-by-step guide is in{" "}
            <code className="font-mono text-[10.5px]">docs/LINKEDIN_SETUP.md</code>. The redirect URL
            above must be listed under “Authorized redirect URLs” in the LinkedIn app.
          </p>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em]">Notifications</h2>
        <TelegramPanel
          settings={status.settings}
          botTokenConfigured={env.telegram.botTokenConfigured}
          chatIdConfigured={env.telegram.chatIdConfigured}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em]">Workspace health</h2>
        <Card className="overflow-hidden">
          <div className="divide-y divide-border">
            <StatusRow
              label="Supabase URL and anon key"
              ok={env.supabase.configured}
              detail={
                env.supabase.configured
                  ? "Public client configuration is present."
                  : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
              }
            />
            <StatusRow
              label="Service role key"
              ok={env.supabase.serviceRoleConfigured}
              detail={
                env.supabase.serviceRoleConfigured
                  ? "Server-only access is configured for Vault, signed URLs and the worker."
                  : "Add SUPABASE_SERVICE_ROLE_KEY on the server. It is never sent to the browser."
              }
            />
            <StatusRow
              label="Database and settings row"
              ok={status.dbReady}
              detail={
                status.dbReady
                  ? "The settings row was found and is readable."
                  : status.storageError || "Run the SQL migrations in supabase/migrations."
              }
            />
            <StatusRow
              label="Private media bucket"
              ok={status.bucketReady}
              detail={
                status.bucketReady
                  ? `Bucket “${MEDIA_BUCKET}” exists and is reachable with the service role.`
                  : status.storageError || "The private media bucket is missing. Run migration 0001."
              }
            />
            <StatusRow
              label="Admin allowlist"
              ok={status.adminSeeded}
              detail={
                status.adminSeeded
                  ? "At least one email is allowed to sign in."
                  : "Run select public.bootstrap_admin('you@example.com'); in the SQL editor."
              }
            />
            <StatusRow
              label="ADMIN_EMAIL"
              ok={env.auth.adminEmailConfigured}
              detail={
                env.auth.adminEmailConfigured
                  ? "A single admin email is configured. It is also checked against app_admins."
                  : "Set ADMIN_EMAIL on the server as a second gate for the single admin."
              }
            />
            <StatusRow
              label="Telegram bot token"
              ok={env.telegram.botTokenConfigured}
              detail={
                env.telegram.botTokenConfigured
                  ? env.telegram.enabled
                    ? "Notifications are enabled by environment and can be toggled above."
                    : "TELEGRAM_NOTIFICATIONS_ENABLED is false, so messages are suppressed."
                  : "Optional. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to receive alerts."
              }
            />
          </div>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Database,
            title: "Migrations",
            body: "supabase/migrations creates the schema, RLS, Vault functions and the private bucket.",
          },
          {
            icon: KeyRound,
            title: "Tokens",
            body: "OAuth tokens live in Supabase Vault. Only the service role can read or write them.",
          },
          {
            icon: HardDrive,
            title: "Media cleanup",
            body: `Published media is deleted after ${env.mediaRetentionHours}h by an hourly Edge Function.`,
          },
          {
            icon: ShieldCheck,
            title: "Access",
            body: "One admin account. No public signup, no multi-user roles, no billing.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-border bg-white/60 p-4"
          >
            <item.icon className="size-4 text-stone-400" />
            <p className="mt-2.5 text-[12px] font-medium">{item.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Deployment steps, Vault secrets, Edge Function secrets and pg_cron setup are documented in{" "}
        <code className="font-mono text-[10.5px]">docs/DEPLOYMENT.md</code>. Cadence uses the official
        LinkedIn Posts API only — there is no scraping, browser automation or password login.
      </p>
    </div>
  );
}

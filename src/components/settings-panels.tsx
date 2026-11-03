"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Unplug,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatIST, relativeTime } from "@/lib/ist";
import type { LinkedInAccountRow, SettingsRow } from "@/lib/types";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function LinkedInConnectionPanel({
  configured,
  settings,
  accounts = [],
  tokenExpired,
  tokenExpiringSoon,
}: {
  configured: boolean;
  settings: SettingsRow | null;
  accounts?: LinkedInAccountRow[];
  tokenExpired: boolean;
  tokenExpiringSoon: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAccountUrn, setConfirmAccountUrn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const connected = Boolean(settings?.linkedin_connected) || accounts.length > 0;

  async function onTest() {
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/linkedin/test", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "LinkedIn test failed."));
      const payload = (await response.json()) as { warning?: string | null };
      if (payload.warning) {
        setError(payload.warning);
      } else {
        setResult("LinkedIn accepted the stored token and returned your profile.");
        toast.success("LinkedIn connection verified.");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "LinkedIn test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function onDisconnect(targetUrn?: string | null) {
    setDisconnecting(targetUrn || "all");
    setError(null);
    try {
      const response = await fetch("/api/linkedin/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetUrn ? { member_urn: targetUrn } : {}),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not disconnect LinkedIn."));
      toast.success(targetUrn ? "Account disconnected." : "All accounts disconnected.");
      setConfirmOpen(false);
      setConfirmAccountUrn(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect LinkedIn.");
    } finally {
      setDisconnecting(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border bg-stone-50/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-9 items-center justify-center rounded-lg ring-1 ${
              connected && !tokenExpired
                ? "bg-blue-50 text-blue-700 ring-blue-100"
                : "bg-white text-stone-400 ring-stone-200"
            }`}
          >
            <Plug className="size-4" />
          </span>
          <div>
            <p className="text-[13.5px] font-medium">LinkedIn profiles & accounts</p>
            <p className="text-[11px] text-muted-foreground">
              {accounts.length > 0
                ? `${accounts.length} connected ${accounts.length === 1 ? "profile" : "profiles"}`
                : "Official API · posting as a member"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {configured ? (
            <a
              href="/api/linkedin/authorize?prompt=login"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-blue-800"
            >
              <Plus className="size-3.5" />
              {connected ? "Connect another profile" : "Connect LinkedIn"}
            </a>
          ) : null}

          {connected ? (
            <>
              <Button variant="secondary" size="sm" onClick={onTest} disabled={testing || Boolean(disconnecting)}>
                {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Test
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirmAccountUrn(null);
                  setConfirmOpen(true);
                }}
                disabled={testing || Boolean(disconnecting)}
                className="text-stone-500 hover:text-red-600"
              >
                <Unplug />
                Disconnect all
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        {!configured ? (
          <Alert tone="warning" title="LinkedIn credentials are missing">
            Add <code className="font-mono text-[11px]">LINKEDIN_CLIENT_ID</code> and{" "}
            <code className="font-mono text-[11px]">LINKEDIN_CLIENT_SECRET</code> to the server
            environment, then restart the app. See{" "}
            <code className="font-mono text-[11px]">docs/LINKEDIN_SETUP.md</code>.
          </Alert>
        ) : null}

        {accounts.length > 0 ? (
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Connected profiles ({accounts.length})
            </p>
            <div className="divide-y divide-border rounded-lg border border-border bg-white">
              {accounts.map((acc) => {
                const isAccExpired =
                  acc.token_expires_at && Date.parse(acc.token_expires_at) < Date.now();
                const tokenMissing = acc.has_token === false;
                return (
                  <div key={acc.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      {acc.picture ? (
                        <img
                          src={acc.picture}
                          alt=""
                          className="size-10 rounded-full border border-stone-200 object-cover"
                        />
                      ) : (
                        <span className="flex size-10 items-center justify-center rounded-full bg-stone-100 text-[12px] font-medium uppercase text-stone-600 ring-1 ring-stone-200">
                          {acc.name.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">{acc.name}</p>
                        <p className="truncate font-mono text-[10.5px] text-muted-foreground">{acc.member_urn}</p>
                        {acc.token_expires_at ? (
                          <p className="text-[10.5px] text-stone-500">
                            Expires {relativeTime(acc.token_expires_at)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {tokenMissing ? (
                        <>
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-amber-50 text-amber-700 ring-amber-200">
                            <XCircle className="size-3" />
                            Needs Re-auth
                          </span>
                          <a
                            href="/api/linkedin/authorize?prompt=login"
                            className="inline-flex h-7 items-center justify-center gap-1 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700"
                            title="Log into LinkedIn with this profile to connect its publishing token"
                          >
                            <RefreshCw className="size-3" />
                            Reconnect
                          </a>
                        </>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
                            isAccExpired
                              ? "bg-red-50 text-red-700 ring-red-200"
                              : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          }`}
                        >
                          {isAccExpired ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                          {isAccExpired ? "Expired" : "Ready to Publish"}
                        </span>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(disconnecting)}
                        onClick={() => {
                          setConfirmAccountUrn(acc.member_urn);
                          setConfirmOpen(true);
                        }}
                        className="size-8 p-0 text-stone-400 hover:text-red-600"
                        title="Disconnect this account"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : connected ? (
          <>
            <div className="flex items-center gap-3">
              {settings?.linkedin_member_picture ? (
                <img
                  src={settings.linkedin_member_picture}
                  alt=""
                  className="size-11 rounded-full border border-stone-200 object-cover"
                />
              ) : (
                <span className="flex size-11 items-center justify-center rounded-full bg-stone-100 text-[13px] font-medium uppercase text-stone-600 ring-1 ring-stone-200">
                  {(settings?.linkedin_member_name ?? "in").slice(0, 1)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium">
                  {settings?.linkedin_member_name || "Connected member"}
                </p>
                <p className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {settings?.linkedin_member_id
                    ? `urn:li:person:${settings.linkedin_member_id}`
                    : "Member ID unavailable"}
                </p>
              </div>
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
                  tokenExpired
                    ? "bg-red-50 text-red-700 ring-red-200"
                    : "bg-emerald-50 text-emerald-700 ring-emerald-200"
                }`}
              >
                {tokenExpired ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
                {tokenExpired ? "Token expired" : "Connected"}
              </span>
            </div>

            <div className="grid gap-3 text-[11.5px] sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-white px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Token expires
                </p>
                <p className="mt-1 text-stone-700">
                  {settings?.linkedin_token_expires_at
                    ? `${formatIST(settings.linkedin_token_expires_at)} · ${relativeTime(
                        settings.linkedin_token_expires_at,
                      )}`
                    : "Unknown"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-white px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Connected
                </p>
                <p className="mt-1 text-stone-700">
                  {settings?.linkedin_connected_at
                    ? `${formatIST(settings.linkedin_connected_at)} · ${relativeTime(
                        settings.linkedin_connected_at,
                      )}`
                    : "Unknown"}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/40 px-4 py-6 text-center">
            <ShieldCheck className="mx-auto size-5 text-stone-400" />
            <p className="mt-2 text-[12.5px] font-medium">No LinkedIn account connected</p>
            <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
              Connect the profile that should publish. Cadence requests openid, profile and
              w_member_social, plus organization scopes when they are approved for your app. Tokens
              stay in Supabase Vault and are never exposed to the browser.
            </p>
          </div>
        )}

        {connected ? (
          <div>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Granted scopes
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(settings?.linkedin_scopes ?? []).length > 0 ? (
                settings?.linkedin_scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-md border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-stone-600"
                  >
                    {scope}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Scopes were not recorded. Test the connection or reconnect.
                </span>
              )}
            </div>
          </div>
        ) : null}

        {tokenExpired ? (
          <Alert tone="danger" title="The stored token has expired">
            Reconnect to resume publishing. If a refresh token was issued, Cadence refreshes
            automatically before expiry; this message means the refresh did not succeed.
          </Alert>
        ) : tokenExpiringSoon ? (
          <Alert tone="warning" title="Token expires within 7 days">
            Reconnect when convenient to keep unattended publishing uninterrupted.
          </Alert>
        ) : null}

        {settings?.linkedin_last_error ? (
          <Alert tone="danger" title="Last LinkedIn error">
            {settings.linkedin_last_error}
          </Alert>
        ) : null}

        {error ? <Alert tone="danger" title="Connection error">{error}</Alert> : null}
        {result ? <Alert tone="success" title="Verified">{result}</Alert> : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAccountUrn ? "Disconnect account" : "Disconnect all accounts"}
            </DialogTitle>
            <DialogDescription>
              {confirmAccountUrn
                ? "This will remove the stored OAuth credentials for this profile. Scheduled jobs targeting this profile will be paused."
                : "This will remove all stored LinkedIn tokens. Scheduled posts will pause until you connect again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={Boolean(disconnecting)}>
              Keep connected
            </Button>
            <Button
              variant="destructive"
              onClick={() => onDisconnect(confirmAccountUrn)}
              disabled={Boolean(disconnecting)}
            >
              {disconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function TelegramPanel({
  settings,
  botTokenConfigured,
  chatIdConfigured,
}: {
  settings: SettingsRow | null;
  botTokenConfigured: boolean;
  chatIdConfigured: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings?.telegram_enabled ?? true);
  const [chatId, setChatId] = useState(settings?.telegram_chat_id ?? "");
  const [retention, setRetention] = useState(String(settings?.media_retention_hours ?? 48));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);

    const hours = Number(retention);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      setError("Media retention must be a whole number between 1 and 720 hours.");
      setSaving(false);
      return;
    }

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramEnabled: enabled,
          telegramChatId: chatId.trim(),
          mediaRetentionHours: hours,
        }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not save settings."));
      setInfo("Notification and retention settings saved.");
      toast.success("Settings saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/telegram/test", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "Telegram test failed."));
      setInfo("Test message sent. Check your Telegram chat.");
      toast.success("Telegram test sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-stone-50/40 px-5 py-4">
        <p className="text-[13.5px] font-medium">Notifications & retention</p>
        <p className="text-[11px] text-muted-foreground">
          Telegram alerts for publishing outcomes, token problems and media cleanup.
        </p>
      </div>

      <form onSubmit={onSave} className="space-y-5 px-5 py-5">
        {!botTokenConfigured ? (
          <Alert tone="warning" title="Telegram bot token is missing">
            Add <code className="font-mono text-[11px]">TELEGRAM_BOT_TOKEN</code> to the server
            environment to enable notifications and the test button.
          </Alert>
        ) : null}

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-white px-3.5 py-3">
          <div>
            <Label htmlFor="telegram-enabled" className="text-[12.5px]">
              Send Telegram notifications
            </Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Success, failure, manual attention, token expiry and media cleanup.
            </p>
          </div>
          <Switch
            id="telegram-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="telegram-chat" className="text-[12.5px]">
              Telegram chat ID
            </Label>
            <Input
              id="telegram-chat"
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
              placeholder={chatIdConfigured ? "Using environment value" : "e.g. 123456789"}
              inputMode="numeric"
              disabled={saving}
            />
            <p className="text-[10.5px] text-muted-foreground">
              Overrides <code className="font-mono">TELEGRAM_CHAT_ID</code>. Leave blank to use the
              environment value.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="retention" className="text-[12.5px]">
              Media retention (hours)
            </Label>
            <Input
              id="retention"
              type="number"
              min={1}
              max={720}
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
              disabled={saving}
            />
            <p className="text-[10.5px] text-muted-foreground">
              Only published posts are cleaned up. Default is 48 hours.
            </p>
          </div>
        </div>

        {error ? <Alert tone="danger" title="Settings">{error}</Alert> : null}
        {info ? <Alert tone="success" title="Saved">{info}</Alert> : null}

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onTest}
            disabled={testing || saving || !botTokenConfigured}
            type="button"
          >
            {testing ? <Loader2 className="animate-spin" /> : <Send />}
            Send test message
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
  Send,
  ShieldCheck,
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
import type { SettingsRow } from "@/lib/types";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || fallback;
}

export function LinkedInConnectionPanel({
  configured,
  settings,
  tokenExpired,
  tokenExpiringSoon,
}: {
  configured: boolean;
  settings: SettingsRow | null;
  tokenExpired: boolean;
  tokenExpiringSoon: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const connected = Boolean(settings?.linkedin_connected);

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

  async function onDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/linkedin/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "Could not disconnect LinkedIn."));
      toast.success("LinkedIn disconnected.");
      setConfirmOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect LinkedIn.");
    } finally {
      setDisconnecting(false);
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
            <p className="text-[13.5px] font-medium">LinkedIn profile</p>
            <p className="text-[11px] text-muted-foreground">
              Official API · posting as a member
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <>
              <Button variant="secondary" size="sm" onClick={onTest} disabled={testing || disconnecting}>
                {testing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Test connection
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={testing || disconnecting}
              >
                <Unplug />
                Disconnect
              </Button>
            </>
          ) : (
            <a
              href="/api/linkedin/authorize"
              aria-disabled={!configured}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors ${
                configured
                  ? "bg-primary text-primary-foreground hover:bg-blue-800"
                  : "pointer-events-none bg-stone-200 text-stone-500"
              }`}
            >
              <ExternalLink className="size-3.5" />
              Connect LinkedIn
            </a>
          )}
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

        {connected ? (
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
              {settings?.linkedin_scopes && !settings.linkedin_scopes.includes("w_member_social") ? (
                <p className="mt-2 text-[11px] text-red-700">
                  w_member_social is missing. Publishing will fail until you reconnect and approve
                  the posting permission.
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/40 px-4 py-6 text-center">
            <ShieldCheck className="mx-auto size-5 text-stone-400" />
            <p className="mt-2 text-[12.5px] font-medium">No LinkedIn account connected</p>
            <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-muted-foreground">
              Connect the profile that should publish. Cadence only requests openid, profile and
              w_member_social, stores tokens in Supabase Vault and never exposes them to the browser.
            </p>
          </div>
        )}

        {error ? <Alert tone="danger" title="LinkedIn connection">{error}</Alert> : null}
        {result ? <Alert tone="success" title="Connection verified">{result}</Alert> : null}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => (open ? null : setConfirmOpen(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect LinkedIn?</DialogTitle>
            <DialogDescription>
              Cadence will delete the stored OAuth tokens. Scheduled posts remain in the queue but
              cannot publish until you reconnect.
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert tone="danger" title="Could not disconnect">{error}</Alert> : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={disconnecting}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={onDisconnect} disabled={disconnecting}>
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

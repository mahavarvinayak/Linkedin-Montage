const clean = (value: string | undefined) => (value ?? "").trim();

export function getAppUrl(): string {
  return (clean(process.env.NEXT_PUBLIC_APP_URL) || "http://localhost:3000").replace(/\/+$/, "");
}

export function getSupabaseEnv() {
  return {
    url: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    serviceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url && anonKey && url.startsWith("http"));
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(getSupabaseEnv().serviceRoleKey);
}

export function getLinkedInEnv() {
  const scopes = clean(process.env.LINKEDIN_SCOPES) || "openid profile w_member_social";
  return {
    clientId: clean(process.env.LINKEDIN_CLIENT_ID),
    clientSecret: clean(process.env.LINKEDIN_CLIENT_SECRET),
    redirectUri:
      clean(process.env.LINKEDIN_REDIRECT_URI) || `${getAppUrl()}/api/linkedin/callback`,
    scopes: scopes.split(/[\s,]+/).filter(Boolean),
    version: clean(process.env.LINKEDIN_VERSION) || "202610",
  };
}

export function isLinkedInConfigured(): boolean {
  const { clientId, clientSecret } = getLinkedInEnv();
  return Boolean(clientId && clientSecret);
}

export function getTelegramEnv() {
  return {
    botToken: clean(process.env.TELEGRAM_BOT_TOKEN),
    chatId: clean(process.env.TELEGRAM_CHAT_ID),
    enabled: clean(process.env.TELEGRAM_NOTIFICATIONS_ENABLED) !== "false",
  };
}

export function getAdminEmail(): string {
  return clean(process.env.ADMIN_EMAIL).toLowerCase();
}

export function getMediaRetentionHours(): number {
  const parsed = Number(process.env.MEDIA_RETENTION_HOURS);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 720 ? Math.round(parsed) : 48;
}

/**
 * Safe to render on the Settings page: booleans and public URLs only. Secret
 * values are never returned.
 */
export function getEnvironmentStatus() {
  const linkedin = getLinkedInEnv();
  const telegram = getTelegramEnv();
  const supabase = getSupabaseEnv();

  return {
    appUrl: getAppUrl(),
    supabase: {
      urlConfigured: Boolean(supabase.url),
      anonKeyConfigured: Boolean(supabase.anonKey),
      serviceRoleConfigured: Boolean(supabase.serviceRoleKey),
      configured: isSupabaseConfigured(),
    },
    auth: {
      adminEmailConfigured: Boolean(getAdminEmail()),
    },
    linkedin: {
      configured: isLinkedInConfigured(),
      clientIdConfigured: Boolean(linkedin.clientId),
      clientSecretConfigured: Boolean(linkedin.clientSecret),
      redirectUri: linkedin.redirectUri,
      scopes: linkedin.scopes,
      version: linkedin.version,
    },
    telegram: {
      configured: Boolean(telegram.botToken && telegram.chatId),
      botTokenConfigured: Boolean(telegram.botToken),
      chatIdConfigured: Boolean(telegram.chatId),
      enabled: telegram.enabled,
    },
    mediaRetentionHours: getMediaRetentionHours(),
  };
}

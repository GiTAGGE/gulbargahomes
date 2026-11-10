/** GulbargaHomes CRM app on developers.facebook.com. Override with META_APP_ID. */
export const DEFAULT_META_APP_ID = "2327104601371140";
export const DEFAULT_GRAPH_VERSION = "v27.0";
export const OAUTH_STATE_COOKIE = "gh_meta_oauth_state";

/**
 * Asked for at connection time. pages_manage_metadata subscribes the Page to
 * leadgen webhooks; pages_manage_ads lists Instant Forms; ads_read adds
 * campaign, ad set and ad names; business_management is needed when the Page
 * belongs to a Business portfolio.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_ads",
  "leads_retrieval",
  "ads_read",
  "business_management",
] as const;

export const REQUIRED_SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval"] as const;

export type MetaConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  tokenKey: string;
  graphVersion: string;
  graphBaseUrl: string;
  dialogBaseUrl: string;
  redirectUri: string;
};

export type MetaEnv = Record<string, string | undefined>;

export const SECRET_NAMES = ["META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "META_TOKEN_KEY"] as const;

/** Graph and dialog hosts can only be pointed elsewhere for local development against a mock. */
function devOverride(env: MetaEnv, name: string, fallback: string): string {
  const value = env[name]?.trim();
  if (!value || env.NODE_ENV !== "development") return fallback;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(value) ? value.replace(/\/$/, "") : fallback;
}

export function readMetaConfig(env: MetaEnv = process.env, origin = ""): { config: MetaConfig; missing: string[] } {
  const graphVersion = /^v\d+\.\d+$/.test(env.META_GRAPH_VERSION ?? "") ? env.META_GRAPH_VERSION! : DEFAULT_GRAPH_VERSION;
  const config: MetaConfig = {
    appId: env.META_APP_ID?.trim() || DEFAULT_META_APP_ID,
    appSecret: env.META_APP_SECRET?.trim() ?? "",
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN?.trim() ?? "",
    tokenKey: env.META_TOKEN_KEY?.trim() ?? "",
    graphVersion,
    graphBaseUrl: `${devOverride(env, "META_GRAPH_BASE_URL", "https://graph.facebook.com")}/${graphVersion}`,
    dialogBaseUrl: `${devOverride(env, "META_DIALOG_BASE_URL", "https://www.facebook.com")}/${graphVersion}`,
    redirectUri:
      env.META_OAUTH_REDIRECT_URI?.trim() || (origin ? `${origin}/api/admin/integrations/meta/callback` : ""),
  };
  const missing = SECRET_NAMES.filter((name) => !env[name]?.trim());
  if (config.tokenKey && config.tokenKey.length < 32 && !missing.includes("META_TOKEN_KEY")) missing.push("META_TOKEN_KEY");
  return { config, missing };
}

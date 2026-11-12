/** GulbargaHomes CRM app on developers.facebook.com. Override with META_APP_ID. */
export const DEFAULT_META_APP_ID = "2327104601371140";
export const DEFAULT_GRAPH_VERSION = "v27.0";
export const OAUTH_STATE_COOKIE = "gh_meta_oauth_state";

/**
 * What lead ingestion needs, per Meta's endpoint references and Lead Ads guides:
 * - pages_show_list: /me/accounts (choose the Page, get its token)
 * - pages_manage_metadata: POST/GET /{page-id}/subscribed_apps (leadgen webhook)
 * - pages_read_engagement, pages_manage_ads, leads_retrieval: read
 *   /{page-id}/leadgen_forms, /{form-id}/leads and /{lead-id} with field_data
 * ads_management is not requested: the integration never creates or edits ads.
 */
export const REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_ads",
  "leads_retrieval",
] as const;

/** Asked for only when the super admin ticks them on Connect. Ingestion works without either. */
export const OPTIONAL_SCOPES = {
  ads_read: "Read campaign names and import campaign spend. Ids are stored either way. This is not ads_management.",
  business_management: "Only if the Page is reachable solely through a Business portfolio and does not appear otherwise",
} as const;
export type OptionalScope = keyof typeof OPTIONAL_SCOPES;

export function isOptionalScope(value: string): value is OptionalScope {
  return Object.prototype.hasOwnProperty.call(OPTIONAL_SCOPES, value);
}

export function requestedScopes(optional: readonly string[] = []): string[] {
  return [...REQUIRED_SCOPES, ...optional.filter(isOptionalScope)];
}

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
const APP_SECRET_FORMAT = /^[0-9a-f]{32}$/i;

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
  // Meta App Secrets are always 32 hex characters; anything else is a pasted App ID, token or typo.
  if (config.appSecret && !APP_SECRET_FORMAT.test(config.appSecret)) missing.push("META_APP_SECRET");
  return { config, missing };
}

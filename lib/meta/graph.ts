import type { MetaConfig } from "./config";
import { appSecretProof } from "./crypto";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * auth: the token is invalid or expired; reconnect.
 * permission: the token lacks a scope or Page task; reconnect with the right access.
 * rate_limit: back off and retry later.
 * transient: Meta or the network failed; retry.
 * permanent: retrying will not help (bad id, lead deleted or older than 90 days).
 */
export type MetaErrorKind = "auth" | "permission" | "rate_limit" | "transient" | "permanent";

/** Meta echoes malformed tokens back in error messages, and those messages are stored and shown. */
export function redactTokens(message: string): string {
  return message
    .replace(/\bEAA[A-Za-z0-9_\-.|]{8,}/g, "[token]")
    .replace(/(access[ _]?token[\s:="']+)[A-Za-z0-9_\-.|]{24,}/gi, "$1[token]");
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public kind: MetaErrorKind,
    public status: number,
    public code: number | null = null,
    public subcode: number | null = null,
    public retryAfterSeconds: number | null = null,
  ) {
    super(redactTokens(message));
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const AUTH_CODES = new Set([102, 190]);

/** Seconds until Meta says usage recovers, from X-Business-Use-Case-Usage or X-App-Usage. */
function retryAfterFromHeaders(headers: Headers): number | null {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  const usage = headers.get("x-business-use-case-usage");
  if (!usage) return null;
  try {
    const parsed = JSON.parse(usage) as Record<string, { estimated_time_to_regain_access?: number }[]>;
    const minutes = Math.max(
      0,
      ...Object.values(parsed).flatMap((entries) => entries.map((entry) => entry.estimated_time_to_regain_access ?? 0)),
    );
    return minutes > 0 ? minutes * 60 : null;
  } catch {
    return null;
  }
}

export function classifyMetaError(
  status: number,
  body: unknown,
  headers: Headers = new Headers(),
): MetaApiError {
  const error =
    body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object"
      ? (body.error as { message?: string; code?: number; error_subcode?: number; is_transient?: boolean; type?: string })
      : {};
  const code = typeof error.code === "number" ? error.code : null;
  const subcode = typeof error.error_subcode === "number" ? error.error_subcode : null;
  const message = (error.message || `Meta returned HTTP ${status}`).slice(0, 300);
  const retryAfter = retryAfterFromHeaders(headers);

  let kind: MetaErrorKind;
  if (status === 429 || (code !== null && RATE_LIMIT_CODES.has(code))) kind = "rate_limit";
  else if ((code !== null && AUTH_CODES.has(code)) || error.type === "OAuthException" && status === 401) kind = "auth";
  else if (code === 10 || (code !== null && code >= 200 && code < 300)) kind = "permission";
  else if (error.is_transient || code === 1 || code === 2 || status >= 500) kind = "transient";
  else kind = "permanent";
  return new MetaApiError(message, kind, status, code, subcode, retryAfter);
}

export type MetaPage = { id: string; name: string; accessToken: string; tasks: string[] };

export type MetaQuestion = {
  key: string;
  label: string;
  type: string;
  options: { key: string; value: string }[];
};

export type MetaForm = {
  id: string;
  name: string;
  status: string;
  locale: string;
  createdTime: string | null;
  leadsCount: number | null;
  questions: MetaQuestion[];
};

export type MetaLead = {
  id: string;
  createdTime: string;
  formId: string;
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  platform: string;
  isOrganic: boolean | null;
  fieldData: { name: string; values: string[] }[];
};

export type TokenInfo = {
  isValid: boolean;
  type: string;
  expiresAt: string | null;
  dataAccessExpiresAt: string | null;
  scopes: string[];
  profileId: string;
};

const LEAD_BASE_FIELDS = "id,created_time,form_id,platform,is_organic,field_data";
const LEAD_AD_ID_FIELDS = "ad_id,adset_id,campaign_id";
const LEAD_AD_NAME_FIELDS = "ad_name,adset_name,campaign_name";

export type LeadFieldOptions = {
  /** Ask for campaign, ad set and ad names. Only useful when ads_read was granted. */
  adNames?: boolean;
};

function leadFields(options: LeadFieldOptions, withAdFields: boolean): string {
  if (!withAdFields) return LEAD_BASE_FIELDS;
  return [LEAD_BASE_FIELDS, LEAD_AD_ID_FIELDS, ...(options.adNames ? [LEAD_AD_NAME_FIELDS] : [])].join(",");
}

/** Ad-level lead fields need advertiser access on the ad account; the answers do not. */
function adFieldsRefused(error: unknown): boolean {
  return error instanceof MetaApiError && (error.kind === "permission" || (error.kind === "permanent" && error.code === 100));
}
const FORM_FIELDS = "id,name,status,locale,created_time,leads_count,questions{key,label,type,options}";

function epochToIso(value: unknown): string | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function isoTime(value: unknown): string {
  if (typeof value !== "string") return new Date().toISOString();
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function toMetaLead(raw: Record<string, unknown>): MetaLead {
  const fieldData = Array.isArray(raw.field_data) ? raw.field_data : [];
  return {
    id: String(raw.id ?? ""),
    createdTime: isoTime(raw.created_time),
    formId: String(raw.form_id ?? ""),
    adId: String(raw.ad_id ?? ""),
    adName: String(raw.ad_name ?? ""),
    adsetId: String(raw.adset_id ?? ""),
    adsetName: String(raw.adset_name ?? ""),
    campaignId: String(raw.campaign_id ?? ""),
    campaignName: String(raw.campaign_name ?? ""),
    platform: String(raw.platform ?? ""),
    isOrganic: typeof raw.is_organic === "boolean" ? raw.is_organic : null,
    fieldData: fieldData
      .filter((item): item is { name: unknown; values: unknown } => Boolean(item) && typeof item === "object")
      .map((item) => ({
        name: String(item.name ?? ""),
        values: Array.isArray(item.values) ? item.values.map((value) => String(value)) : [],
      }))
      .filter((item) => item.name),
  };
}

/** Queue payloads are stored MetaLead objects; older or raw Graph shapes are accepted too. */
export function parseStoredLead(json: string): MetaLead | null {
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (Array.isArray(raw.fieldData)) {
    return toMetaLead({
      id: raw.id,
      created_time: raw.createdTime,
      form_id: raw.formId,
      ad_id: raw.adId,
      ad_name: raw.adName,
      adset_id: raw.adsetId,
      adset_name: raw.adsetName,
      campaign_id: raw.campaignId,
      campaign_name: raw.campaignName,
      platform: raw.platform,
      is_organic: raw.isOrganic,
      field_data: raw.fieldData,
    });
  }
  return toMetaLead(raw);
}

function toForm(raw: Record<string, unknown>): MetaForm {
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    status: String(raw.status ?? ""),
    locale: String(raw.locale ?? ""),
    createdTime: typeof raw.created_time === "string" ? isoTime(raw.created_time) : null,
    leadsCount: typeof raw.leads_count === "number" ? raw.leads_count : null,
    questions: questions
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        key: String(item.key ?? ""),
        label: String(item.label ?? item.key ?? ""),
        type: String(item.type ?? "CUSTOM"),
        options: (Array.isArray(item.options) ? item.options : [])
          .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object")
          .map((option) => ({ key: String(option.key ?? ""), value: String(option.value ?? "") })),
      }))
      .filter((item) => item.key),
  };
}

export type MetaAdAccount = { id: string; name: string; currency: string; accountStatus: number | null };
export type MetaAdCampaign = { id: string; name: string; effectiveStatus: string };
export type MetaInsightRow = {
  campaignId: string;
  campaignName: string;
  spend: string;
  impressions: number | null;
  clicks: number | null;
  currency: string;
  date: string;
};

export function normalizeAdAccountId(id: string): string {
  if (/^act_\d{3,32}$/.test(id)) return id;
  if (/^\d{3,32}$/.test(id)) return `act_${id}`;
  return "";
}

function countOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export type GraphClient = ReturnType<typeof createGraphClient>;

export function createGraphClient(config: MetaConfig, fetchImpl: FetchLike = fetch) {
  async function request<T>(
    path: string,
    options: {
      token?: string;
      method?: string;
      query?: Record<string, string>;
      /** Sent as a form body (POST) so secrets stay out of the URL. */
      form?: Record<string, string>;
      proof?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(path.startsWith("http") ? path : `${config.graphBaseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    if (options.token && options.proof !== false && config.appSecret) {
      url.searchParams.set("appsecret_proof", await appSecretProof(config.appSecret, options.token));
    }
    const headers: Record<string, string> = options.token ? { authorization: `Bearer ${options.token}` } : {};
    if (options.form) headers["content-type"] = "application/x-www-form-urlencoded";
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: options.method ?? (options.form ? "POST" : "GET"),
        headers,
        ...(options.form ? { body: new URLSearchParams(options.form).toString() } : {}),
      });
    } catch {
      throw new MetaApiError("Could not reach Meta.", "transient", 0);
    }
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || (body && typeof body === "object" && "error" in body)) {
      throw classifyMetaError(response.status, body, response.headers);
    }
    return body as T;
  }

  /**
   * Follow every cursor. A missing cursor, a repeated cursor, or a page cap
   * throws, so the caller cannot treat a partial list as finished.
   */
  async function pagedComplete<T>(path: string, token: string, query: Record<string, string>, maxPages = 200): Promise<T[]> {
    const items: T[] = [];
    let after = "";
    for (let page = 0; page < maxPages; page += 1) {
      const body = await request<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
        token,
        query: { ...query, limit: query.limit ?? "100", ...(after ? { after } : {}) },
      });
      items.push(...(body.data ?? []));
      if (!body.paging?.next) return items;
      const cursor = body.paging.cursors?.after ?? "";
      if (!cursor || cursor === after) {
        throw new MetaApiError("Meta did not finish this list.", "permanent", 502);
      }
      after = cursor;
    }
    throw new MetaApiError("Meta did not finish this list.", "permanent", 502);
  }

  async function paged<T>(path: string, token: string, query: Record<string, string>, max = 500): Promise<T[]> {
    const items: T[] = [];
    let after = "";
    while (items.length < max) {
      const page = await request<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, {
        token,
        query: { ...query, ...(after ? { after } : {}) },
      });
      items.push(...(page.data ?? []));
      after = page.paging?.next ? (page.paging.cursors?.after ?? "") : "";
      if (!after) break;
    }
    return items;
  }

  const appToken = () => `${config.appId}|${config.appSecret}`;

  return {
    /** OAuth code → short-lived user token → long-lived (about 60 days) user token. */
    async exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: string | null }> {
      const short = await request<{ access_token: string }>("/oauth/access_token", {
        form: {
          client_id: config.appId,
          client_secret: config.appSecret,
          redirect_uri: config.redirectUri,
          code,
        },
      });
      const long = await request<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
        form: {
          grant_type: "fb_exchange_token",
          client_id: config.appId,
          client_secret: config.appSecret,
          fb_exchange_token: short.access_token,
        },
      });
      return {
        accessToken: long.access_token,
        expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
      };
    },

    async debugToken(token: string): Promise<TokenInfo> {
      const result = await request<{ data?: Record<string, unknown> }>("/debug_token", {
        token: appToken(),
        proof: false,
        query: { input_token: token },
      });
      const data = result.data ?? {};
      return {
        isValid: data.is_valid === true,
        type: String(data.type ?? ""),
        expiresAt: epochToIso(data.expires_at),
        dataAccessExpiresAt: epochToIso(data.data_access_expires_at),
        scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
        profileId: String(data.profile_id ?? ""),
      };
    },

    async me(userToken: string): Promise<{ id: string; name: string }> {
      return request("/me", { token: userToken, query: { fields: "id,name" } });
    },

    async listPages(userToken: string): Promise<MetaPage[]> {
      const pages = await paged<{ id: string; name: string; access_token?: string; tasks?: string[] }>(
        "/me/accounts",
        userToken,
        { fields: "id,name,access_token,tasks", limit: "100" },
      );
      return pages
        .filter((page) => page.access_token)
        .map((page) => ({ id: page.id, name: page.name, accessToken: page.access_token!, tasks: page.tasks ?? [] }));
    },

    async page(pageId: string, pageToken: string): Promise<{ id: string; name: string }> {
      return request(`/${encodeURIComponent(pageId)}`, { token: pageToken, query: { fields: "id,name" } });
    },

    async subscribeLeadgen(pageId: string, pageToken: string): Promise<void> {
      await request(`/${encodeURIComponent(pageId)}/subscribed_apps`, {
        token: pageToken,
        method: "POST",
        query: { subscribed_fields: "leadgen" },
      });
    },

    async isLeadgenSubscribed(pageId: string, pageToken: string): Promise<boolean> {
      const result = await request<{ data?: { id?: string; subscribed_fields?: string[] }[] }>(
        `/${encodeURIComponent(pageId)}/subscribed_apps`,
        { token: pageToken },
      );
      return (result.data ?? []).some(
        (app) => app.id === config.appId && (app.subscribed_fields ?? []).includes("leadgen"),
      );
    },

    async unsubscribe(pageId: string, pageToken: string): Promise<void> {
      await request(`/${encodeURIComponent(pageId)}/subscribed_apps`, { token: pageToken, method: "DELETE" });
    },

    async listForms(pageId: string, pageToken: string): Promise<MetaForm[]> {
      const forms = await paged<Record<string, unknown>>(`/${encodeURIComponent(pageId)}/leadgen_forms`, pageToken, {
        fields: FORM_FIELDS,
        limit: "50",
      });
      return forms.map(toForm);
    },

    async getForm(formId: string, pageToken: string): Promise<MetaForm & { pageId: string }> {
      const raw = await request<Record<string, unknown>>(`/${encodeURIComponent(formId)}`, {
        token: pageToken,
        query: { fields: `${FORM_FIELDS},page{id}` },
      });
      const page = raw.page && typeof raw.page === "object" ? (raw.page as { id?: string }) : {};
      return { ...toForm(raw), pageId: String(page.id ?? "") };
    },

    /**
     * Read one campaign, ad set or ad by the id already stored on a lead.
     * `fields=id,name` is a Marketing API read. It does not ask for spend.
     */
    async readMarketingObject(id: string, token: string): Promise<{ id: string; name: string }> {
      const raw = await request<{ id?: string; name?: string }>(`/${encodeURIComponent(id)}`, {
        token,
        query: { fields: "id,name" },
      });
      return { id: String(raw.id ?? id), name: String(raw.name ?? "").trim().slice(0, 200) };
    },

    /** Ad accounts the user token can read. This does not use the Page token. */
    async listAdAccounts(userToken: string): Promise<MetaAdAccount[]> {
      const rows = await pagedComplete<{ id?: string; name?: string; currency?: string; account_status?: number }>(
        "/me/adaccounts",
        userToken,
        { fields: "id,name,currency,account_status", limit: "100" },
      );
      return rows
        .map((row) => ({
          id: normalizeAdAccountId(String(row.id ?? "")),
          name: String(row.name ?? "").trim().slice(0, 200),
          currency: String(row.currency ?? "").trim().toUpperCase(),
          accountStatus: typeof row.account_status === "number" ? row.account_status : null,
        }))
        .filter((row) => row.id);
    },

    /** Active, paused, archived and every other status except the caller filters deleted. */
    async listAdCampaigns(accountId: string, userToken: string): Promise<MetaAdCampaign[]> {
      const rows = await pagedComplete<{ id?: string; name?: string; effective_status?: string }>(
        `/${encodeURIComponent(accountId)}/campaigns`,
        userToken,
        { fields: "id,name,effective_status", limit: "100" },
      );
      return rows
        .map((row) => ({
          id: String(row.id ?? ""),
          name: String(row.name ?? "").trim().slice(0, 200),
          effectiveStatus: String(row.effective_status ?? "").trim().toUpperCase(),
        }))
        .filter((row) => /^\d{3,32}$/.test(row.id));
    },

    /**
     * Daily campaign spend from Insights. `spend` is the delivered amount, not a budget.
     * Throws if any page is missing, so the caller must not invent zeros.
     */
    async campaignInsights(accountId: string, userToken: string, since: string, until: string): Promise<MetaInsightRow[]> {
      const rows = await pagedComplete<{
        campaign_id?: string;
        campaign_name?: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        account_currency?: string;
        date_start?: string;
      }>(`/${encodeURIComponent(accountId)}/insights`, userToken, {
        level: "campaign",
        time_increment: "1",
        fields: "campaign_id,campaign_name,spend,impressions,clicks,account_currency,date_start",
        time_range: JSON.stringify({ since, until }),
        limit: "100",
      });
      return rows.map((row) => ({
        campaignId: String(row.campaign_id ?? ""),
        campaignName: String(row.campaign_name ?? "").trim().slice(0, 200),
        spend: String(row.spend ?? ""),
        impressions: countOrNull(row.impressions),
        clicks: countOrNull(row.clicks),
        currency: String(row.account_currency ?? "").trim().toUpperCase(),
        date: String(row.date_start ?? ""),
      }));
    },

    async getLead(leadgenId: string, pageToken: string, options: LeadFieldOptions = {}): Promise<MetaLead> {
      const fetchLead = (withAdFields: boolean) =>
        request<Record<string, unknown>>(`/${encodeURIComponent(leadgenId)}`, {
          token: pageToken,
          query: { fields: leadFields(options, withAdFields) },
        });
      try {
        return toMetaLead(await fetchLead(true));
      } catch (error) {
        if (!adFieldsRefused(error)) throw error;
        return toMetaLead(await fetchLead(false));
      }
    },

    /** One page of a form's leads created inside [since, until). */
    async listFormLeads(
      formId: string,
      pageToken: string,
      options: { since: string; until: string; after?: string | null; limit?: number } & LeadFieldOptions,
    ): Promise<{ leads: MetaLead[]; after: string | null }> {
      const filtering = [
        { field: "time_created", operator: "GREATER_THAN", value: Math.floor(Date.parse(options.since) / 1000) - 1 },
        { field: "time_created", operator: "LESS_THAN", value: Math.floor(Date.parse(options.until) / 1000) },
      ];
      type LeadPage = { data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string }; next?: string } };
      const fetchPage = (withAdFields: boolean) =>
        request<LeadPage>(`/${encodeURIComponent(formId)}/leads`, {
          token: pageToken,
          query: {
            fields: leadFields(options, withAdFields),
            limit: String(options.limit ?? 50),
            filtering: JSON.stringify(filtering),
            ...(options.after ? { after: options.after } : {}),
          },
        });
      let page: LeadPage;
      try {
        page = await fetchPage(true);
      } catch (error) {
        if (!adFieldsRefused(error)) throw error;
        page = await fetchPage(false);
      }
      return {
        leads: (page.data ?? []).map((lead) => toMetaLead({ form_id: formId, ...lead })),
        after: page.paging?.next ? (page.paging.cursors?.after ?? null) : null,
      };
    },

    oauthDialogUrl(state: string, scopes: readonly string[]): string {
      const url = new URL(`${config.dialogBaseUrl}/dialog/oauth`);
      url.searchParams.set("client_id", config.appId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scopes.join(","));
      return url.toString();
    },
  };
}

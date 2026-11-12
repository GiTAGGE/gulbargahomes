import type { MetaQuestion } from "../../lib/meta/graph";

export const PAGE_ID = "1122334455";
export const PAGE_TOKEN = "EAAG-page-token-secret";
export const USER_TOKEN = "EAAG-user-token-secret";

export type FakeLead = {
  id: string;
  form_id: string;
  created_time: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
  field_data: { name: string; values: string[] }[];
};

export type FakeForm = { id: string; name: string; questions: MetaQuestion[] };

/** An in-memory Graph API. `mode` simulates outages, expired tokens and rate limits. */
export class FakeMeta {
  forms: FakeForm[] = [];
  leads: FakeLead[] = [];
  subscribed = false;
  mode: "ok" | "down" | "expired" | "rate_limited" = "ok";
  calls: string[] = [];
  /** Full request URLs and bodies, to check that secrets never travel in a URL. */
  requests: { method: string; url: string; body: string; authorization: string }[] = [];
  scopes = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval", "ads_read"];
  /** Simulates a token without advertiser access: ad-level lead fields are refused. */
  refuseAdFields = false;
  /** Campaign, ad set and ad nodes returned by a Marketing API name read. */
  objects: { id: string; name: string }[] = [];
  /** `GET /{id}?fields=id,name` is refused. Lead field reads are unchanged. */
  refuseMarketingRead = false;
  /** Marketing API calls that present the user token are rejected. Page-token calls still succeed. */
  invalidUserToken = false;
  /** These ids answer with a rate limit during a name sync. */
  rateLimitIds = new Set<string>();
  /** Forms Meta knows about that belong to a different Page. */
  foreignForms: FakeForm[] = [];

  fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, "");
    const method = (init.method ?? "GET").toUpperCase();
    this.calls.push(`${method} ${path}`);
    const body = typeof init.body === "string" ? init.body : "";
    const auth = new Headers(init.headers).get("authorization") ?? "";
    this.requests.push({ method, url: input, body, authorization: auth });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (this.mode === "down") return json({ error: { message: "Service temporarily unavailable", code: 2, is_transient: true } }, 503);
    if (this.mode === "rate_limited") return json({ error: { message: "Application request limit reached", code: 4 } }, 400);
    if (path === "/debug_token") {
      const token = url.searchParams.get("input_token");
      const valid = this.mode !== "expired" && (token === PAGE_TOKEN || token === USER_TOKEN);
      return json({ data: { is_valid: valid, type: token === PAGE_TOKEN ? "PAGE" : "USER", expires_at: 0, data_access_expires_at: 1798761600, scopes: this.scopes } });
    }
    if (this.mode === "expired") {
      return json({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190, error_subcode: 463 } }, 401);
    }
    if (this.invalidUserToken && auth.endsWith(USER_TOKEN)) {
      return json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } }, 401);
    }
    if (auth && !auth.endsWith(PAGE_TOKEN) && !auth.endsWith(USER_TOKEN)) {
      return json({ error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } }, 401);
    }
    if (path === "/oauth/access_token") {
      const form = new URLSearchParams(body);
      if (method !== "POST" || !form.get("client_secret")) {
        return json({ error: { message: "Missing client_secret", type: "OAuthException", code: 1 } }, 400);
      }
      return json({ access_token: USER_TOKEN, expires_in: 5_184_000 });
    }
    if (path === "/me") return json({ id: "777", name: "Gulbarga Support" });
    if (path === "/me/accounts") {
      return json({ data: [{ id: PAGE_ID, name: "GulbargaHomes", access_token: PAGE_TOKEN, tasks: ["ADVERTISE", "MANAGE"] }] });
    }
    if (path === `/${PAGE_ID}`) return json({ id: PAGE_ID, name: "GulbargaHomes" });
    if (path === `/${PAGE_ID}/subscribed_apps`) {
      if (method === "POST") this.subscribed = true;
      if (method === "DELETE") this.subscribed = false;
      if (method !== "GET") return json({ success: true });
      return json({ data: this.subscribed ? [{ id: "2327104601371140", name: "GulbargaHomes CRM", subscribed_fields: ["leadgen"] }] : [] });
    }
    if (path === `/${PAGE_ID}/leadgen_forms`) {
      return json({ data: this.forms.map((form) => ({ ...form, status: "ACTIVE", locale: "en_US", leads_count: 0 })) });
    }
    const fields = (url.searchParams.get("fields") ?? "").split(",");
    const askedForAdFields = fields.some((field) => /^(ad|adset|campaign)_(id|name)$/.test(field));
    if (this.refuseAdFields && askedForAdFields) {
      return json({ error: { message: "(#200) Requires ads_management permission to access ad fields", code: 200 } }, 403);
    }
    const pick = (lead: FakeLead) =>
      Object.fromEntries(Object.entries(lead).filter(([key]) => key === "id" || key === "form_id" || fields.includes(key)));
    const leadsMatch = path.match(/^\/(\d+)\/leads$/);
    if (leadsMatch) {
      const filtering = JSON.parse(url.searchParams.get("filtering") ?? "[]") as { operator: string; value: number }[];
      const after = Number(url.searchParams.get("after") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const matching = this.leads.filter((lead) => {
        if (lead.form_id !== leadsMatch[1]) return false;
        const time = Date.parse(lead.created_time) / 1000;
        return filtering.every((rule) => (rule.operator === "GREATER_THAN" ? time > rule.value : time < rule.value));
      });
      const page = matching.slice(after, after + limit);
      const next = after + limit < matching.length;
      return json({ data: page.map(pick), paging: { cursors: { after: String(after + limit) }, ...(next ? { next: "https://graph/next" } : {}) } });
    }
    const id = path.slice(1);
    if (this.rateLimitIds.has(id)) {
      return json({ error: { message: "Application request limit reached", code: 4 } }, 400);
    }
    const named = this.objects.find((item) => item.id === id);
    const nameOnly = fields.length > 0 && fields.every((field) => field === "id" || field === "name");
    if (named && nameOnly) {
      if (this.refuseMarketingRead) {
        return json({ error: { message: "(#200) Requires ads_read permission to access this object", code: 200 } }, 403);
      }
      return json({ id: named.id, name: named.name });
    }
    const lead = this.leads.find((item) => item.id === id);
    if (lead) return json(pick(lead));
    const form = this.forms.find((item) => item.id === id);
    if (form) return json({ ...form, status: "ACTIVE", locale: "en_US", page: { id: PAGE_ID } });
    const foreign = this.foreignForms.find((item) => item.id === id);
    if (foreign) return json({ ...foreign, status: "ACTIVE", locale: "en_US", page: { id: "9999999999" } });
    return json({ error: { message: `Unsupported get request. Object with ID '${id}' does not exist`, code: 100, error_subcode: 33 } }, 400);
  };
}

export const OWNER_FORM: FakeForm = {
  id: "900000000000001",
  name: "Owner property enquiry",
  questions: [
    { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
    { key: "phone_number", label: "Phone number", type: "PHONE", options: [] },
    { key: "do_you_want_to_rent_or_sell?", label: "Do you want to rent or sell?", type: "CUSTOM", options: [] },
    { key: "property_type", label: "Property type", type: "CUSTOM", options: [] },
    { key: "location_of_property", label: "Location of property", type: "CUSTOM", options: [] },
    { key: "expected_rent_or_price", label: "Expected rent or price", type: "CUSTOM", options: [] },
  ],
};

export const TENANT_FORM: FakeForm = {
  id: "900000000000002",
  name: "Tenant requirement",
  questions: [
    { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
    { key: "phone_number", label: "Phone number", type: "PHONE", options: [] },
    { key: "email", label: "Email", type: "EMAIL", options: [] },
    { key: "bhk_needed", label: "BHK needed", type: "CUSTOM", options: [] },
    { key: "monthly_budget", label: "Monthly budget", type: "CUSTOM", options: [] },
    { key: "preferred_location", label: "Preferred location", type: "CUSTOM", options: [] },
    { key: "when_do_you_want_to_move?", label: "When do you want to move?", type: "CUSTOM", options: [] },
    { key: "any_other_preferences", label: "Any other preferences", type: "CUSTOM", options: [] },
  ],
};

export const BUYER_FORM: FakeForm = {
  id: "900000000000003",
  name: "Buyer requirement",
  questions: [
    { key: "full_name", label: "Full name", type: "FULL_NAME", options: [] },
    { key: "phone_number", label: "Phone number", type: "PHONE", options: [] },
    { key: "type_of_property", label: "Type of property", type: "CUSTOM", options: [] },
    { key: "budget", label: "Budget", type: "CUSTOM", options: [] },
    { key: "preferred_area", label: "Preferred area", type: "CUSTOM", options: [] },
    { key: "timeline", label: "Timeline", type: "CUSTOM", options: [] },
  ],
};

let sequence = 0;
export function leadId(): string {
  sequence += 1;
  return String(4_000_000_000_000_000 + sequence);
}

export function attribution(campaign = "1") {
  return {
    ad_id: `60${campaign}`,
    ad_name: `Ad ${campaign}`,
    adset_id: `50${campaign}`,
    adset_name: `Ad set ${campaign}`,
    campaign_id: `40${campaign}`,
    campaign_name: `Campaign ${campaign}`,
    platform: "fb",
    is_organic: false,
  };
}

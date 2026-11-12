# Meta Lead Ads integration (Phase 1 extension)

Owner, tenant and buyer campaigns all run from one Facebook Page. Each Instant
Form submission becomes an owner lead or a demand requirement in the existing
CRM, with its contact deduplicated by mobile number. Nothing here creates a
property, qualifies a lead or logs anyone in. Owners and customers still never
sign in.

Admin screen: **Integrations → Meta Lead Ads** (`/admin/integrations/meta`).

## How a lead flows

```
Meta ──leadgen webhook──▶ /api/webhooks/meta-leads ──▶ meta_lead_ingestions (queue, unique leadgen_id)
                                                       │
Historical import ──page of leads──────────────────────┤
Reconciliation (last 48 h, every 6 h) ─────────────────┤
                                                       ▼
                                  processIngestion (one pipeline for every origin)
                                  fetch lead (Graph) → find form → mapLead
                                  → createOwnerLead / createRequirement (Phase 1 code)
                                  → lead_sources attribution + raw answers
                                  → ad_entities → matching hook (Phase 2)
```

- **Fast acknowledgement.** The webhook checks `X-Hub-Signature-256` (HMAC-SHA256
  of the raw body with the app secret, constant-time compare), writes one queue
  row per `leadgen_id`, answers `200 EVENT_RECEIVED`, and processes after the
  response with `waitUntil`. If the database write fails it answers 500 so Meta
  redelivers.
- **Idempotency.** `meta_lead_ingestions.leadgen_id` and
  `lead_sources.meta_lead_id` are both unique. A redelivered webhook, an import
  that overlaps the webhook, or a lead already typed in by hand with the same
  Meta lead id is counted as a duplicate and never creates a second lead or
  contact. Two workers cannot claim the same row: claiming is a conditional
  `UPDATE … RETURNING` with a five-minute lock.
- **Retries.** Transient failures (Meta down, 5xx) back off for 1, 5, 15, 60, 180,
  720 and 1440 minutes. After eight attempts the row is `failed`. Rate limits
  wait at least 15 minutes, or longer if `X-Business-Use-Case-Usage` says so, and
  stop the batch. An expired or revoked token marks the connection `expired`.
  The lead then waits as `waiting_token` until someone reconnects or a test
  connection passes, and nothing is lost.
- **Cron.** `worker.ts` wraps the OpenNext worker and adds a `scheduled` handler
  (`*/5 * * * *` in `wrangler.jsonc`). It calls `/api/integrations/meta/sweep`
  with a token derived from the app secret. Any other caller gets a 404. Each
  sweep processes due retries, advances an open import, and every six hours
  re-reads the last 48 hours of leads from each owner, tenant, buyer, mixed and land JV
  form, in case a webhook never arrived. Unclassified and Ignore forms are not
  read. That scan is reconciliation. It is not a historical import: a historical
  import is a staff-started job and accepts only owner, tenant and buyer forms.
- **Every step is recorded** in `meta_ingestion_events` (received, fetch,
  process, duplicate, retry, waiting for token, done) and shown on the admin page.

### Statuses

| Status | Meaning |
| --- | --- |
| `pending` / `processing` / `retry` | queued, being processed, waiting for the next attempt |
| `waiting_token` | Meta rejected the token; resumes after reconnecting |
| `needs_mapping` | form not classified yet; resumes when the form is saved |
| `needs_review` | no valid Indian mobile; held with all answers for staff |
| `done` | lead or requirement created |
| `duplicate` | already in the CRM (same Meta lead id) |
| `ignored` | form classified as "Ignore" |
| `failed` | permanent error, or retries exhausted; can be retried from the page |

## Forms and field mapping

Forms are discovered from the Page (`/{page-id}/leadgen_forms`), never
hardcoded. A lead from a form the CRM has not seen yet triggers discovery of
that form. Staff classify each form:

| Classification | Creates |
| --- | --- |
| Owner property enquiry | `owner_leads` row (Rent, Sale or Both). Never a property. |
| Tenant requirement | `demand_requirements` with intent Rent |
| Buyer requirement | `demand_requirements` with intent Buy |
| Ignore | nothing; leads are marked `ignored` |

Each question can be mapped to name, mobile, email, rent/sale, property type,
BHK, budget, location, timeline, preferences or a note, or left unmapped. A
suggested mapping is made from Meta's question types (`FULL_NAME`,
`PHONE`, …) and the question wording. A form cannot be saved without a
mobile mapping. Values are parsed for Indian formats: "15k", "40 lakh",
"1.2 crore", "10,000 – 15,000", "2BHK", "within 3 months". Anything that cannot be
parsed is kept as answered in the notes.

Every answer, mapped or not, is kept in `lead_sources.raw_payload_json` and
shown under **Form answers** on the lead or requirement, marked "not mapped"
where it is. Phone numbers and emails there are masked for roles without
`contact.view_phone`.

Leads are always created as **New** and unqualified. The intent score is
calculated as for any other requirement. `lib/crm/matching-hook.ts` is the
Phase 2 entry point. It is called with every captured record and does nothing
today.

## Connection and tokens

1. A super admin clicks **Connect** and approves the Meta login dialog.
   - Only the required permissions are requested, plus any optional ones ticked
     on the page.
   - The callback is protected by a random `state`. It must match an httpOnly
     cookie that is scoped to `/api/admin/integrations/meta`, uses SameSite=Lax,
     is Secure on https, and expires after 10 minutes.
   - The callback also requires a signed-in super admin session.
2. The callback exchanges the code for a long-lived user token.
   - Both exchanges are POSTs with the app secret in the body, never in a URL.
   - The token is checked with `debug_token`.
   - The user token is stored encrypted and kept after a Page is chosen. Campaign,
     ad set and ad name reads use this user token. Lead Ads calls do not.
3. The admin picks the Page. The app then:
   - checks the required permissions
   - takes the Page token
   - subscribes the Page to `leadgen` when it is not already subscribed
   - discovers its forms
   - leaves the user token and its permission list in place
   - stores the Page token's permissions separately. Sync names checks `ads_read`
     on the user-token list, not on the Page-token list

   Reconnecting the same Page refreshes both tokens and does not subscribe the
   Page again when leadgen is already on.

The redirect URI is `https://<host>/api/admin/integrations/meta/callback`, built
from the host the admin is using, and must match an entry in Meta's *Valid OAuth
Redirect URIs* exactly. Connect from `https://gulbargahomes.com`, not `www` or
workers.dev. Alternatively, set `META_OAUTH_REDIRECT_URI` to pin it.

**Token protection:**
- Tokens are encrypted with AES-256-GCM. The key is SHA-256 of `META_TOKEN_KEY`,
  each value has a random 96-bit IV, and the column name is bound as additional
  authenticated data, so a user-token ciphertext cannot be used as a Page token.
- Page and user tokens are sent only in the `Authorization` header, with
  `appsecret_proof`. They never appear in URLs, logs or admin JSON.
- Meta error messages are stored only after tokens are stripped from them, since
  Meta sometimes echoes the token back.

**Where tokens and secrets travel in a URL** (Meta's API only accepts them there):
- `debug_token?input_token=…`, with the app token in the header.
- The `appsecret_proof` HMAC (safe to expose).

Both are outbound subrequests. Workers traces, which would record them, are off,
and `redact_query_string` keeps incoming `hub.verify_token` and OAuth `code`
values out of Workers Logs.

**Require App Secret** is compatible with every call:
- Page and user token calls carry `appsecret_proof`.
- `debug_token` uses the app token (`app_id|app_secret`), which needs no proof.
- The code exchange sends `client_secret`.

**Expiry and reconnecting:**
- A Page token from a long-lived user token does not expire, but Meta's *data
  access* ends 90 days after the person last authorised the app.
- The page shows that date and warns 14 days ahead.
- When Meta refuses the token (error 190, or a permission error), the connection
  becomes **Reconnect needed**. Leads keep queueing as `waiting_token`, and
  imports pause.
- Reconnecting, or a passing **Test connection**, requeues those leads and
  resumes paused imports.

**Test connection** checks the Worker secrets, the token (`debug_token`), Page
access and the webhook subscription, and re-subscribes if needed.

**Disconnect** unsubscribes the app from the Page and deletes the tokens. Forms,
mappings and leads are kept. Webhooks that still arrive while disconnected are
logged and ignored.

## Meta permissions

The integration requests only these. The table lists every Graph call it makes.

| Call | Token | Permissions (Meta reference / guide) |
| --- | --- | --- |
| `POST /oauth/access_token` (code, then `fb_exchange_token`) | — (client secret) | — |
| `GET /debug_token` | app token | — |
| `GET /me` (name) | user | — (public_profile, default) |
| `GET /me/accounts` (Pages + Page tokens) | user | `pages_show_list` |
| `GET /{page-id}` (name) | Page | `pages_read_engagement` |
| `POST`/`GET`/`DELETE /{page-id}/subscribed_apps` | Page | `pages_manage_metadata`, `pages_show_list` |
| `GET /{page-id}/leadgen_forms`, `GET /{form-id}` | Page | `pages_manage_ads`, `leads_retrieval`, `pages_read_engagement`, `pages_show_list` |
| `GET /{lead-id}`, `GET /{form-id}/leads` (`field_data`) | Page | `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list` |

**Required:** `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
`pages_manage_ads`, `leads_retrieval`.

**Optional**, requested only if ticked on the Connect card:
- `ads_read`: campaign, ad set and ad **names**, and campaign **spend**. The ids
  come with the lead either way. **Sync names** and **Import spend** both use
  the saved user token, not the Page token, and both check `ads_read` on the
  user token's own permission list. Neither re-imports leads. Import spend reads
  Insights and does not read `daily_budget`. A rejected or expired user token
  does not pause Lead Ads. `ads_management` is still not requested.
- `business_management`: only if the Page is reachable solely through the
  Business portfolio and does not appear in the Page picker. Meta documents it
  for Business Manager assets and system-user tokens, which this flow does not
  use.

**Not requested:**
- `ads_management`. Meta's Lead Ads guides list it for "ad-level" lead fields,
  but this app never creates or edits ads.
- If Meta refuses `ad_id` / `adset_id` / `campaign_id` without it, the lead is
  fetched again without those fields. The answers are still imported, the ad id
  from the webhook is kept, and the connection stays healthy.
- If staging shows that Meta refuses the **answers** themselves without
  `ads_management`, add it to `REQUIRED_SCOPES` in `lib/meta/config.ts` and
  document why.

**Caveats:**
- Meta's permission reference lists `ads_management`, `ads_read`,
  `business_management` and `pages_manage_ads` as "dependencies" of
  `leads_retrieval` for App Review. If App Review asks for one of them, add it
  then, with the reason.
- "Ready for testing" in the dashboard is **not** production approval. While the
  app is Unpublished, permissions only work for people with a role on the app,
  and Meta only delivers webhooks for test leads.

## Historical import

Choose owner, tenant or buyer forms and a date range (Meta keeps lead answers
for 90 days). Mixed, unclassified and Ignore forms are rejected by the import
job and are not listed on the historical-import card. A mixed form's recent
leads are covered by reconciliation instead, which reads the last 48 hours.
Leads older than that stay on Meta until a later import is approved for that
form. The two Gulbarga Buyer & Renter forms are not imported this way.

## Historical Buyer & Renter Recovery

A super admin can preview and import forms `1071121499253613` and
`1489593689660590` from **Historical Buyer & Renter Recovery** on the Meta
page. No other form id is accepted, and mixed forms stay off the historical
import above. The action reads every lead on those forms with the Page token.
It does not run on deploy, does not change the 48-hour reconciliation window,
and does not import unless the live preview is 143 leads, 104 Buy
(`buy_madbeku`) and 39 Rent (`rent_ge_beku`), all on campaign
`120257140076410091`. A different count, intent or campaign blocks the import.
The preview stores each lead's Meta id, form id, Buy or Rent answer, and campaign
id, and does not store a name or phone number. Confirmation compares that
snapshot with a fresh read. Two leads that swap Buy and Rent, keeping 104 and
39, still block the import and enqueue nothing.
Both forms must already be saved as Buyer or tenant, from the answer. That
dropdown choice is stored as classification `mixed`. Buyer requirement and
Tenant requirement are different saved values and stay blocked. Intent, purchase
budget and rental budget must be mapped. The recovery does not save that
classification. “Budget decide madilla” stays a valid empty budget. A Land
property type becomes a requirement, not a Land JV enquiry or a property.
Requirements start as New. Repeating the recovery counts existing lead ids as
duplicates. The run records who started it, the forms, the preview and the
imported, duplicate, held and failed counts. Migration 16 stores the run.
Continue processes only leads that are already due, up to 20 at a time. A rate
limit schedules that lead at least 15 minutes ahead, and the page shows when
the next batch is eligible. Continue before that time imports nothing. An
expired processing lock is picked up. A finished run cannot be continued, and a
lead that already created a requirement is not created again.

The job reads each selected form's leads page by page with a `time_created`
filter and queues them in the **same** `meta_lead_ingestions` queue the webhook
and reconciliation use. The page shows found, queued, duplicate, done, held and
failed counts. Only one import runs at a time. It advances while the page is
open and through the cron sweep when it isn't. An expired token pauses it;
**Resume** continues from the saved cursor. Failed rows are retried from the
attention list.

## Attribution and reporting

`lead_sources` keeps channel, platform (Facebook/Instagram), Page, form,
campaign, ad set, ad and lead ids and names, organic flag, the original
submission time (`submitted_at`), when the CRM received it (`received_at`), how
it arrived (`ingestion_origin`: manual, webhook, historical_import,
reconciliation, buyer_recovery) and the raw answers. Campaign, ad set and ad ids and names are
also collected in `ad_entities`.

`campaign_lead_funnel` (view) counts leads, owner leads, requirements,
qualified, visited, rented and sold per campaign from current statuses.
`ad_spend_daily` stores one row per campaign per day. **Import spend** fills it
from the Marketing API Insights endpoint with the saved user token and
`ads_read`. The amount is delivered spend in INR, stored as paise. The same
day is replaced on the next import, not added again. Every date in the
requested window is stored; the importer does not drop the tail of a long
window. A campaign Meta did not return is stored as zero only after every
Insights page has been read. An account that is not INR is refused and nothing
is stored. Listing ad accounts, choosing one, and importing spend require a
super admin, in addition to `integrations.manage`. A successful import records
the dates it fully wrote in `ad_spend_coverage`. Campaign quality marks spend
Incomplete when the selected From or To, including a blank date, falls outside
that window, so a longer report cannot show the imported days as the whole
period. The report uses only the ad account currently selected. A saved window
for a previous account is not reused. The Page token is not used, and a failed import does not pause Lead Ads.

## Permissions

| Permission | Super admin | Inventory manager | Lead executive | Viewer |
| --- | --- | --- | --- | --- |
| `integrations.view` (status, forms, activity) | ✓ | ✓ | – | – |
| `integrations.manage` (connect, mapping, imports, retry, disconnect) | ✓ | – | – | – |

Every connect, Page selection, test, mapping change, import, retry, dismiss and
disconnect is written to `audit_log`. Leads created by the integration show
"Meta Lead Ads" as their creator.

## Mixed buyer / renter forms and owner sell, rent, lease

A requirement has one intent and one budget range (`budget_min`, `budget_max`, integer rupees). **Buy** means a purchase price. **Rent** means a monthly rent. There is no second pair of columns. `matchableBudget()` returns `{ basis: "purchase" | "monthly", unit, min, max }` so a future matcher compares a purchase budget with a sale price and a monthly budget with a monthly rent, and does not compare across those. CRM screens prefix the range “Purchase” or “Monthly rent”. The budget answer that does not match the intent stays in `lead_sources.raw_payload_json` and is never written into the range.

Classification `mixed` (“Buyer or tenant, from the answer”) reads the intent answer. A missing or ambiguous answer (including “buy or rent”) is held as `needs_review` with `last_error_kind = intent_demand`. Nothing is created. Staff use **Import as Buy** or **Import as Rent**. That stores `intent_override`, `resolved_by` and `resolved_at` on the queue row (migration 6) and only then imports. The update matches only a row still waiting for that decision, and the unique Meta lead id still blocks a second CRM record. The original answers, campaign attribution and both audit rows (the import, and the staff decision) are kept.

Reconciliation includes every form classified as mixed and runs those leads through the same queue. It does not create owner leads. Historical import does not include mixed forms, so classifying a form as mixed does not put its older leads into a date-range import. Unclassified forms stay out of both.

Owner intent is `Rent`, `Sale` or `Lease` on the existing `owner_leads.intent` text column. Sell is `Sale`. It is never stored as `Rent`. An answer that names more than one of sell, rent and lease is held (`intent_owner`) for **Import as Sale**, **Import as Rent** or **Import as Lease**. A rent-only owner form can still assume Rent, but a form whose options include more than one of those cannot be saved until that question is mapped to intent.

Public listings stay `Rent` | `Sale`. A lease lead does not become a listing by itself. Staff choose “Draft as rental” or “Draft as sale”; the lead remains Lease, the draft is unpublished, and the notes record the choice. Availability expiry follows the listing they chose (14 days for Rent, 30 for Sale).

## Agricultural land JV

Classification `land_jv` records `land_jv_enquiries` (migration 15). Taluk, the original village answer, acre band, ownership, RTC / Pahani, road access and whether the owners agree are stored on that row, and the original Meta answers are kept in `answers_json`. Migration 16 adds `verified_village` and `additional_phone_e164`. Staff type those. Leaving the verified village blank clears a name that was saved earlier. The original village answer is not parsed, and lists use the verified village or “Village not verified”. The contact is marked `is_land_jv` and is not marked as a residential owner. Nothing is created in `properties`, `owner_leads` or `demand_requirements`, and the enquiry status stays `New`.

A form that was classified as owner and held for Sale / Rent / Lease stays held after it is reclassified. Saving the classification does not replay those rows. **Record as Land JV** stores `intent_override = 'Land JV'` and then imports that one lead. **Import as Sale**, **Import as Rent** and **Import as Lease** stay available as a deliberate residential choice and still do not create a property by themselves.

Buyer and renter forms keep purchase budget and monthly rent apart. `Buy madbeku` is a buyer requirement. `Rent ge beku` is a tenant requirement. “Budget decide madilla” is a valid answer and leaves the range empty. A missing or combined intent stays held. A property type of Land on a buyer form is still a requirement, not inventory. Mixed forms stay off the historical-import list, so classifying the buyer copy does not pull its older leads. A stale generic Budget mapping is corrected from the question text before a requirement is stored.

## Database (migration 5, `meta_lead_ads`, and migration 6, `meta_intent_decision`)

- `lead_sources`: new `meta_page_id`, `meta_is_organic`, `ingestion_origin`,
  `received_at`; indexes on form and ad.
- `meta_connection` (single row): encrypted tokens, Page, status, expiry dates,
  scopes, webhook subscription, last check / webhook / success.
- `meta_forms`: discovered forms, questions, classification, owner intent,
  mapping, version.
- `meta_webhook_deliveries`: each delivery and signature result.
- `meta_lead_ingestions` + `meta_ingestion_events`: the queue and its history.
- `meta_import_jobs`: historical imports and their cursor.
- `ad_entities`, `ad_spend_daily`, view `campaign_lead_funnel`.

The migration only adds tables, columns, indexes and a view. Existing listings,
leads and URLs are untouched.

## Reliability on Cloudflare Workers

- **Durable before 200.** The webhook writes the `meta_lead_ingestions` row and
  the delivery log, and only then answers `200 EVENT_RECEIVED`. Any database
  error answers 500, so Meta redelivers. The unique `leadgen_id` makes the
  redelivery harmless.
- **Processing after the response** runs in `ctx.waitUntil`, obtained through
  `getCloudflareContext()`, with a 25-second budget.
  - Verified on the built Worker under `wrangler dev`: the response took 72 ms,
    and the row was then processed in the background.
  - If the isolate is stopped first, nothing is lost. A row that was never
    started stays `pending`, and a row that was mid-flight stays `processing`
    with a five-minute lock.
- **The cron sweep** (`*/5 * * * *` → `worker.ts` → `/api/integrations/meta/sweep`):
  - picks up `pending` and `retry` rows that are due, and `processing` rows
    whose lock expired
  - advances imports
  - reconciles the last 48 hours of owner, tenant, buyer, mixed and land JV forms every six hours. Unclassified and Ignore forms are skipped. Historical import is a separate staff job and accepts owner, tenant, buyer and land JV forms. Mixed forms stay off that list
  - applies retention

  Verified locally: a stale `processing` row was claimed and processed by the
  scheduled event.
- **Locking.** Claiming is one conditional `UPDATE … RETURNING`, so two isolates
  cannot hold the same row. A row is retried only after its lock expires.
- **An interrupted run** that created the lead but did not mark the row done is
  recognised on the next attempt. The record was created by "Meta Lead Ads" for
  that same lead id, so the row is marked `done`, with no second lead and no
  duplicate count.
- **No partial CRM records.** The contact, lead source, owner lead or
  requirement, and audit entry are written in one D1 batch, which is atomic.

## Retention of integration data

| Data | Kept |
| --- | --- |
| Lead answers on the CRM record (`lead_sources.raw_payload_json`) | With the CRM record: 12 months after the last meaningful interaction, then reviewed by hand by the Super Admin ([runbook](data-erasure-runbook.md)) |
| Queue copy of answers (`meta_lead_ingestions.payload_json`) | Cleared at once when dismissed; otherwise 30 days after the row became `done`, `duplicate`, `ignored` or `failed` |
| Rows held for review / mapping | Until staff retry or dismiss them |
| Webhook delivery log (ids and counts only) | 90 days |
| Processing history (`meta_ingestion_events`) | With the queue row. Messages hold no phone numbers |
| Audit log | Append-only, permanent |

Deletion requests and the 12-month review are manual and run by the Super
Admin; see [`data-erasure-runbook.md`](data-erasure-runbook.md). The policy
wording on `/privacy-policy` and `/data-deletion` describes exactly this.

## Cloudflare configuration

Add these as type **Secret** (encrypted), not Text, under **Workers & Pages →
gulbargahomes → Settings → Variables and Secrets**. Do not put them in
`wrangler.jsonc`.

| Variable | Secret | Purpose |
| --- | --- | --- |
| `META_APP_SECRET` | yes | The 32-character App Secret from Meta → App settings → Basic. Verifies webhook signatures, signs Graph calls, derives the cron token. |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | Random string (`openssl rand -hex 24`). The same value goes into the Meta webhook settings. |
| `META_TOKEN_KEY` | yes | `openssl rand -hex 32`. Encrypts stored tokens. Changing it requires reconnecting. |
| `META_APP_ID` | no | Defaults to `2327104601371140` |
| `META_GRAPH_VERSION` | no | Defaults to `v27.0` |
| `META_OAUTH_REDIRECT_URI` | no | Defaults to `https://<host>/api/admin/integrations/meta/callback` |

**Config that preserves dashboard variables:**
- `wrangler.jsonc` sets `keep_vars: true`, so dashboard variables survive any
  deploy, including Workers Builds. `npm run deploy` also passes `--keep-vars`.
- Secrets are always kept by deploys.
- The dashboard's "Update your Wrangler configuration" prompt refers to
  plain-text variables. Secrets must never be copied into the file.

**Binding check (`wrangler deploy --dry-run`):**
- Production: `DB` → `gulbargahomes`, `NEXT_TAG_CACHE_D1`,
  `NEXT_INC_CACHE_R2_BUCKET`, `MEDIA` → `gulbargahomes-media`,
  `NEXT_CACHE_DO_QUEUE`, `WORKER_SELF_REFERENCE`, `IMAGES` and `ASSETS`.
- The cron is `*/5 * * * *`, and `main` is `worker.ts`, which re-exports
  OpenNext's Durable Object classes.
- The `staging` environment has its own D1, R2 and Worker name, and no routes.

## Meta app setup (GulbargaHomes CRM, App ID 2327104601371140)

1. **Use cases → Capture & manage ad leads → Permissions:**
   - Make the required five available: `pages_show_list`,
     `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`,
     `leads_retrieval`.
   - `ads_read` and `business_management` are optional.
   - Leave `ads_management` off.
2. **Facebook Login for Business → Settings:**
   - Client OAuth login: on
   - Web OAuth login: on
   - Enforce HTTPS: on
   - Strict mode for redirect URIs: on
   - Valid OAuth Redirect URIs: exactly
     `https://gulbargahomes.com/api/admin/integrations/meta/callback` (add the
     staging URL too while testing staging)
3. **Use cases → Customize → Webhooks → Page:**
   - Callback URL: `https://gulbargahomes.com/api/webhooks/meta-leads`
   - Verify token: the exact value of `META_WEBHOOK_VERIFY_TOKEN` → *Verify and save*
   - Then, under **Webhook fields**, subscribe to **`leadgen`**. Use the same
     API version as the app, v27.0.
   - Meta allows one callback URL per object per app, so staging needs a
     separate test app or a temporary switch (see Staging).
4. **App settings → Advanced → Security:** Require App Secret: **on**.
5. **App settings → Basic:**
   - Privacy Policy URL `https://gulbargahomes.com/privacy-policy`, once updated.
   - User data deletion → Data deletion instructions URL
     `https://gulbargahomes.com/data-deletion`.
   - Category, app icon and business: Gulbarga Homes.
6. **Meta Business Suite → Settings → Integrations → Leads Access:** allow the
   GulbargaHomes CRM app and the person who will connect it.
7. The person who connects needs a task on the Page that includes Ads/Leads
   (ADVERTISE) and leads access.

### Still needed before real (non-test) leads

- **Confirm `META_APP_SECRET`.** All five values are now Secrets, so their
  contents can no longer be read back. The value set before the conversion was
  not a Meta App Secret (13 characters). If it was not replaced with the
  32-character App Secret when converting, Connect fails at the token exchange.
- **Deploy the privacy and data-deletion wording** together with this code. The
  wording describes the 30- and 90-day purges, which only run with this code.
- **Named staff accounts.** Production has no named admin accounts, only the
  shared `ADMIN_PASSWORD` login, which acts as a Super Admin. Create named
  accounts under Team, then set `ADMIN_LEGACY_LOGIN=disabled`, so the audit
  history shows who handled each lead.
- **App Review:** Advanced Access for the five required permissions, plus any
  optional ones you decide to use. Submit a screencast of Connect → choose Page
  → classify form → a test lead arriving as an owner lead or requirement.
- **Business verification** for Gulbarga Homes.
- **Publishing the app** (Unpublished → Live). Until then Meta delivers only
  dashboard and Lead Ads Testing Tool events. No real leads arrive.

## Staging test procedure

Staging uses its own Worker (`gulbargahomes-staging.<subdomain>.workers.dev`),
D1 and R2. Production data is never touched.

**Set up staging once:**

1. Create the staging resources:

   ```bash
   npx wrangler d1 create gulbargahomes-staging
   npx wrangler d1 create gulbargahomes-staging-next-tag-cache
   npx wrangler r2 bucket create gulbargahomes-staging-next-cache
   npx wrangler r2 bucket create gulbargahomes-staging-media
   ```

   Paste the two D1 ids over `REPLACE_WITH_STAGING_DB_ID` and
   `REPLACE_WITH_STAGING_TAG_CACHE_ID` in `wrangler.jsonc`.
2. Set secrets for staging with `npx wrangler secret put <NAME> --env staging`:
   - `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`
   - `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` and `META_TOKEN_KEY`

   Use a different `META_TOKEN_KEY` and verify token from production.
3. Deploy with `npm run deploy:staging`. The first request creates the schema
   and seeds the listings from `lib/property-seed.json`.
4. Point Meta at staging, in one of two ways:
   - **Recommended:** a separate Meta test app. Set `META_APP_ID` and its secret
     on staging.
   - **Or** temporarily change the GulbargaHomes CRM app's Page webhook callback
     to `https://gulbargahomes-staging.<subdomain>.workers.dev/api/webhooks/meta-leads`,
     and add the staging callback to the OAuth redirect URIs. Switch both back
     before production.

**Test run:**

1. Sign in at `/admin/login` on staging → Integrations → Meta Lead Ads → Connect
   with Facebook. Leave the optional boxes unticked first.
2. Choose the GulbargaHomes Page. Expect 3 forms and "Leadgen webhook:
   Subscribed".
3. Run **Test connection**. All four checks should pass.
4. Classify the owner, tenant and buyer forms, check their mappings and save.
5. In the Lead Ads Testing Tool, create one test lead per form. Within seconds,
   each should appear under *Recently imported*:
   - the owner form as an owner lead (New, no property)
   - the tenant and buyer forms as requirements (New, unqualified)
   - each with Form answers on its page
6. In the Testing Tool, resend the same lead. Expect *Webhook repeats* + 1 and no
   new lead.
7. Check the ad fields on the lead's Source card. If Meta refused ad fields, the
   campaign id is blank but the answers are present. Tick `ads_read`, reconnect,
   send another test lead, and the campaign names should appear.
8. Run a historical import for the last 7 days on the owner, tenant and buyer
   forms. Mixed forms are not offered on that card. Expect "found" to equal
   Meta's count, with earlier test leads counted as duplicates. A mixed form's
   leads from the last 48 hours are picked up by reconciliation, not by this
   import.
9. Set staging's `META_APP_SECRET` to a wrong value, send a test lead, and expect
   a rejected delivery (401) in Webhook activity. Restore the value. Meta retries
   for up to 36 hours.
10. Disconnect. Send a test lead and expect "ignored: no Page is connected".
    Reconnect.
11. Sign in as an inventory manager (view only), a lead executive and a viewer:
    - only the super admin can change anything
    - lead executives and viewers cannot open Integrations
    - viewers see masked numbers
12. Smoke-test the public site on staging: every URL in `/sitemap.xml` should
    return 200, including `/properties` and each `/properties/<slug>`; also try
    search.

## Production deployment procedure

Production already runs this code from PR #35, deployed on 10 Nov 2026 with
migration 5 applied. It holds no Meta connection or leads yet. For this and any
later deploy:

1. Merge to `main` only after staging passes.
2. Back up D1 and note the bookmark:

   ```bash
   npx wrangler d1 export gulbargahomes --remote --output backups/gulbargahomes-$(date +%F).sql
   npx wrangler d1 time-travel info gulbargahomes
   ```

3. Confirm the Worker secrets with `npx wrangler secret list`. Expect five
   names, all `secret_text`.
4. Run `npm run deploy` (it passes `--keep-vars`; `keep_vars` is also set).
5. Check after deploying:
   - every sitemap URL returns 200
   - `/privacy-policy` and `/data-deletion` show the new wording, dated
     10 November 2026
   - `/admin/login` returns 200
   - `/admin/integrations/meta` shows no "Add or correct these Worker secrets"
     message. This message is how a wrong-format `META_APP_SECRET` shows up,
     since Secret values cannot be read back.
   - `GET /api/webhooks/meta-leads` with a wrong verify token returns 403
   - an unsigned `POST` returns 401 (503 means the App Secret is not set at all)
6. In Meta: save the webhook callback (Verify and save), subscribe `leadgen`,
   and turn on Require App Secret.
7. Connect from `https://gulbargahomes.com/admin/integrations/meta`, classify
   the forms, and send one Testing Tool lead per form.
8. Only after App Review, business verification and the privacy update: publish
   the app.

## Rollback procedure

- **Code:** in Workers & Pages → gulbargahomes → Deployments, roll back to the
  previous version, or run `npx wrangler rollback <version-id>`.
  - The pre-CRM version was `fc702796` and the Meta version is `b2993229`.
  - Rolling back the code leaves the additive tables in place, so the old code
    keeps working.
- **Stop Meta traffic without a code rollback:** Disconnect on the admin page.
  This unsubscribes the Page and deletes the tokens. Alternatively, remove the
  webhook subscription in the Meta dashboard. Queued leads stay in D1.
- **Data:**
  - Migration 5 is additive only: new tables, new nullable or defaulted columns,
    indexes and a view. It does not need reverting.
  - Migration 6 adds `intent_override`, `resolved_by` and `resolved_at` with
    defaults. Old code ignores them. New code treats an unknown classification
    such as `mixed` as `unclassified`, so those forms wait instead of importing
    with the wrong intent. Do not apply migration 6 in production until this
    code is deployed. Do not roll the code forward onto a database that has not
    run it: the queue claim reads the new columns. A row still queued with a
    staff override, on a form the previous Worker already understands, can be
    imported by that Worker without the override. Let that import finish before
    rolling back. Mixed forms wait, because the previous Worker does not
    recognise that classification.
  - To restore the database to before a deploy:

    ```bash
    npx wrangler d1 time-travel restore gulbargahomes --bookmark=<bookmark>
    ```

    Bookmark before PR #35: `00000285-00000000-0000511f-4da88fb1de23daf154d836033cb7f30e`.
    This also discards any leads received since then.
  - Alternatively, import the SQL export into a new database.
- **Cron:** removing `triggers.crons` and deploying stops the sweep. Retries
  then happen only on new webhook deliveries.

## Known limitations

- Meta only returns lead answers for 90 days. Older leads cannot be imported.
- Data access ends 90 days after connecting, and someone must reconnect.
- Only Indian mobile numbers are accepted. Other leads are held for review.
- An existing contact keeps its current name and email. The form values are
  still visible under Form answers.
- Funnel counts reflect current statuses, not stage history. Cost metrics stay
  empty until **Import spend** has run for the selected ad account.
- Campaign, ad set and ad names need the optional `ads_read`, then **Sync names**.
  Re-importing a lead does not fill a name that was missing the first time.
  Ad-level ids may need advertiser access on the ad account. Without either,
  the answers still import. Spend import is a separate, unbuilt step.
- Retries, reconciliation and retention rely on the cron trigger, which runs
  only on the deployed Worker. Locally, use *Process queue now*.
- There is no erasure screen. Erasure is a Super Admin SQL procedure
  ([runbook](data-erasure-runbook.md)) and leaves the append-only audit history
  unchanged.

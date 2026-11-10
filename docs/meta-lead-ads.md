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
  re-reads the last 48 hours of leads from each mapped form, in case a webhook
  never arrived.
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

1. A super admin clicks **Connect** and approves the Meta login dialog. An
   httpOnly state cookie, bound to the callback path and valid for 10 minutes,
   protects the callback.
2. The callback exchanges the code for a long-lived user token and checks it with
   `debug_token`. It is stored encrypted only until a Page is chosen.
3. The admin picks the Page. The app checks the required permissions, takes the
   Page token, subscribes the Page to `leadgen`, discovers its forms and
   deletes the user token. Reconnecting the same Page selects it automatically.

Tokens are encrypted with AES-256-GCM using `META_TOKEN_KEY`, are sent only
in the `Authorization` header with `appsecret_proof`, never appear in URLs,
logs or API responses, and are redacted from Meta error messages before those
are stored. A Page token from a long-lived user token does not expire, but
Meta's data access for the user ends after 90 days. The page shows the date
and warns 14 days ahead, and reconnecting renews it.

**Test connection** checks the secrets, the token (`debug_token`), Page access
and the webhook subscription (and re-subscribes if needed). **Disconnect**
unsubscribes the app from the Page and deletes the tokens. Forms, mappings and
leads are kept.

## Historical import

Choose classified forms and a date range (Meta keeps lead answers for 90 days).
The job reads each form's leads page by page with a `time_created` filter and
queues them in the **same** `meta_lead_ingestions` queue. The page shows found,
queued, duplicate, done, held and failed counts. Only one import runs at a
time. It advances while the page is open and through the cron sweep when it
isn't. An expired token pauses it; **Resume** continues from the saved cursor.
Failed rows are retried from the attention list.

## Attribution and reporting

`lead_sources` keeps channel, platform (Facebook/Instagram), Page, form,
campaign, ad set, ad and lead ids and names, organic flag, the original
submission time (`submitted_at`), when the CRM received it (`received_at`), how
it arrived (`ingestion_origin`: manual, webhook, historical_import,
reconciliation) and the raw answers. Campaign, ad set and ad ids and names are
also collected in `ad_entities`.

`campaign_lead_funnel` (view) counts leads, owner leads, requirements,
qualified, visited, rented and sold per campaign from current statuses.
`ad_spend_daily` is empty until a real spend import exists. The view returns
`NULL` spend and the UI shows no cost per lead rather than inventing one.

## Permissions

| Permission | Super admin | Inventory manager | Lead executive | Viewer |
| --- | --- | --- | --- | --- |
| `integrations.view` (status, forms, activity) | ✓ | ✓ | – | – |
| `integrations.manage` (connect, mapping, imports, retry, disconnect) | ✓ | – | – | – |

Every connect, Page selection, test, mapping change, import, retry, dismiss and
disconnect is written to `audit_log`. Leads created by the integration show
"Meta Lead Ads" as their creator.

## Database (migration 5, `meta_lead_ads`)

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

## Cloudflare configuration

| Variable | Secret | Purpose |
| --- | --- | --- |
| `META_APP_SECRET` | yes | App secret (App settings → Basic). Verifies webhooks, signs Graph calls, derives the cron token. |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | Any random string, e.g. `openssl rand -hex 24`. Paste the same value into the Meta webhook settings. |
| `META_TOKEN_KEY` | yes | At least 32 characters, `openssl rand -hex 32`. Encrypts stored tokens. Changing it requires reconnecting. |
| `META_APP_ID` | no | Defaults to `2327104601371140` |
| `META_GRAPH_VERSION` | no | Defaults to `v27.0` |
| `META_OAUTH_REDIRECT_URI` | no | Defaults to `https://<host>/api/admin/integrations/meta/callback` |

The cron trigger and `main: "worker.ts"` are in `wrangler.jsonc` and take effect
on the next deploy.

## Meta app setup (GulbargaHomes CRM, App ID 2327104601371140)

1. **Facebook Login for Business → Settings → Valid OAuth Redirect URIs:**
   `https://gulbargahomes.com/api/admin/integrations/meta/callback`.
2. **Webhooks → Page → Subscribe to `leadgen`**
   - Callback URL: `https://gulbargahomes.com/api/webhooks/meta-leads`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`
   - Deploy first. Meta calls the URL to verify it when you save.
3. **App settings → Advanced:** turn on *Require App Secret* (the app already
   sends `appsecret_proof`).
4. **Permissions:** `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads`, `ads_read`, `business_management`.
   While the app is unpublished these work for people with a role on the app.
5. **Business Suite → Page settings → Leads Access (Leads Access Manager):** allow
   the GulbargaHomes CRM app and the people who connect it.
6. Connect from `/admin/integrations/meta`. Classify the three forms and check
   their mappings.
7. Send a test lead with the **Lead Ads Testing Tool**
   (developers.facebook.com/tools/lead-ads-testing). It should appear under
   *Recently imported* within seconds.

### Still needed before real (non-test) leads

- **Privacy Policy update.** `/privacy-policy` currently says Instant Form
  leads are "collected by Meta" and "not imported into this website". Once the
  integration is connected that is no longer true. The Meta section, the
  "Phone, WhatsApp and email" list and retention need rewording to say that
  submissions are imported into the private GulbargaHomes CRM, what is kept,
  who can see it and how to ask for deletion. The data-deletion page should
  cover CRM records too. Meta App Review checks this page.

- Advanced Access for `leads_retrieval`, `pages_manage_ads`,
  `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `ads_read`
  and `business_management` through App Review, with a screencast of this flow.
- Business verification for Gulbarga Homes.
- Publishing the app (switch from Unpublished to Live). This needs the privacy
  policy URL (`https://gulbargahomes.com/privacy-policy`), the data deletion URL
  (`https://gulbargahomes.com/data-deletion`), an icon and a category.

## Known limitations

- Meta only returns lead answers for 90 days. Older leads cannot be imported.
- Data access ends 90 days after connecting, and someone must reconnect.
- Only Indian mobile numbers are accepted. Other leads are held for review.
- An existing contact keeps its current name and email. The form values are
  still visible under Form answers.
- Funnel counts reflect current statuses, not stage history. Spend import is
  not built yet, so cost metrics stay empty.
- Campaign, ad set and ad names need `ads_read` on the ad account. Without it
  only the ids are stored.
- Retries and reconciliation rely on the cron trigger, which only runs on the
  deployed Worker. Locally, use *Process queue now*.

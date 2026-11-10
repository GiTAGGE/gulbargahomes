# GulbargaHomes Operations CRM — technical plan

GulbargaHomes is an admin-managed property marketplace for Gulbarga (Kalaburagi).
Owners and customers never log in. Every property record is created, verified,
priced, published and retired by authorised staff. Meta ads, calls and WhatsApp
produce **leads**; staff turn them into **inventory** and **requirements**; the
matching engine connects verified inventory with live demand.

This document is the reviewed plan. Sections marked *Phase 0* and *Phase 1* are
implemented on the `cursor/crm-foundation-4401` branch. Later phases are
specified so the schema and APIs do not have to be reshaped when they land.

---

## 1. Principles

1. **Owner lead ≠ property.** An owner lead records interest. A property record
   exists only when an admin explicitly converts the lead, and it starts as a
   `Draft` that is neither public nor matchable.
2. **Three independent property states.** Verification, availability and
   publication answer different questions and change for different reasons.
3. **Fail closed.** New rows default to `Draft` / `Unpublished`. Public pages
   read a database view that can only return verified, published rows.
4. **Nothing is hard-deleted.** Properties are archived. Leads are closed with
   a reason. Every mutation writes an append-only audit row.
5. **The CRM works without integrations.** Meta and WhatsApp are adapters that
   feed the same tables a human can fill in by hand.

---

## 2. Property lifecycle

| State machine | Values | Who changes it |
| --- | --- | --- |
| Verification | `Draft` → `Pending` → `Verified` / `Rejected` | `property.verify` |
| Availability (`status` column) | `Available`, `On Hold`, `Rented`, `Sold`, `Withdrawn` | `property.change_availability` |
| Publication | `Unpublished`, `Published`, `Archived` | `property.publish`, `property.archive` |

The existing `status` column keeps its name so public code, URLs and badges
are unchanged; it gains `On Hold` and `Withdrawn`.

Transition rules (enforced in `lib/inventory/lifecycle.ts`, tested):

- Only `Verified` properties can be published.
- `Reject` and `Archive` force `Unpublished`/`Archived` and clear discreet matching.
- Editing price, BHK, type, listing or locality of a `Verified` property keeps
  it verified but writes an audit row with before/after values.
- `Restore` from `Archived` returns to `Unpublished`; it never republishes.

### Public visibility (unchanged behaviour for existing listings)

```
public = verification = Verified
     AND publication  = Published
     AND status IN (Available, Rented, Sold)
```

Rented and Sold listings remain public with their existing badges and banners,
exactly as today.

### Matching eligibility

| Mode | Rule |
| --- | --- |
| Public match | Verified + Available + Published + availability check not expired |
| Internal-only match | Verified + Available + Unpublished + `discreet_matching = 1` + availability check not expired; visible only to staff holding `property.view_discreet` |

Never matchable: `Draft`, `Pending`, `Rejected`, `Archived`, `Rented`, `Sold`,
`On Hold`, `Withdrawn`, or any property whose availability check is missing or
expired.

### Availability verification and expiry

- `availability_verified_at` / `availability_verified_by` are set by the
  **Confirm availability** action (typically after calling the owner).
- `availability_valid_days` overrides the default window per property.
  Defaults: **Rent 14 days**, **Sale 30 days** (`lib/inventory/lifecycle.ts`).
- `availability_expires_at = verified_at + valid_days`, stored for indexing.
- Expiry is evaluated at read time, so a stale property drops out of matching
  the moment it expires — no cron job required. A future scheduled Worker can
  pre-create recheck follow-ups.
- Migrated listings start with no availability check: they stay public as they
  are today but are **not matchable** until someone confirms availability.

---

## 3. Database schema

D1 (SQLite). All ids are text (`prefix_` + random hex). Human codes are
sequential per entity (`GH-P0001`, `GH-O0001`, `GH-D0001`). Timestamps are ISO
8601 UTC strings. Money is integer rupees.

### Migration sequence

Migrations are applied by the app on the first database request (the existing
pattern — production deploys do not run `wrangler d1 migrations apply`). The
runner lives in `lib/db/migrations.ts`, records each version in
`schema_migrations`, applies each migration's statements as one D1 batch
(atomic), and is idempotent so concurrent isolates are safe.

| # | Name | Phase | Contents |
| --- | --- | --- | --- |
| 1 | `properties_baseline` | existing | `properties`, `app_meta`, listing/status/locality indexes (identical to `migrations/0001_properties.sql`) |
| 2 | `property_lifecycle` | 0 | lifecycle, ownership and audit columns on `properties`; stable `id`/`code`; backfill existing rows as Verified + Published; `public_properties` view |
| 3 | `admin_and_audit` | 0 | `admin_users`, append-only `audit_log` (with UPDATE/DELETE-blocking triggers) |
| 4 | `crm_core` | 1 | `lead_sources`, `contacts`, `owner_leads`, `demand_requirements`, `activities`, `followups` |
| 5 | `matching` | 2 | `matches`, `match_runs` |
| 6 | `visits_and_deals` | 3 | `site_visits`, `deals` |
| 7 | `messaging` | 3 | `message_channels`, `messages` (WhatsApp Cloud API + Business App coexistence) |
| 8 | `campaign_spend` | 4 | `campaigns`, `campaign_spend_daily`, `lead_imports`, `lead_import_rows` |

### 3.1 `properties` (extended, Phase 0)

Existing columns are unchanged. Added:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT UNIQUE | stable key for every relationship; slug stays the URL key |
| `code` | TEXT UNIQUE | `GH-P0001` |
| `verification_status` | TEXT | default `Draft` |
| `publication_status` | TEXT | default `Unpublished` |
| `discreet_matching` | INTEGER | 0/1 |
| `verified_at`, `verified_by` | TEXT | |
| `rejection_reason` | TEXT | |
| `availability_verified_at`, `availability_verified_by` | TEXT | |
| `availability_valid_days` | INTEGER | 0 = default for listing type |
| `availability_expires_at` | TEXT | indexed |
| `owner_contact_id` | TEXT | → `contacts.id` |
| `source_owner_lead_id` | TEXT | → `owner_leads.id` |
| `internal_notes` | TEXT | never public |
| `created_at`, `created_by`, `updated_by` | TEXT | |
| `published_by`, `first_published_at`, `archived_at` | TEXT | |
| `row_version` | INTEGER | optimistic concurrency |

Slug renames become `UPDATE … SET slug` (they were delete + insert), so the
`id`, audit history and relationships survive a rename.

`public_properties` is a view over `properties` with the public visibility rule.
It is the **only** source the public site reads.

### 3.2 `admin_users` (Phase 0)

`id`, `email` (unique, case-insensitive), `name`, `role`, `password_hash`,
`password_salt`, `password_iterations`, `active`, `created_at`, `created_by`,
`updated_at`, `last_login_at`.

Passwords use PBKDF2-SHA256 (100,000 iterations — the Workers maximum) with a
per-user salt. The existing `ADMIN_PASSWORD` keeps working as a built-in
**Primary admin** (super admin) so nobody is locked out; set
`ADMIN_LEGACY_LOGIN=disabled` once named accounts exist.

### 3.3 `audit_log` (Phase 0)

`id`, `occurred_at`, `actor_id`, `actor_email`, `actor_role`, `entity_type`,
`entity_id`, `entity_label`, `action`, `changes_json` (`{field: [before, after]}`),
`context_json`. Indexed by entity and by actor. Triggers abort any UPDATE or
DELETE. Phone numbers and emails are masked inside `changes_json`.

### 3.4 CRM core (Phase 1)

**`lead_sources`** — one row per inbound submission, shared by owner leads and
requirements so attribution is uniform.
`id`, `channel` (`meta_lead_form`, `website`, `whatsapp`, `phone`, `walk_in`,
`referral`, `manual`, `csv_import`), `platform` (`facebook`, `instagram`),
`meta_lead_id` (unique when present — import dedupe key), `meta_form_id`,
`meta_form_name`, `meta_campaign_id`, `meta_campaign_name`, `meta_adset_id`,
`meta_adset_name`, `meta_ad_id`, `meta_ad_name`, `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content`, `utm_term`, `submitted_at`, `raw_payload_json`,
`created_at`, `created_by`.

**`contacts`** — a person, deduplicated by normalised mobile (`+91XXXXXXXXXX`).
`id`, `code`, `name`, `phone_e164` (unique), `alt_phone_e164`, `whatsapp_e164`,
`email`, `language`, `is_owner`, `is_seeker`, `do_not_contact`,
`do_not_contact_reason`, `notes`, `merged_into_id`, `created_at`, `created_by`,
`updated_at`, `updated_by`, `row_version`.

**`owner_leads`** — `id`, `code`, `contact_id`, `source_id`, `intent`
(`Rent`/`Sale`), `property_type`, `locality`, `location_text`, `expected_price`,
`notes`, `status`, `status_reason`, `priority` (`Hot`/`Warm`/`Cold`),
`assigned_to`, `next_followup_at`, `last_contacted_at`, `converted_at`,
`converted_by`, `created_at`, `created_by`, `updated_at`, `updated_by`,
`row_version`.
Statuses: `New`, `Contacted`, `Details pending`, `Converted`, `Not interested`,
`Unreachable`, `Duplicate`, `Invalid`. A converted lead can produce several
properties (`properties.source_owner_lead_id`).

**`demand_requirements`** — `id`, `code`, `contact_id`, `source_id`, `intent`
(`Rent`/`Buy`), `property_types_json`, `bhk_min`, `bhk_max`, `budget_min`,
`budget_max`, `localities_json`, `locality_flexible`, `area_min`, `furnishing`,
`tenant_profile`, `vegetarian`, `parking_required`, `timeline`
(`Immediate`, `Within 7 days`, `Within 30 days`, `Within 3 months`, `Exploring`),
`needed_by`, `notes`, `status`, `status_reason`, `priority_override`,
`assigned_to`, `next_followup_at`, `last_contacted_at`, `outcome`,
`closed_at`, `created_at`, `created_by`, `updated_at`, `updated_by`,
`row_version`.
Statuses: `New`, `Contacted`, `Verified`, `Qualified`, `Matched`,
`Property shared`, `Visit scheduled`, `Visited`, `Negotiation`, `Converted`,
`Lost`, `Postponed`, `Duplicate`, `Invalid`.

**`activities`** — the interaction timeline.
`id`, `occurred_at`, `actor_id`, `contact_id`, `entity_type`, `entity_id`,
`kind` (`call`, `whatsapp`, `sms`, `email`, `note`, `visit`,
`owner_confirmation`), `direction` (`outbound`/`inbound`), `outcome`
(`connected`, `no_answer`, `busy`, `switched_off`, `wrong_number`,
`callback_requested`, `sent`, `delivered`, `read`, `replied`), `body`,
`duration_seconds`, `channel` (`manual`, `wa_business_app`, `wa_cloud_api`),
`external_id` (WhatsApp `wamid`, unique when present), `created_at`.

**`followups`** — `id`, `entity_type`, `entity_id`, `contact_id`, `due_at`,
`reason`, `priority`, `assigned_to`, `status` (`Open`, `Done`, `Cancelled`),
`completed_at`, `completed_by`, `outcome_note`, `created_at`, `created_by`.

### 3.5 Later phases (specified, not yet created)

- **`matches`** (Phase 2): `requirement_id`, `property_id`, `mode`
  (`public`/`internal`), `score`, `match_type` (`Exact`, `Budget stretch`,
  `Nearby location`, `Partial`), `reasons_json`, `status` (`Suggested`,
  `Shortlisted`, `Shared`, `Visit scheduled`, `Visited`, `Customer declined`,
  `Admin rejected`, `Converted`, `Expired`), `decided_by`, timestamps; unique
  on (`requirement_id`, `property_id`). `match_runs` logs each recompute and
  its trigger (new property, price change, new requirement, availability change).
- **`site_visits`** / **`deals`** (Phase 3): visit schedule, owner confirmation,
  customer feedback; deal outcome, agreed price, close date, commission.
- **`message_channels`** / **`messages`** (Phase 3): see §8.
- **`campaigns`**, **`campaign_spend_daily`**, **`lead_imports`**,
  **`lead_import_rows`** (Phase 4): spend per Meta campaign per day, CSV/webhook
  import batches with per-row errors and dedupe decisions.

---

## 4. API architecture

All admin endpoints live under `/api/admin/*` and go through one wrapper
(`lib/admin/route.ts`):

1. Rejects cross-origin mutations (`Origin` must match the host) and non-JSON
   bodies.
2. Verifies the signed session cookie, then reloads the admin from
   `admin_users` so a deactivated account or changed role applies immediately.
3. Checks the named permission.
4. Runs the handler; validation errors are `400`, missing rows `404`,
   optimistic-lock conflicts `409`, permission failures `403`.

Writes go through service modules (`lib/inventory`, `lib/crm`) that apply the
change and its audit row in a single D1 batch.

| Method | Path | Permission | Phase |
| --- | --- | --- | --- |
| POST / DELETE | `/api/admin/session` | — | existing (email + password, legacy password) |
| GET | `/api/admin/me` | signed in | 0 |
| GET / POST | `/api/admin/users` | `users.manage` | 0 |
| PATCH | `/api/admin/users/[id]` | `users.manage` | 0 |
| POST | `/api/admin/properties` | `property.create` (creates Draft) | existing → 0 |
| PATCH | `/api/admin/properties/[slug]` | `property.edit` (+`edit_price` when price changes) | existing → 0 |
| DELETE | `/api/admin/properties/[slug]` | `property.archive` (archives, never deletes) | existing → 0 |
| POST | `/api/admin/properties/[slug]/lifecycle` | per action | 0 |
| POST | `/api/admin/upload` | `property.edit` | existing |
| GET / POST | `/api/admin/contacts` | `crm.view` / `crm.edit` | 1 |
| PATCH | `/api/admin/contacts/[id]` | `crm.edit` | 1 |
| GET / POST | `/api/admin/owner-leads` | `crm.view` / `crm.edit` | 1 |
| PATCH | `/api/admin/owner-leads/[id]` | `crm.edit` | 1 |
| POST | `/api/admin/owner-leads/[id]/convert` | `property.create` | 1 |
| GET / POST | `/api/admin/requirements` | `crm.view` / `crm.edit` | 1 |
| PATCH | `/api/admin/requirements/[id]` | `crm.edit` | 1 |
| POST | `/api/admin/activities` | `activity.log` | 1 |
| POST | `/api/admin/followups` | `followup.manage` | 1 |
| PATCH | `/api/admin/followups/[id]` | `followup.manage` | 1 |
| GET / POST | `/api/admin/matches…` | `match.view` / `match.manage` | 2 |
| POST | `/api/admin/imports/meta-csv` | `import.run` | 4 |
| GET / POST | `/api/webhooks/meta-leads` | Meta signature (`X-Hub-Signature-256`) | 4 |
| GET / POST | `/api/webhooks/whatsapp` | Meta signature | 3 |
| GET | `/api/admin/analytics/funnel` | `analytics.view` | 4 |

Lifecycle actions (`POST …/lifecycle`, body `{ action, … }`):
`submit_for_verification`, `verify`, `reject` (reason required), `publish`,
`unpublish`, `archive`, `restore`, `set_availability` (`status`),
`confirm_availability` (`validDays?`), `set_discreet` (`enabled`).

Public endpoints are unchanged (`/api/search`, `/media/*`, sitemaps). `/media`
refuses the `private/` prefix, where property documents will be stored.

---

## 5. Admin screens

Navigation (left rail, mobile top bar): **Today · Owner leads · Requirements ·
Inventory · Contacts · Team · View website**. Matches, Analytics, Imports and
Settings join in later phases. `/admin/properties` stays the landing page so
existing bookmarks and the `AGENTS.md` link keep working.

| Screen | Path | Contents |
| --- | --- | --- |
| Today | `/admin/today` | overdue and due follow-ups, new owner leads, urgent requirements (Immediate / 7 days), properties needing an availability recheck, drafts awaiting verification |
| Owner leads | `/admin/owner-leads` | status tabs, search, priority; "Add owner lead" |
| Owner lead detail | `/admin/owner-leads/[id]` | contact card (masked by permission), lead facts, status, activity log, follow-ups, **Convert to draft property**, linked properties |
| Requirements | `/admin/requirements` | status and timeline filters, urgency-sorted queue |
| Requirement detail | `/admin/requirements/[id]` | requirement facts, status, activity log, follow-ups; matches panel in Phase 2 |
| Contacts | `/admin/contacts`, `/admin/contacts/[id]` | dedupe by mobile, every lead/requirement/property for the person |
| Inventory | `/admin/properties` | tabs: All · Drafts · Pending verification · Verified (unpublished) · Published · Needs availability check · Rented/Sold · Archived; code, states, availability age |
| Property | `/admin/properties/[slug]/edit` | existing editor + **Lifecycle panel** (states, allowed actions, availability confirmation, discreet toggle, owner link) + **History** (audit rows) |
| Team | `/admin/team` | admins, roles, activate/deactivate, reset password |

UX rules: every state is shown as a coloured pill with words (never colour
alone); destructive actions confirm; actions a role cannot perform are hidden,
and the server re-checks regardless; phone numbers render as tap-to-call and
tap-to-WhatsApp links for roles allowed to see them.

---

## 6. Roles and permissions

| Permission | Super admin | Inventory manager | Lead executive | Viewer |
| --- | :-: | :-: | :-: | :-: |
| `property.view` | ✓ | ✓ | ✓ | ✓ |
| `property.view_discreet` | ✓ | ✓ | – | – |
| `property.view_owner_contact` | ✓ | ✓ | – | – |
| `property.create` (incl. lead conversion) | ✓ | ✓ | – | – |
| `property.edit` | ✓ | ✓ | – | – |
| `property.edit_price` | ✓ | ✓ | – | – |
| `property.change_availability` | ✓ | ✓ | – | – |
| `property.confirm_availability` | ✓ | ✓ | ✓ | – |
| `property.verify` | ✓ | ✓ | – | – |
| `property.publish` | ✓ | ✓ | – | – |
| `property.archive` | ✓ | ✓ | – | – |
| `crm.view` | ✓ | ✓ | ✓ | ✓ |
| `crm.edit` | ✓ | ✓ | ✓ | – |
| `contact.view_phone` | ✓ | ✓ | ✓ | – |
| `activity.log` | ✓ | ✓ | ✓ | – |
| `followup.manage` | ✓ | ✓ | ✓ | – |
| `match.view` / `match.manage` (Phase 2) | ✓ | ✓ | ✓ / ✓ | ✓ / – |
| `import.run` (Phase 4) | ✓ | ✓ | – | – |
| `analytics.view` | ✓ | ✓ | – | ✓ |
| `audit.view` | ✓ | ✓ | – | – |
| `users.manage` | ✓ | – | – | – |

Lead executives can record that an owner confirmed availability (they make the
calls) but cannot change price, availability state, verification or
publication. Owners and customers have no accounts at all.

---

## 7. Public data isolation and security

1. **One public read path.** `lib/properties.ts` (public) reads only the
   `public_properties` view; the local JSON fallback applies the same predicate
   in code. Admin reads live in `lib/inventory/*`, which imports `server-only`.
2. **Lint boundary.** ESLint forbids importing `@/lib/inventory*`, `@/lib/crm*`
   and `@/lib/admin/*` from public pages and components.
3. **Explicit field mapping.** The public `Property` type has no internal
   fields; rows are mapped field by field, so a new internal column can never
   leak through serialisation.
4. **Discreet inventory** is unpublished (so never in the view) and is filtered
   out of admin lists and detail pages for roles without `property.view_discreet`.
5. **PII minimisation.** Phone numbers and owner details are masked server-side
   for roles without permission; audit rows mask them too.
6. **Sessions.** HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax`, 12 hours,
   carrying the admin id; the account is reloaded on every request. Legacy
   tokens remain valid until they expire.
7. **CSRF.** Mutating admin endpoints require a same-origin `Origin` header and
   a JSON body.
8. **Private files.** Documents go to the R2 `private/` prefix; `/media` refuses
   it. Draft photos use unguessable keys.
9. **Cache.** Publish, unpublish, archive, availability and price changes call
   `revalidateListings()` so public pages refresh immediately.
10. **Crawlers.** `/admin` and `/api/` are already disallowed in `robots.ts`;
    admin pages send `noindex`.
11. **Recommended at the edge.** Put Cloudflare Access in front of `/admin*` and
    `/api/admin*` and add a rate-limit rule on `POST /api/admin/session`.
12. **Privacy notice.** The current Privacy Policy says Meta Instant Form leads
    are not stored and that there is no customer database. It must be updated
    (and the data-deletion page extended to CRM records) **before real lead
    data is entered**.

---

## 8. WhatsApp: coexistence-ready, never required

The CRM records WhatsApp interactions as `activities` with
`channel = manual` today (click-to-WhatsApp links plus a logged note). When the
business number is onboarded to the **WhatsApp Business App + Cloud API
coexistence** setup:

- `/api/webhooks/whatsapp` verifies the Meta signature, stores inbound
  messages and Business App **message echoes** in `messages`, and links them to
  contacts by number;
- outbound template messages sent through the Cloud API write the returned
  `wamid` into `activities.external_id` and update delivery status from
  webhooks;
- history sync is imported into `messages`, never into audit.

Nothing in the lead, requirement, property or follow-up flows depends on these
tables; if onboarding is delayed or revoked, staff keep logging manually.

---

## 9. Conversion funnel analytics (Phase 4)

Every lead and requirement points at a `lead_sources` row carrying Meta
campaign, ad set, ad and form ids. Spend is entered or imported per campaign
per day.

| Metric | Definition |
| --- | --- |
| Leads | requirements / owner leads created per source |
| Contact rate | leads with a connected call or WhatsApp reply |
| Qualified | requirements reaching `Qualified` or later |
| Matched | requirements with ≥1 eligible match |
| Visits | requirements with a completed site visit |
| Transactions | requirements with outcome `Converted` |
| Cost per qualified lead | spend ÷ qualified |
| Cost per visit | spend ÷ visits |
| Cost per transaction | spend ÷ transactions |
| Owner side | owner leads → converted to property → verified → published → rented/sold |

Funnel stages are read from `audit_log` status transitions, so historical
conversion is reconstructable without extra columns.

---

## 10. Testing and migration plan

### Automated (`npm test`, Node test runner)

- **Lifecycle:** every transition, the public predicate, both matching modes,
  every non-matchable state, availability expiry boundaries.
- **Permissions:** the full role × permission matrix above.
- **Phone normalisation and masking.**
- **Migrations** against real SQLite (`node:sqlite`): fresh database; a copy of
  today's production shape with existing listings; running twice (idempotency).
- **Isolation:** Draft, Pending, Rejected, Unpublished, discreet, Archived,
  On Hold and Withdrawn rows are absent from `public_properties`; migrated
  listings are all present.

### Manual / build

- `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Local run against local D1: sitemap, property URLs and search results match
  the pre-migration output; admin flows (create draft → verify → publish →
  public page; convert owner lead; discreet property hidden from public and
  from lead executives).

### Production rollout

1. `npx wrangler d1 export gulbargahomes --remote --output backup.sql`
   (D1 Time Travel is the second safety net).
2. Deploy. The first request applies migrations 2–4 atomically per migration.
3. Check `/sitemap.xml` property count and a sample of property URLs.
4. Sign in with the existing password, create named admin accounts, then set
   `ADMIN_LEGACY_LOGIN=disabled`.
5. Update the Privacy Policy before entering real leads.

Rollback: all changes are additive columns and new tables. The previous build
ignores them and keeps serving every listing.

---

## 11. Phases

| Phase | Scope |
| --- | --- |
| **0 Foundations** | migrations runner, lifecycle columns + backfill, public view and isolation, named admins + roles, audit log, archive instead of delete, lifecycle actions, availability expiry |
| **1 CRM core** | contacts, owner leads, requirements, activities, follow-ups, explicit lead → draft conversion, Today / leads / requirements / contacts / team screens |
| **2 Matching** | `matches`, scoring (intent score separate from match score), explanations, auto re-match on inventory/requirement changes, inventory-gap report |
| **3 Conversion** | site visits, deals and outcomes, WhatsApp templates, coexistence webhook adapter, lead recycling |
| **4 Attribution** | Meta CSV import, Lead Ads webhook, campaign spend, funnel analytics and cost metrics |
| **5 Intelligence** | locality demand trends, owner-acquisition recommendations, forecasting |

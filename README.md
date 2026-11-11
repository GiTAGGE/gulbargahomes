# GulbargaHomes

Premium real estate platform for **Gulbarga (Kalaburagi)** — rental houses, flats, independent homes, villas, commercial space and residential plots.

Live domain: [gulbargahomes.com](https://gulbargahomes.com)  
Production host: **Cloudflare Workers** via OpenNext (same path as HubliTaxi).

## What this site is

Listings live in **Cloudflare D1** (SQLite). The listing desk at `/admin/properties` adds and edits them without a git commit or a rebuild. Photos and video tours that are already in `public/images` and `public/videos` stay on those URLs and ship with the Worker as static assets. New uploads go to the **R2** bucket `gulbargahomes-media` and are served from `/media/...`.

The MDX files in `content/properties/` are the migration snapshot. The first request on an empty D1 database copies them in. After that, the database is the source of truth.

Projects and interior-design previews are still MDX in `content/projects/` and `content/designs/`.

## Tech stack

- Next.js 15 (App Router, TypeScript) on Cloudflare Workers (`@opennextjs/cloudflare`)
- Tailwind CSS
- D1 database `gulbargahomes` for properties
- R2 for new photos and videos, plus the OpenNext incremental cache
- Existing WebP photos and MP4/MOV tours in `public/`
- Pagefind plus `/api/search` (search prefers the database)
- SEO: JSON-LD (`RealEstateAgent`, `Residence` / `LandPlot`, `VideoObject`, `FAQPage`), sitemap, robots, Gulbarga **and** Kalaburagi landing pages

## Local development

```bash
npm install
cp .env.example .env.local   # set ADMIN_PASSWORD and ADMIN_SESSION_SECRET
npm run dev
```

Open http://localhost:3000. Listing desk: http://localhost:3000/admin/properties

`npm run dev` uses local D1 when the OpenNext dev binding is active. If that binding is missing, it uses `.data/properties.json` (created from the MDX snapshot, gitignored).

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Refresh the property snapshot, then production build + Pagefind |
| `npm run preview` | OpenNext build + local Workers runtime |
| `npm run deploy` | Build and deploy the Worker (`--keep-vars` so dashboard secrets stay) |
| `npm run deploy:staging` | Build and deploy the `staging` environment (own Worker, D1 and R2; see `docs/meta-lead-ads.md`) |
| `npm run -s erasure:sql -- GH-C0001 --by <email>` | Print the SQL for a manual erasure request; `-- --review` lists contacts due for the 12-month review (see `docs/data-erasure-runbook.md`) |
| `npm run images` | Rebuild WebP photos, hero image and MP4 tours |
| `npm run lint` | ESLint |

## Listing desk and operations CRM

Sign in at `/admin/properties` with a named staff account, or leave the email blank to use the shared `ADMIN_PASSWORD` (signed in as "Primary admin"). Owners and customers never log in. Every listing is created and changed by staff. The full design is in [`docs/crm-architecture.md`](docs/crm-architecture.md).

- **Today** (`/admin/today`) lists follow-ups due, new owner leads, urgent requirements, properties waiting for verification and properties whose owner availability check has expired.
- **Owner leads** record an owner's interest from a Meta form, a call or WhatsApp. A lead never creates a property by itself. Staff use *Convert to draft property*, which creates an internal draft linked to the owner. One owner can have several properties.
- **Requirements** record tenants and buyers, ranked by an intent score (urgency, budget, detail, engagement).
- **Inventory** shows every property, with tabs for what is on the website, the pipeline, properties that need reconfirming, discreet properties, off-market properties and the archive.
  - New properties start as **Draft + Unpublished**. They reach the website only once they are **Verified + Published** and Available, Rented or Sold.
  - "Delete" now archives.
  - Each change is written to an append-only history, with who made it and when.
- **Availability checks** expire after 14 days for rentals and 30 days for sales. Until staff confirm with the owner again, the property stays out of matching.
- **Contacts** hold one record per mobile number, with every call, message and note across their leads and requirements.
- **Integrations → Meta Lead Ads** (`/admin/integrations/meta`) connects the Facebook Page. Owner, tenant and buyer Instant Form leads then arrive as owner leads and requirements automatically, without duplicates, and past leads can be imported. Only super admins can connect, map forms or import. Setup and the Meta app checklist are in [`docs/meta-lead-ads.md`](docs/meta-lead-ads.md).
- **Team** (super admin only) adds named accounts with a role: Super admin, Inventory manager, Lead executive or Viewer. Viewers see masked phone numbers.

Editing a property still supports price, locality, Vastu, bachelor/family rules, amenities, nearby places, FAQs, photo upload (set a cover, reorder), video upload and YouTube URLs.

Existing photos and tours keep their `/images/...` and `/videos/...` paths. New files upload to R2 (or `public/uploads` in local dev without R2). Video uploads can be up to 80 MB.

One existing tour, `public/videos/properties/video-project.mp4`, was re-encoded under Cloudflare’s 25 MiB static-asset limit. The picture is still 1280×720 and the original audio track was copied across. The URL did not change.

## What you need in Cloudflare

Do this once in the same Cloudflare account that will own `gulbargahomes.com`. Resource **names** below match `wrangler.jsonc`. Replace the placeholder `database_id` values after the create commands print real ids. Do not commit secrets.

```bash
npx wrangler login

# Listings database
npx wrangler d1 create gulbargahomes
# Paste database_id into wrangler.jsonc → d1_databases (binding DB)

# OpenNext tag cache (revalidatePath after you save a listing)
npx wrangler d1 create gulbargahomes-next-tag-cache
# Paste database_id into wrangler.jsonc → d1_databases (binding NEXT_TAG_CACHE_D1)

# OpenNext incremental cache
npx wrangler r2 bucket create gulbargahomes-next-cache

# New property photos and videos
npx wrangler r2 bucket create gulbargahomes-media
```

The Durable Object class `DOQueueHandler` comes from the OpenNext build. The `v1` migration in `wrangler.jsonc` registers it. No separate create command.

`npm run deploy` runs OpenNext `populateCache`, which creates the D1 `revalidations` table. The listings table is created on the first request and filled from `lib/property-seed.json` (the current MDX files). You do not need a manual SQL import. Schema changes are versioned migrations in `lib/db/migrations.ts`, applied on the first request after a deploy and recorded in `schema_migrations`. When an existing database is upgraded, every current listing is kept as Verified + Published, so the website does not change.

### Worker secrets and build variables

Set these in the Worker **Settings → Variables and Secrets**. Also add the `NEXT_PUBLIC_*` values as **build variables** if you use Workers Builds, because Next inlines them at build time.

| Variable | Secret | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes | Shared listing desk password (signs in as "Primary admin", a super admin). Named staff accounts are added under Team. |
| `ADMIN_SESSION_SECRET` | yes | `openssl rand -hex 32` |
| `ADMIN_LEGACY_LOGIN` | no | Set to `disabled` once everyone has a named account. This switches off the shared password and ends its existing sessions. |
| `NEXT_PUBLIC_GA4_ID` | no | `G-47GFXYGBTL` unless the GA4 property changes |
| `NEXT_PUBLIC_CLARITY_ID` | no | Optional Microsoft Clarity id |
| `REVALIDATE_SECRET` | yes | Optional, for `POST /api/revalidate` |
| `META_APP_SECRET` | yes | Meta app secret. Verifies Lead Ads webhooks and signs Graph calls |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | Random string, also entered in the Meta webhook settings |
| `META_TOKEN_KEY` | yes | `openssl rand -hex 32`. Encrypts the stored Page token |
| `META_APP_ID`, `META_GRAPH_VERSION`, `META_OAUTH_REDIRECT_URI` | no | Default to `2327104601371140`, `v27.0` and `https://<host>/api/admin/integrations/meta/callback` |

Deploy with `npm run deploy` (it passes `--keep-vars`) so a later deploy does not wipe those secrets.

### Workers Builds

Production deployments happen automatically when a change is merged into `main`. Feature branches and pull requests do not deploy. The Cloudflare production branch is `main`, and preview builds are turned off.

Cloudflare preserves the existing Worker secrets and resource bindings on each deployment. `wrangler.jsonc` sets `keep_vars: true`, and the deploy command passes `--keep-vars`.

Build command: `npx opennextjs-cloudflare build`. Deploy command: `npx opennextjs-cloudflare deploy -- --keep-vars`. Node 20 (see `.nvmrc`).

Custom domains in `wrangler.jsonc`: `gulbargahomes.com` and `www.gulbargahomes.com`. `www` redirects to the apex in the app. `workers.dev` stays available as a rollback URL.

`https://gulbargahomes.<your-subdomain>.workers.dev` remains a rollback URL. Canonical tags and the sitemap use `https://gulbargahomes.com`.

### Cloudflare Images

`wrangler.jsonc` includes the `IMAGES` binding, same as HubliTaxi, so `next/image` can optimize on the edge. That product is billed separately. If the account does not have it, remove the `images` block from `wrangler.jsonc` and set `images.unoptimized: true` in `next.config.mjs`. The WebP files in `public/images` still load either way.

### Google Analytics

Measurement ID `G-47GFXYGBTL`. WhatsApp and call clicks send `whatsapp_click` / `phone_click` and `generate_lead`. Mark `generate_lead` as a key event in GA4. Public phone and WhatsApp are `+91 81234 50725` and `+91 84313 95255` (`lib/site.ts`).

## SEO notes

High-intent pages are prerendered, including:

- `/houses-for-rent-in-gulbarga`
- `/flats-for-rent-in-kalaburagi`
- `/plots-for-sale-in-gulbarga`
- `/houses-for-sale-in-kalaburagi`
- Locality pages such as `/rent-flat-azadpur` generated from listings

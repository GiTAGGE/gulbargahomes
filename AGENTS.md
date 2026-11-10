# AGENTS.md

GulbargaHomes is a Next.js 15 (App Router, TypeScript) + Tailwind CSS real estate site for Gulbarga (Kalaburagi), deployed to **Cloudflare Workers** with OpenNext — the same shape as HubliTaxi.

Properties live in **D1** (`DB` binding, database `gulbargahomes`). The listing desk is `/admin/properties` (password in `ADMIN_PASSWORD`). Existing photos and videos stay in `public/images` and `public/videos`. New uploads use the R2 bucket `gulbargahomes-media` (`MEDIA` binding) and are served at `/media/...`. MDX in `content/properties/` is the seed snapshot (`lib/property-seed.json`). Projects stay in `content/projects/`; design previews stay in `content/designs/`.

See `README.md` for the Cloudflare resources, secrets, and domain cutover.

## Services

- Dev server: `npm run dev` → http://localhost:3000
- Listing desk: http://localhost:3000/admin/properties (operations CRM: `/admin/today`, `/admin/owner-leads`, `/admin/requirements`, `/admin/contacts`, `/admin/team`, `/admin/integrations/meta`)
- Tests: `npm test` (Node test runner + tsx, in-memory `node:sqlite` stands in for D1)
- Lint / build: `npm run lint`, `npm run build`
- Worker: `npm run preview`, `npm run deploy`
- Media: `npm run images` rebuilds WebP photos, hero assets and MP4 tours from `public/images/source/`

## Gotchas

- Link the listing desk as `/admin/properties`. The old Decap admin and Netlify Identity files have been removed.
- Placeholder D1 ids in `wrangler.jsonc` must be replaced after `wrangler d1 create`
- Do not commit `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET`
- A single static video must stay under 25 MiB (Cloudflare asset limit). Larger new videos belong in R2
- Pagefind search index is built in `postbuild`; property search also hits the database via `/api/search`
- City copy must mention both **Gulbarga** and **Kalaburagi**
- `/privacy-policy` and `/data-deletion` describe the CRM, Meta Lead Ads import, 12-month manual review and Super Admin erasure (`docs/data-erasure-runbook.md`). Change them when data handling changes, and never promise automatic deletion that is not built
- Public pages read listings only through `lib/properties.ts` (the `public_properties` view: Verified + Published). ESLint blocks public code from importing `@/lib/inventory`, `@/lib/crm` or `@/lib/admin`
- Meta Lead Ads (`lib/meta/`, `docs/meta-lead-ads.md`): every lead (webhook, import, reconciliation) goes through `processIngestion` in `lib/meta/ingest.ts`, which calls the Phase 1 `createOwnerLead` / `createRequirement`. Do not add a second pipeline. `wrangler.jsonc` `main` is `worker.ts`, which wraps OpenNext's worker to add the cron sweep. Locally, `META_GRAPH_BASE_URL` / `META_DIALOG_BASE_URL` can point at a localhost mock (`tests/e2e/meta-mock.ts`) in `next dev` only
- Schema changes go in `lib/db/migrations.ts` as a new version; never edit an applied migration. `audit_log` is append-only (triggers reject UPDATE/DELETE)

# AGENTS.md

GulbargaHomes is a Next.js 15 (App Router, TypeScript) + Tailwind CSS real estate site for Gulbarga (Kalaburagi), deployed to **Cloudflare Workers** with OpenNext — the same shape as HubliTaxi.

Properties live in **D1** (`DB` binding, database `gulbargahomes`). The listing desk is `/admin/properties` (password in `ADMIN_PASSWORD`). Existing photos and videos stay in `public/images` and `public/videos`. New uploads use the R2 bucket `gulbargahomes-media` (`MEDIA` binding) and are served at `/media/...`. MDX in `content/properties/` is the seed snapshot (`lib/property-seed.json`). Projects stay in `content/projects/`; design previews stay in `content/designs/`.

See `README.md` for the Cloudflare resources, secrets, and domain cutover.

## Services

- Dev server: `npm run dev` → http://localhost:3000
- Listing desk: http://localhost:3000/admin/properties (operations CRM: `/admin/today`, `/admin/owner-leads`, `/admin/requirements`, `/admin/contacts`, `/admin/team`)
- Tests: `npm test` (Node test runner + tsx, in-memory `node:sqlite` stands in for D1)
- Lint / build: `npm run lint`, `npm run build`
- Worker: `npm run preview`, `npm run deploy`
- Media: `npm run images` rebuilds WebP photos, hero assets and MP4 tours from `public/images/source/`

## Gotchas

- Link the listing desk as `/admin/properties`, not the old Decap `/admin/index.html`
- Placeholder D1 ids in `wrangler.jsonc` must be replaced after `wrangler d1 create`
- Do not commit `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET`
- A single static video must stay under 25 MiB (Cloudflare asset limit). Larger new videos belong in R2
- Pagefind search index is built in `postbuild`; property search also hits the database via `/api/search`
- City copy must mention both **Gulbarga** and **Kalaburagi**
- Public pages read listings only through `lib/properties.ts` (the `public_properties` view: Verified + Published). ESLint blocks public code from importing `@/lib/inventory`, `@/lib/crm` or `@/lib/admin`
- Schema changes go in `lib/db/migrations.ts` as a new version; never edit an applied migration. `audit_log` is append-only (triggers reject UPDATE/DELETE)

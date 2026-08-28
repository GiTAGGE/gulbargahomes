# AGENTS.md

GulbargaHomes is a Next.js 14 (App Router, TypeScript) + Tailwind CSS real estate site for Gulbarga (Kalaburagi). Listings are file-based (one MDX file per property in `content/properties/`) — there is **no database**. The admin dashboard is Decap CMS (git-based) at `/admin/index.html`.

See `README.md` for structure, scripts, Netlify domain mapping, and video uploads.

## Services

- Dev server: `npm run dev` → http://localhost:3000
- Lint / build: `npm run lint`, `npm run build`
- Media: `npm run images` rebuilds WebP photos, hero assets and MP4 tours from `public/images/source/`
- Optional: `npx decap-server` for local CMS edits

## Gotchas

- Always link the admin as `/admin/index.html`
- Property pages and SEO location pages are prerendered; unknown slugs 404
- Pagefind search index is built in `postbuild`
- Keep uploaded videos small (Netlify free git + CDN limits)
- City copy must mention both **Gulbarga** and **Kalaburagi**

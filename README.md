# GulbargaHomes

Premium real estate platform for **Gulbarga (Kalaburagi)** — rental houses, flats, independent homes, villas and residential plots. Built with **Next.js**, **Tailwind CSS**, and hosted on **Netlify** (free plan, no server, no database).

Live Netlify URL: `https://gulbarga.netlify.app`  
Custom domain (ready to map in GoDaddy / Netlify): [gulbargahomes.com](https://gulbargahomes.com)

## What this site is

GulbargaHomes is a city-only, file-based portal. Each listing is an MDX file with photos and optional **video tours**. Editors use the Decap CMS admin at `/admin/index.html` (Netlify Identity + Git Gateway). Publishing a listing commits to GitHub and rebuilds the static site.

## Tech stack

- Next.js 14 (App Router, TypeScript) — static generation
- Tailwind CSS — sandstone / terracotta palette
- MDX listings in `content/properties/`
- WebP photos + short MP4 walkthroughs
- Pagefind full-text search
- Decap CMS (git-based admin, no database)
- SEO: JSON-LD (`RealEstateAgent`, `Residence` / `LandPlot`, `VideoObject`, `FAQPage`), sitemap, robots, Gulbarga **and** Kalaburagi landing pages

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build + Pagefind |
| `npm run images` | Rebuild WebP photos, hero image and MP4 tours |
| `node scripts/generate-gulbarga-listings.mjs` | Regenerate starter listings |
| `npm run lint` | ESLint |

Admin locally: `npx decap-server`, then http://localhost:3000/admin/index.html

## Admin: photos and videos

In **Properties → Videos** you can:

1. Upload an MP4 (keep under ~8 MB on Netlify’s free plan), and/or
2. Paste a YouTube URL

Videos appear in the property gallery next to stills.

Listings are **MDX files in Git** (`content/properties/`) — there is no separate database. After you publish in admin, Netlify must **finish a deploy** before new properties appear on the live site.

## Cloudinary uploads (optional)

To upload images/videos to **Cloudinary** instead of committing large files to Git:

1. In [Cloudinary Console](https://console.cloudinary.com/) → top-left cloud name (e.g. `jzsi7rvy`).
2. **Settings → Upload → Upload presets** → **Add upload preset** → **Signing mode: Unsigned** → save the preset name.
3. **Settings → Access keys** → copy **API Key** (not the secret).
4. In **Netlify → Site → Environment variables**, add:
   - `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` = your cloud name  
   - `NEXT_PUBLIC_CLOUDINARY_API_KEY` = API key  
   - `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` = unsigned preset name  
5. Trigger a **new deploy**. Admin will upload to Cloudinary; the site stores `https://res.cloudinary.com/...` URLs in the property file.

Do **not** put the API **secret** in Netlify public env vars or in `config.yml`.

## Netlify + custom domain

The site is already connected to Netlify. After this build is live on `gulbarga.netlify.app`:

1. In Netlify: **Domain management → Add domain** → `gulbargahomes.com` and `www.gulbargahomes.com`
2. In GoDaddy DNS, point:
   - `A` record `@` → Netlify load balancer `75.2.60.5` (or the values Netlify shows)
   - `CNAME` `www` → `gulbarga.netlify.app`
3. Enable Netlify Identity **Invite only** + Git Gateway so only you can open `/admin/index.html`
4. **Identity → Configuration**: set **Site URL** to `https://gulbargahomes.com` (no `www`). Password-reset emails open `/admin/recover.html` automatically after deploy (or paste the full email link — it is converted from `#recovery_token` to a dedicated reset page).
5. Optional: set `NEXT_PUBLIC_GA4_ID` and `NEXT_PUBLIC_CLARITY_ID` in Netlify env vars

Public phone and WhatsApp are `+91 81234 50725` and `+91 84313 95255` (`lib/site.ts`).

## SEO notes

High-intent pages are prerendered, including:

- `/houses-for-rent-in-gulbarga`
- `/flats-for-rent-in-kalaburagi`
- `/plots-for-sale-in-gulbarga`
- `/houses-for-sale-in-kalaburagi`
- Locality pages such as `/rent-flat-azadpur` generated from listings

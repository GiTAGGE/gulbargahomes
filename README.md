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

## Netlify + custom domain

The site is already connected to Netlify. After this build is live on `gulbarga.netlify.app`:

1. In Netlify: **Domain management → Add domain** → `gulbargahomes.com` and `www.gulbargahomes.com`
2. In GoDaddy DNS, point:
   - `A` record `@` → Netlify load balancer `75.2.60.5` (or the values Netlify shows)
   - `CNAME` `www` → `gulbarga.netlify.app`
3. Enable Netlify Identity **Invite only** + Git Gateway so only you can open `/admin/index.html`
4. Optional: set `NEXT_PUBLIC_GA4_ID` and `NEXT_PUBLIC_CLARITY_ID` in Netlify env vars

Public phone and WhatsApp are `+91 81234 50725` (`lib/site.ts`).

## SEO notes

High-intent pages are prerendered, including:

- `/houses-for-rent-in-gulbarga`
- `/flats-for-rent-in-kalaburagi`
- `/plots-for-sale-in-gulbarga`
- `/houses-for-sale-in-kalaburagi`
- Locality pages such as `/rent-flat-azadpur` generated from listings

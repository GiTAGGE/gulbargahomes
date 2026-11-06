import { buildVideoSitemapXml, sitemapResponse } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

export async function GET() {
  return sitemapResponse(await buildVideoSitemapXml());
}

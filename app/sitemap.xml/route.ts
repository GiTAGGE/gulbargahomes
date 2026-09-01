import { buildUrlSitemapXml, sitemapResponse } from "@/lib/sitemap-xml";

export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return sitemapResponse(buildUrlSitemapXml());
}

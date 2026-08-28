import type { SiteSearchResult } from "./site-search-data";

/** Map Pagefind result paths to real Next.js routes. */
export function normalizePagefindUrl(url: string): string | null {
  let path = url;

  if (url.startsWith("http")) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }

  // Legacy index built from the whole `.next` directory.
  path = path.replace(/^\/server\/app\//, "/");

  if (path.endsWith(".html")) {
    path = path.slice(0, -5);
  }
  if (path.endsWith("/index")) {
    path = path.slice(0, -6) || "/";
  }

  if (path.includes("_not-found") || path === "/404" || path === "/500") {
    return null;
  }

  return path || "/";
}

export function normalizePagefindResult(
  result: SiteSearchResult,
): SiteSearchResult | null {
  const url = normalizePagefindUrl(result.url);
  if (!url) return null;
  return { ...result, url };
}

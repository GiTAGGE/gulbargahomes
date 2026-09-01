import { site } from "./site";

/** Turn a site-relative path or already-absolute URL into an absolute https URL. */
export function absoluteUrl(path: string): string {
  const value = path.trim();
  if (!value) return site.url;
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith("/") ? value : `/${value}`;
  return `${site.url}${normalized}`;
}

export function propertyUrl(slug: string): string {
  return `${site.url}/properties/${slug}`;
}

export function youtubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/,
  );
  return match?.[1] ?? null;
}

export function youtubeEmbedUrl(url: string): string | undefined {
  const id = youtubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : undefined;
}

export function youtubeThumbnailUrl(url: string): string | undefined {
  const id = youtubeVideoId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : undefined;
}

/** Schema.org ISO-8601 duration. Short property tours default to 6 seconds. */
export function isoDurationFromSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 6;
  if (safe < 60) return `PT${safe}S`;
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return remainder ? `PT${minutes}M${remainder}S` : `PT${minutes}M`;
}

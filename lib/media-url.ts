/** Normalize CMS media paths (local, Cloudinary, misplaced uploads). */
export function normalizeMediaUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("/")) return trimmed;

  const nested = trimmed.match(/(?:^|\/)public\/(images|videos)\/(.+)$/i);
  if (nested) {
    return `/${nested[1]}/${nested[2]}`;
  }

  return `/${trimmed.replace(/^\/+/, "")}`;
}

export function isCloudinaryUrl(value: string): boolean {
  return /res\.cloudinary\.com/i.test(value);
}

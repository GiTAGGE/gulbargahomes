/** Allow only Pagefind highlight markup in search excerpts. */
export function sanitizeSearchExcerpt(html: string): string {
  return html.replace(/<(?!\/?mark\b)[^>]*>/gi, "");
}

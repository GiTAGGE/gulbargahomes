/** Prevent `</script>` breakout when embedding JSON in a script tag. */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

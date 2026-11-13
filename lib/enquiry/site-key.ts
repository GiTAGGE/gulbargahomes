/**
 * The public Turnstile site key.
 *
 * Next replaces a direct `process.env.NEXT_PUBLIC_*` read with the value from
 * build time. Workers Builds does not see the Worker binding during that
 * build, so the direct read becomes an empty string and Save stays closed.
 * The binding is copied onto `process.env` when the Worker handles a request.
 * A computed name keeps that runtime value.
 */
const SITE_KEY_BINDING = "NEXT_PUBLIC_" + "TURNSTILE_SITE_KEY";

export function turnstileSiteKey(): string {
  const value = process.env[SITE_KEY_BINDING];
  return typeof value === "string" ? value.trim() : "";
}

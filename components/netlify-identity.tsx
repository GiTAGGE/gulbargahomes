"use client";

import Script from "next/script";

/** Loads Netlify Identity on public pages so invite/recovery links work. */
export function NetlifyIdentityWidget() {
  return (
    <>
      <Script
        src="https://identity.netlify.com/v1/netlify-identity-widget.js"
        strategy="afterInteractive"
      />
      <Script src="/identity-guard.js" strategy="afterInteractive" />
    </>
  );
}

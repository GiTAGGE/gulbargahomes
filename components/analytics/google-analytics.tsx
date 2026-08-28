import Script from "next/script";

import { GA4_MEASUREMENT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

export function GoogleAnalytics() {
  if (!isAnalyticsEnabled() || !GA4_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA4_MEASUREMENT_ID}', { send_page_view: false });
        `}
      </Script>
    </>
  );
}

import { GA4_MEASUREMENT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

export function GoogleAnalytics() {
  if (!isAnalyticsEnabled() || !GA4_MEASUREMENT_ID) return null;

  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`}
      />
      <script
        id="google-analytics"
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = gtag;
            gtag('js', new Date());
            gtag('config', '${GA4_MEASUREMENT_ID}', { send_page_view: false });
          `,
        }}
      />
    </>
  );
}

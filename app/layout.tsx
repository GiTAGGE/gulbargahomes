import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";

import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { MicrosoftClarity } from "@/components/analytics/microsoft-clarity";
import { AnalyticsPageView } from "@/components/analytics/page-view";
import { FloatingContact } from "@/components/floating-contact";
import { NetlifyIdentityWidget } from "@/components/netlify-identity";
import { HideNetlifyBadge } from "@/components/hide-netlify-badge";
import { JsonLd } from "@/components/jsonld";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { localBusinessSchema, metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

import "./globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.homeSeoTitle} | ${site.name}`,
    template: `%s | ${site.name}`,
  },
  description: metaDescription(site.description),
  keywords: [...site.keywords],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: site.url,
    siteName: site.name,
    title: site.homeSeoTitle,
    description: metaDescription(site.description),
  },
  twitter: {
    card: "summary_large_image",
    title: site.homeSeoTitle,
    description: metaDescription(site.description),
  },
  robots: { index: true, follow: true },
  other: {
    "geo.region": "IN-KA",
    "geo.placename": "Kalaburagi",
    "geo.position": `${site.geo.latitude};${site.geo.longitude}`,
    ICBM: `${site.geo.latitude}, ${site.geo.longitude}`,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN" className={sans.variable}>
      <body className="font-sans antialiased bg-surface text-ink">
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{localStorage.setItem("nl-hud:public:v1","hidden");localStorage.setItem("nl-hud:owner-private:v1","hidden");}catch(e){}})();',
          }}
        />
        <HideNetlifyBadge />
        <GoogleAnalytics />
        <MicrosoftClarity />
        <Suspense fallback={null}>
          <AnalyticsPageView />
        </Suspense>
        <JsonLd data={localBusinessSchema()} />
        <SiteHeader />
        <main className="min-h-screen overflow-x-clip pb-20 md:pb-0">{children}</main>
        <SiteFooter />
        <FloatingContact />
        <MobileBottomNav />
        <NetlifyIdentityWidget />
      </body>
    </html>
  );
}

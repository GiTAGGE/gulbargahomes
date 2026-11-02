"use client";

import { useEffect } from "react";

import { CLARITY_PROJECT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

import { useAnalyticsConsent } from "./use-analytics-consent";

export function MicrosoftClarity() {
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent === undefined || consent === "denied") return;
    if (!isAnalyticsEnabled() || !CLARITY_PROJECT_ID) return;
    if (document.getElementById("microsoft-clarity")) return;
    if (!/^[a-z0-9]+$/i.test(CLARITY_PROJECT_ID)) return;

    const script = document.createElement("script");
    script.id = "microsoft-clarity";
    script.async = true;
    script.text = `
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "${CLARITY_PROJECT_ID}");
    `;
    document.head.appendChild(script);
  }, [consent]);

  return null;
}

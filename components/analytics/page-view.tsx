"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { pageview } from "@/lib/analytics/track";

export function AnalyticsPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    pageview(query ? `${pathname}?${query}` : pathname);
  }, [pathname, searchParams]);

  return null;
}

import type { Metadata } from "next";
import { Suspense } from "react";

import { PropertyExplorer } from "@/components/property-explorer";
import { metaDescription } from "@/lib/seo";
import {
  getExplorerCanonicalPath,
  getExplorerPageCopy,
  parseExplorerFilters,
  searchParamsRecordToURLSearchParams,
  shouldNoindexExplorerFilters,
} from "@/lib/property-filters";
import { getAllProperties, getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

type SearchParams = Record<string, string | string[] | undefined>;

/** Refresh listings after CMS edits without waiting for a full redeploy. */
export const revalidate = 60;

export function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Metadata {
  const localities = getLocalities();
  const filters = parseExplorerFilters(
    searchParamsRecordToURLSearchParams(searchParams),
    localities,
  );
  const { title, description } = getExplorerPageCopy(filters);
  const trimmedDescription = metaDescription(description);
  const canonical = getExplorerCanonicalPath(filters);
  const noindex = shouldNoindexExplorerFilters(filters);

  return {
    title,
    description: trimmedDescription,
    alternates: { canonical },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      title,
      description: trimmedDescription,
      url: `${site.url}${canonical}`,
    },
  };
}

function ExplorerFallback() {
  return <div className="skeleton h-96 rounded-2xl" />;
}

export default function PropertiesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const properties = getAllProperties();
  const localities = getLocalities();
  const initial = parseExplorerFilters(
    searchParamsRecordToURLSearchParams(searchParams),
    localities,
  );
  const { heading, description } = getExplorerPageCopy(initial);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10" data-pagefind-body>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {heading}
      </h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted sm:text-base">
        {description}
      </p>
      <div className="mt-6 sm:mt-8">
        <Suspense fallback={<ExplorerFallback />}>
          <PropertyExplorer
            properties={properties}
            localities={localities}
            initial={initial}
          />
        </Suspense>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { sanitizeSearchExcerpt } from "@/lib/sanitize-html";
import { normalizePagefindResult } from "@/lib/pagefind-url";
import type { SiteSearchResult } from "@/lib/site-search-data";

import { CloseIcon, SearchIcon } from "./icons";

type PagefindAPI = {
  init: () => Promise<void>;
  search: (
    q: string,
  ) => Promise<{ results: { data: () => Promise<SiteSearchResult> }[] }>;
};

async function loadPagefind(): Promise<PagefindAPI | null> {
  if (typeof window === "undefined") return null;

  try {
    const moduleUrl = new URL("/pagefind/pagefind.js", window.location.origin).href;
    const pf = (await import(/* webpackIgnore: true */ moduleUrl)) as PagefindAPI;
    await pf.init();
    return pf;
  } catch {
    return null;
  }
}

async function searchViaApi(query: string): Promise<SiteSearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const data = (await response.json()) as { results: SiteSearchResult[] };
  return data.results;
}

export function SiteSearch({
  variant = "button",
}: {
  variant?: "button" | "hidden-trigger";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SiteSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchReady, setSearchReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pagefindRef = useRef<PagefindAPI | null>(null);
  const useApiFallbackRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setSearchReady(false);
      return;
    }

    inputRef.current?.focus();
    let cancelled = false;

    async function prepareSearch() {
      const pagefind = await loadPagefind();
      if (cancelled) return;

      if (pagefind) {
        pagefindRef.current = pagefind;
        useApiFallbackRef.current = false;
      } else {
        pagefindRef.current = null;
        useApiFallbackRef.current = true;
      }

      setSearchReady(true);
    }

    prepareSearch();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !searchReady || !query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    const trimmed = query.trim();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (useApiFallbackRef.current || !pagefindRef.current) {
          setResults(await searchViaApi(trimmed));
          return;
        }

        const search = await pagefindRef.current.search(trimmed);
        const data = await Promise.all(
          search.results.slice(0, 8).map((result) => result.data()),
        );
        setResults(
          data
            .map(normalizePagefindResult)
            .filter((result): result is SiteSearchResult => result !== null),
        );
      } catch {
        setResults(await searchViaApi(trimmed));
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, open, searchReady]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (variant === "hidden-trigger") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-ink-muted hover:bg-brand-100 transition-colors"
        aria-label="Search properties"
      >
        <SearchIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Search</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto mt-16 w-full max-w-xl px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet animate-slide-up overflow-hidden">
              <div className="flex items-center gap-3 border-b border-brand-100 px-4 py-3">
                <SearchIcon className="h-5 w-5 text-brand-600" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search properties, localities…"
                  className="flex-1 bg-transparent py-1 text-base text-ink outline-none placeholder:text-ink-faint"
                />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1.5 hover:bg-brand-50"
                  aria-label="Close search"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto p-2">
                {loading && (
                  <p className="px-3 py-4 text-sm text-ink-faint">Searching…</p>
                )}
                {!loading && query && !searchReady && (
                  <p className="px-3 py-4 text-sm text-ink-faint">Searching…</p>
                )}
                {!loading && searchReady && query && results.length === 0 && (
                  <p className="px-3 py-4 text-sm text-ink-faint">No results found.</p>
                )}
                {results.map((result) => (
                  <a
                    key={result.url}
                    href={result.url}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-3 hover:bg-brand-50 transition-colors"
                  >
                    <p className="font-semibold text-ink">
                      {result.meta.title ?? result.url}
                    </p>
                    <p
                      className="mt-0.5 text-sm text-ink-muted line-clamp-2"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeSearchExcerpt(result.excerpt),
                      }}
                    />
                  </a>
                ))}
                {!query && (
                  <p className="px-3 py-4 text-sm text-ink-faint">
                    Try &ldquo;Vidyanagar&rdquo;, &ldquo;3 BHK&rdquo;, or &ldquo;villa&rdquo;
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

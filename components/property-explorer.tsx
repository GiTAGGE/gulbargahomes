"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  countActiveExplorerFilters,
  EXPLORER_FILTER_DEFAULTS,
  explorerFiltersToQuery,
  normalizedExplorerPath,
  parseExplorerFilters,
  shouldNormalizeExplorerQuery,
  type ExplorerFilters,
} from "@/lib/property-filters";
import { localitiesMatch } from "@/lib/locality";
import { statusSortRank } from "@/lib/property-status";
import type { Property } from "@/lib/types";

import { CloseIcon, FilterIcon, SearchIcon } from "./icons";
import { PropertyCard } from "./property-card";

export type { ExplorerFilters };

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 outline-none focus:border-brand-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`chip border ${
        checked
          ? "border-brand-600 bg-brand-50 text-brand-700"
          : "border-brand-200 text-ink-muted"
      }`}
    >
      {label}
    </button>
  );
}

function FilterPanel({
  filters,
  localities,
  onUpdate,
  onReset,
}: {
  filters: ExplorerFilters;
  localities: string[];
  onUpdate: <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <Select label="Listing" value={filters.listing} options={["Any", "Rent", "Sale"]} onChange={(v) => onUpdate("listing", v)} />
      <Select label="Availability" value={filters.status} options={["Any", "Available", "Rented", "Sold"]} onChange={(v) => onUpdate("status", v)} />
      <Select label="Property type" value={filters.type} options={["Any", "House", "Flat", "Villa", "Plot", "PG", "Commercial"]} onChange={(v) => onUpdate("type", v)} />
      <Select label="Locality" value={filters.locality} options={["Any", ...localities]} onChange={(v) => onUpdate("locality", v)} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink-muted">BHK</span>
        <div className="flex flex-wrap gap-2">
          {["Any", "1", "2", "3", "4+"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onUpdate("bhk", option)}
              className={`chip border ${
                filters.bhk === option
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-brand-200 text-ink-muted"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink-muted">
          Max budget: {filters.budget === 0 ? "Any" : `\u20B9${filters.budget.toLocaleString("en-IN")}`}
        </span>
        <input
          type="range"
          min={0}
          max={20000000}
          step={1000}
          value={filters.budget}
          onChange={(event) => onUpdate("budget", Number(event.target.value))}
          className="w-full accent-brand-600"
          aria-label="Maximum budget"
        />
      </div>

      <Select label="Furnishing" value={filters.furnished} options={["Any", "Fully Furnished", "Semi Furnished", "Unfurnished"]} onChange={(v) => onUpdate("furnished", v)} />
      <Select label="Facing" value={filters.facing} options={["Any", "East", "West", "North", "South"]} onChange={(v) => onUpdate("facing", v)} />

      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink-muted">Preferences</span>
        <div className="flex flex-wrap gap-2">
          <Toggle label="Vastu" checked={filters.vastu} onChange={(v) => onUpdate("vastu", v)} />
          <Toggle label="Vegetarian" checked={filters.veg} onChange={(v) => onUpdate("veg", v)} />
          <Toggle label="Bachelor" checked={filters.bachelors} onChange={(v) => onUpdate("bachelors", v)} />
          <Toggle label="Family" checked={filters.family} onChange={(v) => onUpdate("family", v)} />
          <Toggle label="Parking" checked={filters.parking} onChange={(v) => onUpdate("parking", v)} />
        </div>
      </div>

      <button type="button" onClick={onReset} className="btn-ghost w-full justify-center">
        Reset filters
      </button>
    </div>
  );
}

function countActiveFilters(filters: ExplorerFilters): number {
  return countActiveExplorerFilters(filters);
}

export function PropertyExplorer({
  properties,
  initial,
  localities,
}: {
  properties: Property[];
  initial: ExplorerFilters;
  localities: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ExplorerFilters>(initial);
  const [sort, setSort] = useState("relevance");
  const [sheetOpen, setSheetOpen] = useState(false);

  const syncToUrl = useCallback(
    (next: ExplorerFilters) => {
      const qs = explorerFiltersToQuery(next);
      router.replace(qs ? `/properties?${qs}` : "/properties", { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    const sanitized = parseExplorerFilters(searchParams, localities);
    setFilters(sanitized);

    if (shouldNormalizeExplorerQuery(searchParams, localities)) {
      router.replace(normalizedExplorerPath(searchParams, localities), { scroll: false });
    }
  }, [searchParams, localities, router]);

  function update<K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      syncToUrl(next);
      return next;
    });
  }

  function resetFilters() {
    setFilters(EXPLORER_FILTER_DEFAULTS);
    syncToUrl(EXPLORER_FILTER_DEFAULTS);
  }

  const activeCount = countActiveFilters(filters);

  const results = useMemo(() => {
    const filtered = properties.filter((property) => {
      if (filters.listing !== "Any" && property.listing !== filters.listing)
        return false;
      if (filters.status !== "Any" && property.status !== filters.status)
        return false;
      if (filters.type !== "Any" && property.propertyType !== filters.type)
        return false;
      if (filters.locality !== "Any" && !localitiesMatch(property.locality, filters.locality))
        return false;
      if (filters.bhk !== "Any") {
        if (filters.bhk === "4+") {
          if ((property.bhk ?? 0) < 4) return false;
        } else if (String(property.bhk) !== filters.bhk) {
          return false;
        }
      }
      if (filters.budget > 0 && property.price > filters.budget) return false;
      if (filters.furnished !== "Any" && property.furnished !== filters.furnished)
        return false;
      if (filters.facing !== "Any" && property.facing !== filters.facing)
        return false;
      if (filters.vastu && !property.vastu) return false;
      if (filters.veg && property.vegetarian !== "Yes") return false;
      if (filters.bachelors && property.bachelors !== "Allowed") return false;
      if (filters.family && property.family !== "Preferred") return false;
      if (filters.parking && /^(open|none)$/i.test(property.parking))
        return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "relevance") {
      sorted.sort((a, b) => {
        const statusDiff = statusSortRank(a.status) - statusSortRank(b.status);
        if (statusDiff !== 0) return statusDiff;
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
    }
    if (sort === "price-asc") sorted.sort((a, b) => a.price - b.price);
    if (sort === "price-desc") sorted.sort((a, b) => b.price - a.price);
    if (sort === "area-desc") sorted.sort((a, b) => b.area - a.area);
    return sorted;
  }, [properties, filters, sort]);

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <aside className="card hidden h-fit space-y-4 p-5 lg:sticky lg:top-20 lg:block">
        <div className="flex items-center gap-2 font-bold text-ink">
          <SearchIcon className="h-5 w-5 text-brand-600" /> Filters
        </div>
        <FilterPanel
          filters={filters}
          localities={localities}
          onUpdate={update}
          onReset={resetFilters}
        />
      </aside>

      <div>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-soft lg:hidden"
            >
              <FilterIcon className="h-4 w-4 text-brand-600" />
              Filters
              {activeCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold text-white">
                  {activeCount}
                </span>
              )}
            </button>
            <p className="text-sm text-ink-muted">
              <span className="font-bold text-ink">{results.length}</span> properties
            </p>
          </div>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm outline-none"
            aria-label="Sort"
          >
            <option value="relevance">Relevance</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="area-desc">Largest Area</option>
          </select>
        </div>

        {results.length === 0 ? (
          <div className="card grid place-items-center p-12 text-center sm:p-16">
            <p className="text-lg font-semibold">No matching properties</p>
            <p className="mt-1 text-ink-muted">Try adjusting or resetting your filters.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {results.map((property) => (
              <PropertyCard key={property.slug} property={property} />
            ))}
          </div>
        )}
      </div>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setSheetOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 sheet animate-slide-up max-h-[85vh] flex flex-col pb-safe">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-brand-200" />
            <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
              <div className="flex items-center gap-2 font-bold text-ink">
                <FilterIcon className="h-5 w-5 text-brand-600" />
                Filters
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-full p-2 hover:bg-brand-50"
                aria-label="Close filters"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <FilterPanel
                filters={filters}
                localities={localities}
                onUpdate={update}
                onReset={resetFilters}
              />
            </div>
            <div className="border-t border-brand-100 p-4">
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="btn-primary w-full justify-center"
              >
                Show {results.length} properties
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

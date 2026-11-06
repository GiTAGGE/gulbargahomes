"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { bhkLabel, formatPrice } from "@/lib/format";
import type { Listing, Property, PropertyStatus, PropertyType } from "@/lib/types";

const listings: Array<Listing | "All"> = ["All", "Rent", "Sale"];
const statuses: Array<PropertyStatus | "All"> = ["All", "Available", "Rented", "Sold"];
const types: Array<PropertyType | "All"> = [
  "All",
  "House",
  "Flat",
  "Villa",
  "Plot",
  "Commercial",
  "PG",
];

export function PropertyTable({ properties }: { properties: Property[] }) {
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<(typeof listings)[number]>("All");
  const [status, setStatus] = useState<(typeof statuses)[number]>("All");
  const [type, setType] = useState<(typeof types)[number]>("All");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return properties.filter((property) => {
      if (listing !== "All" && property.listing !== listing) return false;
      if (status !== "All" && property.status !== status) return false;
      if (type !== "All" && property.propertyType !== type) return false;
      if (!needle) return true;
      return [property.title, property.locality, property.slug, property.propertyType]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [properties, query, listing, status, type]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, locality, or slug"
          className="rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-sm outline-none ring-brand-600 focus:ring-2"
        />
        <Select value={listing} options={listings} onChange={setListing} label="Listing" />
        <Select value={status} options={statuses} onChange={setStatus} label="Status" />
        <Select value={type} options={types} onChange={setType} label="Type" />
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        {rows.length} of {properties.length} listings
      </p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-brand-100 bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-muted">
            No listings match these filters.
          </p>
        ) : (
          <ul className="divide-y divide-brand-50">
            {rows.map((property) => (
              <li key={property.slug}>
                <Link
                  href={`/admin/properties/${property.slug}/edit`}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-brand-50/50 sm:px-4"
                >
                  <span className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-brand-50">
                    {property.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element -- admin thumbs include uploaded /media paths
                      <img
                        src={property.coverImage}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{property.title}</span>
                    <span className="mt-0.5 block truncate text-sm text-ink-muted">
                      {property.locality} · {bhkLabel(property)} · {property.propertyType}
                    </span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="block text-sm font-semibold text-ink">
                      {formatPrice(property)}
                    </span>
                    <StatusPill status={property.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="mt-1 block w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-ink outline-none ring-brand-600 focus:ring-2"
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

function StatusPill({ status }: { status: PropertyStatus }) {
  const tone =
    status === "Available"
      ? "bg-brand-50 text-brand-800"
      : status === "Rented"
        ? "bg-amber-50 text-amber-800"
        : "bg-stone-100 text-stone-600";
  return (
    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {status}
    </span>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { trackSearch } from "@/lib/analytics/track";

import { PinIcon, SearchIcon } from "./icons";

const types = ["Any", "House", "Flat", "Villa", "Plot", "PG"];

interface SearchBarProps {
  localities: string[];
}

export function SearchBar({ localities }: SearchBarProps) {
  const router = useRouter();
  const [listing, setListing] = useState("Rent");
  const [locality, setLocality] = useState("");
  const [type, setType] = useState("Any");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    params.set("listing", listing);
    if (type !== "Any") params.set("type", type);
    if (locality) params.set("locality", locality);
    const query = params.toString();
    trackSearch([locality, type !== "Any" ? type : "", listing].filter(Boolean).join(" "), "home_hero");
    router.push(`/properties?${query}`);
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto w-full max-w-4xl rounded-2xl border border-white/30 bg-white/95 p-3 shadow-lift backdrop-blur-xl sm:rounded-3xl sm:p-4"
    >
      <div className="mb-3 flex gap-2">
        {["Rent", "Sale"].map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setListing(option)}
            className={`chip ${
              listing === option
                ? "bg-brand-600 text-white"
                : "bg-brand-50 text-ink-muted"
            }`}
          >
            {option === "Rent" ? "Rent" : "Buy"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 sm:rounded-2xl">
          <PinIcon className="h-5 w-5 shrink-0 text-ink-faint" />
          <select
            value={locality}
            onChange={(event) => setLocality(event.target.value)}
            className="w-full bg-transparent py-3 text-sm text-ink outline-none"
            aria-label="Locality"
          >
            <option value="">Any locality</option>
            {localities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 sm:rounded-2xl">
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="w-full bg-transparent py-3 text-sm text-ink outline-none"
            aria-label="Property type"
          >
            {types.map((option) => (
              <option key={option} value={option}>
                {option === "Any" ? "Any type" : option}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" className="btn-primary justify-center px-6 sm:px-8">
          <SearchIcon className="h-5 w-5" />
          Search
        </button>
      </div>
    </form>
  );
}

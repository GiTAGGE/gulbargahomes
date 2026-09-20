"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { trackSearch } from "@/lib/analytics/track";

import { PinIcon, SearchIcon } from "./icons";

const types = ["Any", "House", "Flat", "Villa", "Plot", "PG"];

interface SearchBarProps {
  localities: string[];
  variant?: "default" | "overlay";
}

export function SearchBar({ localities, variant = "default" }: SearchBarProps) {
  const router = useRouter();
  const [listing, setListing] = useState("Rent");
  const [locality, setLocality] = useState("");
  const [type, setType] = useState("Any");
  const overlay = variant === "overlay";

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
      className={
        overlay
          ? "w-full rounded-2xl bg-white p-2 shadow-lift ring-1 ring-black/[0.06] sm:rounded-[1.35rem] sm:p-2.5"
          : "mx-auto w-full max-w-4xl rounded-2xl border border-white/30 bg-white/95 p-3 shadow-lift backdrop-blur-xl sm:rounded-3xl sm:p-4"
      }
    >
      <div className={overlay ? "flex flex-col gap-1.5 sm:gap-2 lg:flex-row lg:items-center" : undefined}>
        <div className={overlay ? "flex shrink-0 gap-1 rounded-full bg-brand-50 p-1" : "mb-3 flex gap-2"}>
          {["Rent", "Sale"].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setListing(option)}
              className={`chip min-h-11 ${
                overlay ? "flex-1 px-5 lg:flex-none" : ""
              } ${
                listing === option
                  ? "bg-brand-600 text-white shadow-soft"
                  : overlay
                    ? "bg-transparent text-ink-muted hover:text-ink"
                    : "bg-brand-50 text-ink-muted"
              }`}
            >
              {option === "Rent" ? "Rent" : "Buy"}
            </button>
          ))}
        </div>

        <div
          className={
            overlay
              ? "flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2"
              : "flex flex-col gap-2.5 sm:flex-row sm:gap-3"
          }
        >
          <div className={overlay ? "flex min-w-0 flex-1 gap-1.5 sm:gap-2" : "contents"}>
          <label
            className={
              overlay
                ? "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-brand-50/80 px-3 sm:rounded-2xl"
                : "flex flex-1 items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 sm:rounded-2xl"
            }
          >
            <PinIcon className="h-5 w-5 shrink-0 text-ink-faint" />
            <select
              id="hero-locality"
              name="locality"
              value={locality}
              onChange={(event) => setLocality(event.target.value)}
              className="min-h-11 w-full bg-transparent py-3 text-base text-ink outline-none"
              aria-label="Locality"
            >
              <option value="">Any locality</option>
              {localities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label
            className={
              overlay
                ? "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-brand-50/80 px-3 sm:rounded-2xl"
                : "flex flex-1 items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 sm:rounded-2xl"
            }
          >
            <select
              id="hero-property-type"
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="min-h-11 w-full bg-transparent py-3 text-base text-ink outline-none"
              aria-label="Property type"
            >
              {types.map((option) => (
                <option key={option} value={option}>
                  {option === "Any" ? "Any type" : option}
                </option>
              ))}
            </select>
          </label>
          </div>

          <button
            type="submit"
            className={`btn-primary justify-center ${overlay ? "w-full px-4 sm:w-auto sm:min-w-[8.5rem] sm:px-7" : "px-6 sm:px-8"}`}
          >
            <SearchIcon className="h-5 w-5" />
            Search
          </button>
        </div>
      </div>
    </form>
  );
}

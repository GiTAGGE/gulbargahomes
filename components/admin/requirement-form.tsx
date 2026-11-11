"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  FURNISHING_PREFERENCES,
  PROPERTY_TYPES,
  TENANT_PROFILES,
  TIMELINES,
  VEGETARIAN_PREFERENCES,
} from "@/lib/crm/options";

import { ContactFields, EMPTY_CONTACT, EMPTY_SOURCE, FormSection, SourceFields, sourcePayload } from "./lead-form-parts";
import { inputClass, labelClass } from "./ui";

const num = (value: string) => (value.trim() ? Number(value) : null);

export function RequirementForm({ localities }: { localities: string[] }) {
  const router = useRouter();
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [source, setSource] = useState(EMPTY_SOURCE);
  const [intent, setIntent] = useState<"Rent" | "Buy">("Rent");
  const [types, setTypes] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [place, setPlace] = useState("");
  const [fields, setFields] = useState({
    bhkMin: "",
    bhkMax: "",
    budgetMin: "",
    budgetMax: "",
    areaMin: "",
    furnishing: "Any",
    tenantProfile: "Any",
    vegetarian: "Any",
    timeline: "Within 30 days",
    neededBy: "",
    notes: "",
    localityFlexible: false,
    parkingRequired: false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof fields>) => setFields((current) => ({ ...current, ...patch }));

  function addPlace() {
    const value = place.trim();
    if (value && !places.includes(value)) setPlaces([...places, value]);
    setPlace("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/admin/requirements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contact,
        source: sourcePayload(source),
        requirement: {
          intent,
          propertyTypes: types,
          localities: place.trim() && !places.includes(place.trim()) ? [...places, place.trim()] : places,
          bhkMin: num(fields.bhkMin),
          bhkMax: num(fields.bhkMax),
          budgetMin: num(fields.budgetMin),
          budgetMax: num(fields.budgetMax),
          areaMin: num(fields.areaMin),
          furnishing: fields.furnishing,
          tenantProfile: intent === "Rent" ? fields.tenantProfile : "Any",
          vegetarian: fields.vegetarian,
          timeline: fields.timeline,
          neededBy: fields.neededBy ? `${fields.neededBy}T12:00:00+05:30` : null,
          notes: fields.notes,
          localityFlexible: fields.localityFlexible,
          parkingRequired: fields.parkingRequired,
        },
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; requirement?: { id: string } };
    setPending(false);
    if (!response.ok || !data.requirement) {
      setError(data.error || "Could not save this requirement.");
      return;
    }
    router.push(`/admin/requirements/${data.requirement.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <FormSection title="Person looking">
        <ContactFields value={contact} onChange={setContact} />
      </FormSection>

      <FormSection title="What they need">
        <div className="space-y-4">
          <div className="flex gap-2">
            {(["Rent", "Buy"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setIntent(item)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                  intent === item ? "bg-brand-700 text-white" : "bg-brand-50 text-ink"
                }`}
              >
                {item === "Rent" ? "To rent" : "To buy"}
              </button>
            ))}
          </div>
          <div>
            <p className={labelClass}>Property types (any if none chosen)</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PROPERTY_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={types.includes(type)}
                  onClick={() => setTypes(types.includes(type) ? types.filter((item) => item !== type) : [...types, type])}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    types.includes(type) ? "bg-brand-700 text-white" : "bg-white text-ink ring-1 ring-brand-100"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={labelClass}>
              BHK from
              <input type="number" min={0} max={10} value={fields.bhkMin} onChange={(event) => set({ bhkMin: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              BHK to
              <input type="number" min={0} max={10} value={fields.bhkMax} onChange={(event) => set({ bhkMax: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              {intent === "Buy" ? "Purchase budget from (₹)" : "Monthly rent from (₹)"}
              <input type="number" min={0} value={fields.budgetMin} onChange={(event) => set({ budgetMin: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              {intent === "Buy" ? "Purchase budget up to (₹)" : "Monthly rent up to (₹)"}
              <input type="number" min={0} value={fields.budgetMax} onChange={(event) => set({ budgetMax: event.target.value })} className={inputClass} />
            </label>
          </div>
          <div>
            <p className={labelClass}>Preferred localities</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {places.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPlaces(places.filter((entry) => entry !== item))}
                  className="rounded-full bg-brand-50 px-3 py-1 text-xs text-ink"
                  title="Remove"
                >
                  {item} ×
                </button>
              ))}
            </div>
            <div className="mt-1 flex gap-2">
              <input
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addPlace();
                  }
                }}
                list="requirement-localities"
                placeholder="Type a locality and press Enter"
                className={inputClass}
              />
              <button type="button" className="btn-ghost mt-1 shrink-0" onClick={addPlace}>
                Add
              </button>
              <datalist id="requirement-localities">
                {localities.map((locality) => (
                  <option key={locality} value={locality} />
                ))}
              </datalist>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={fields.localityFlexible} onChange={(event) => set({ localityFlexible: event.target.checked })} />
              Nearby areas are fine
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              How soon
              <select value={fields.timeline} onChange={(event) => set({ timeline: event.target.value })} className={inputClass}>
                {TIMELINES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Needed by (optional)
              <input type="date" value={fields.neededBy} onChange={(event) => set({ neededBy: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Min area (sqft)
              <input type="number" min={0} value={fields.areaMin} onChange={(event) => set({ areaMin: event.target.value })} className={inputClass} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Furnishing
              <select value={fields.furnishing} onChange={(event) => set({ furnishing: event.target.value })} className={inputClass}>
                {FURNISHING_PREFERENCES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            {intent === "Rent" && (
              <label className={labelClass}>
                Tenant profile
                <select value={fields.tenantProfile} onChange={(event) => set({ tenantProfile: event.target.value })} className={inputClass}>
                  {TENANT_PROFILES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            )}
            <label className={labelClass}>
              Vegetarian
              <select value={fields.vegetarian} onChange={(event) => set({ vegetarian: event.target.value })} className={inputClass}>
                {VEGETARIAN_PREFERENCES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={fields.parkingRequired} onChange={(event) => set({ parkingRequired: event.target.checked })} />
            Needs parking
          </label>
          <label className={labelClass}>
            Notes
            <textarea value={fields.notes} onChange={(event) => set({ notes: event.target.value })} rows={3} className={inputClass} />
          </label>
        </div>
      </FormSection>

      <FormSection title="Source" hint="Keeps campaign results measurable.">
        <SourceFields value={source} onChange={setSource} />
      </FormSection>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save requirement"}
      </button>
    </form>
  );
}

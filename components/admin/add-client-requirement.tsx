"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PROPERTY_TYPES, TIMELINES } from "@/lib/crm/options";

import { inputClass, labelClass } from "./ui";

type Mode = "buy" | "rent" | "both";

type RequirementSummary = {
  id: string;
  code: string;
  intent: string;
  status: string;
  budgetLabel: string;
  fromThisLead: boolean;
};

const blank = () => ({
  propertyType: "",
  locality: "",
  budgetMin: "",
  budgetMax: "",
  timeline: "Exploring",
  notes: "",
});

function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payload(fields: ReturnType<typeof blank>, localities: string[]) {
  const locality = fields.locality.trim();
  return {
    propertyTypes: fields.propertyType ? [fields.propertyType] : [],
    localities: locality ? [locality] : [],
    budgetMin: fields.budgetMin.trim() ? Number(fields.budgetMin) : null,
    budgetMax: fields.budgetMax.trim() ? Number(fields.budgetMax) : null,
    timeline: fields.timeline,
    notes: fields.notes,
    localityFlexible: localities.length === 0 && !locality,
  };
}

export function AddClientRequirement({
  ownerLeadId,
  canEdit,
  localities,
  requirements,
}: {
  ownerLeadId: string;
  canEdit: boolean;
  localities: string[];
  requirements: RequirementSummary[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [key, setKey] = useState(newKey);
  const [buy, setBuy] = useState(blank);
  const [rent, setRent] = useState(blank);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function open(next: Mode) {
    if (mode || pending) return;
    setMode(next);
    setKey(newKey());
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!mode || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/owner-leads/${ownerLeadId}/requirements`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          idempotencyKey: key,
          buy: mode === "rent" ? undefined : payload(buy, localities),
          rent: mode === "buy" ? undefined : payload(rent, localities),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "That requirement was not saved. Save again to retry this submission.");
        return;
      }
      setMode(null);
      setBuy(blank());
      setRent(blank());
      setKey(newKey());
      router.refresh();
    } catch {
      setError("The connection failed before the result came back. Save again to retry this same submission.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Use this when the owner also wants to buy or rent. It keeps this owner lead as it is and does not create a property.
      </p>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => open("buy")} disabled={mode !== null || pending}>
            Add Buyer Requirement
          </button>
          <button type="button" className="btn-ghost" onClick={() => open("rent")} disabled={mode !== null || pending}>
            Add Tenant Requirement
          </button>
          <button type="button" className="btn-ghost" onClick={() => open("both")} disabled={mode !== null || pending}>
            Add Both Requirements
          </button>
        </div>
      )}
      {canEdit && mode && (
        <form className="space-y-4 rounded-xl bg-surface-muted/60 p-3" onSubmit={submit}>
          {(mode === "buy" || mode === "both") && (
            <Fields title="Buyer requirement" budgetLabel="Purchase budget (₹)" listId="buy-localities" fields={buy} localities={localities} onChange={setBuy} />
          )}
          {(mode === "rent" || mode === "both") && (
            <Fields title="Tenant requirement" budgetLabel="Monthly rent (₹)" listId="rent-localities" fields={rent} localities={localities} onChange={setRent} />
          )}
          {error && <p className="text-sm text-red-700">{error} Cancel starts a new submission.</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Saving…" : "Save requirement"}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMode(null)} disabled={pending}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {requirements.length === 0 ? (
        <p className="text-sm text-ink-muted">No buyer or tenant requirements for this person yet.</p>
      ) : (
        <ul className="divide-y divide-brand-50">
          {requirements.map((item) => (
            <li key={item.id} className="py-2 text-sm">
              <Link href={`/admin/requirements/${item.id}`} className="font-semibold text-brand-800 hover:underline">
                {item.code} · {item.intent} · {item.budgetLabel}
              </Link>
              <p className="text-xs text-ink-muted">
                {item.status}
                {item.fromThisLead ? " · added from this owner lead" : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fields({
  title,
  budgetLabel,
  listId,
  fields,
  localities,
  onChange,
}: {
  title: string;
  budgetLabel: string;
  listId: string;
  fields: ReturnType<typeof blank>;
  localities: string[];
  onChange: (next: ReturnType<typeof blank>) => void;
}) {
  const set = (patch: Partial<ReturnType<typeof blank>>) => onChange({ ...fields, ...patch });
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-ink">{title}</legend>
      <label className={labelClass}>
        Property type
        <select className={inputClass} value={fields.propertyType} onChange={(event) => set({ propertyType: event.target.value })}>
          <option value="">Not known yet</option>
          {PROPERTY_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Preferred location
        <input className={inputClass} list={listId} value={fields.locality} onChange={(event) => set({ locality: event.target.value })} />
        <datalist id={listId}>
          {localities.map((locality) => (
            <option key={locality} value={locality} />
          ))}
        </datalist>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          {budgetLabel} from
          <input className={inputClass} inputMode="numeric" value={fields.budgetMin} onChange={(event) => set({ budgetMin: event.target.value })} />
        </label>
        <label className={labelClass}>
          to
          <input className={inputClass} inputMode="numeric" value={fields.budgetMax} onChange={(event) => set({ budgetMax: event.target.value })} />
        </label>
      </div>
      <label className={labelClass}>
        Timeline
        <select className={inputClass} value={fields.timeline} onChange={(event) => set({ timeline: event.target.value })}>
          {TIMELINES.map((timeline) => (
            <option key={timeline}>{timeline}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Preferences
        <textarea className={inputClass} rows={2} value={fields.notes} onChange={(event) => set({ notes: event.target.value })} />
      </label>
    </fieldset>
  );
}

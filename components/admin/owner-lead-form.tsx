"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PRIORITIES, PROPERTY_TYPES, type Priority } from "@/lib/crm/options";

import {
  ContactFields,
  EMPTY_CONTACT,
  EMPTY_SOURCE,
  FormSection,
  SourceFields,
  sourcePayload,
} from "./lead-form-parts";
import { inputClass, labelClass } from "./ui";

export function OwnerLeadForm({ localities }: { localities: string[] }) {
  const router = useRouter();
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [source, setSource] = useState(EMPTY_SOURCE);
  const [lead, setLead] = useState({
    intent: "Rent",
    propertyType: "",
    locality: "",
    locationText: "",
    expectedPrice: "",
    priority: "Warm" as Priority,
    notes: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/admin/owner-leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contact,
        lead: { ...lead, expectedPrice: lead.expectedPrice ? Number(lead.expectedPrice) : null },
        source: sourcePayload(source),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; lead?: { id: string } };
    setPending(false);
    if (!response.ok || !data.lead) {
      setError(data.error || "Could not save this lead.");
      return;
    }
    router.push(`/admin/owner-leads/${data.lead.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <FormSection title="Owner">
        <ContactFields value={contact} onChange={setContact} />
      </FormSection>
      <FormSection
        title="What they offered"
        hint="A lead is only the owner’s interest. The property record is created later, by staff, after you speak to them."
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Wants to
              <select value={lead.intent} onChange={(event) => setLead({ ...lead, intent: event.target.value })} className={inputClass}>
                <option value="Rent">Rent it out</option>
                <option value="Sale">Sell</option>
              </select>
            </label>
            <label className={labelClass}>
              Property type
              <select
                value={lead.propertyType}
                onChange={(event) => setLead({ ...lead, propertyType: event.target.value })}
                className={inputClass}
              >
                <option value="">Not known yet</option>
                {PROPERTY_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Priority
              <select
                value={lead.priority}
                onChange={(event) => setLead({ ...lead, priority: event.target.value as Priority })}
                className={inputClass}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Locality
              <input
                value={lead.locality}
                onChange={(event) => setLead({ ...lead, locality: event.target.value })}
                list="owner-lead-localities"
                className={inputClass}
              />
              <datalist id="owner-lead-localities">
                {localities.map((locality) => (
                  <option key={locality} value={locality} />
                ))}
              </datalist>
            </label>
            <label className={labelClass}>
              Expected rent or price (₹)
              <input
                type="number"
                min={0}
                value={lead.expectedPrice}
                onChange={(event) => setLead({ ...lead, expectedPrice: event.target.value })}
                className={inputClass}
              />
            </label>
          </div>
          <label className={labelClass}>
            Location as the owner wrote it
            <input
              value={lead.locationText}
              onChange={(event) => setLead({ ...lead, locationText: event.target.value })}
              placeholder="e.g. near Sedam Road, behind the temple"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Notes
            <textarea value={lead.notes} onChange={(event) => setLead({ ...lead, notes: event.target.value })} rows={3} className={inputClass} />
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
        {pending ? "Saving…" : "Save owner lead"}
      </button>
    </form>
  );
}

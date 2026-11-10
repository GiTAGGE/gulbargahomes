"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LEAD_CHANNEL_LABEL, LEAD_CHANNELS, type LeadChannel } from "@/lib/crm/options";

import { inputClass, labelClass } from "./ui";

export type ContactDraft = { name: string; phone: string; email: string };
export type SourceDraft = {
  channel: LeadChannel;
  platform: string;
  metaLeadId: string;
  metaFormName: string;
  metaCampaignName: string;
  metaAdsetName: string;
  metaAdName: string;
  utmSource: string;
  utmCampaign: string;
  submittedAt: string;
};

export const EMPTY_CONTACT: ContactDraft = { name: "", phone: "", email: "" };
export const EMPTY_SOURCE: SourceDraft = {
  channel: "meta_lead_form",
  platform: "",
  metaLeadId: "",
  metaFormName: "",
  metaCampaignName: "",
  metaAdsetName: "",
  metaAdName: "",
  utmSource: "",
  utmCampaign: "",
  submittedAt: "",
};

type ExistingContact = { id: string; code: string; name: string; isOwner: boolean; isSeeker: boolean };

export function ContactFields({ value, onChange }: { value: ContactDraft; onChange: (value: ContactDraft) => void }) {
  const [existing, setExisting] = useState<ExistingContact | null>(null);
  const digits = value.phone.replace(/\D/g, "");

  useEffect(() => {
    if (digits.length < 10) {
      setExisting(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/admin/contacts?phone=${encodeURIComponent(digits)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { contact: null }))
        .then((data: { contact: ExistingContact | null }) => setExisting(data.contact))
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [digits]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Mobile number
          <input
            value={value.phone}
            onChange={(event) => onChange({ ...value, phone: event.target.value })}
            inputMode="tel"
            placeholder="98450 12345"
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Name
          <input
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            required
            className={inputClass}
          />
        </label>
      </div>
      {existing && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This number is already{" "}
          <Link href={`/admin/contacts/${existing.id}`} target="_blank" className="font-semibold underline">
            {existing.code} {existing.name}
          </Link>
          {existing.isOwner ? " (owner)" : ""}
          {existing.isSeeker ? " (looking for property)" : ""}. The new lead will be added to that person; their name stays as
          it is.
        </p>
      )}
      <label className={labelClass}>
        Email (optional)
        <input
          type="email"
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
          className={inputClass}
        />
      </label>
    </div>
  );
}

export function SourceFields({ value, onChange }: { value: SourceDraft; onChange: (value: SourceDraft) => void }) {
  const set = (patch: Partial<SourceDraft>) => onChange({ ...value, ...patch });
  const meta = value.channel === "meta_lead_form";
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Where the lead came from
          <select value={value.channel} onChange={(event) => set({ channel: event.target.value as LeadChannel })} className={inputClass}>
            {LEAD_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {LEAD_CHANNEL_LABEL[channel]}
              </option>
            ))}
          </select>
        </label>
        {meta && (
          <label className={labelClass}>
            Platform
            <select value={value.platform} onChange={(event) => set({ platform: event.target.value })} className={inputClass}>
              <option value="">Not known</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
        )}
      </div>
      {meta && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Campaign
              <input value={value.metaCampaignName} onChange={(event) => set({ metaCampaignName: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Ad set
              <input value={value.metaAdsetName} onChange={(event) => set({ metaAdsetName: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Ad
              <input value={value.metaAdName} onChange={(event) => set({ metaAdName: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Form name
              <input value={value.metaFormName} onChange={(event) => set({ metaFormName: event.target.value })} className={inputClass} />
            </label>
            <label className={labelClass}>
              Meta lead ID
              <input
                value={value.metaLeadId}
                onChange={(event) => set({ metaLeadId: event.target.value })}
                placeholder="Prevents importing the same lead twice"
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Submitted on
              <input type="date" value={value.submittedAt} onChange={(event) => set({ submittedAt: event.target.value })} className={inputClass} />
            </label>
          </div>
        </>
      )}
      {(value.channel === "website" || value.channel === "referral") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            UTM source
            <input value={value.utmSource} onChange={(event) => set({ utmSource: event.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            UTM campaign
            <input value={value.utmCampaign} onChange={(event) => set({ utmCampaign: event.target.value })} className={inputClass} />
          </label>
        </div>
      )}
    </div>
  );
}

export function sourcePayload(source: SourceDraft) {
  return {
    ...source,
    metaLeadId: source.metaLeadId.trim() || null,
    submittedAt: source.submittedAt ? `${source.submittedAt}T12:00:00+05:30` : null,
  };
}

export function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-4 shadow-soft sm:p-5">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

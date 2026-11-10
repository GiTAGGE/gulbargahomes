"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Contact } from "@/lib/crm/contacts";

import { inputClass, labelClass } from "./ui";

export function ContactEditor({ contact, canEditPhone }: { contact: Contact; canEditPhone: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    name: contact.name,
    phone: contact.phone,
    altPhone: contact.altPhone,
    whatsapp: contact.whatsapp,
    email: contact.email,
    language: contact.language,
    notes: contact.notes,
    doNotContact: contact.doNotContact,
    doNotContactReason: contact.doNotContactReason,
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    setPending(true);
    setMessage(null);
    const body: Record<string, unknown> = {
      name: draft.name,
      language: draft.language,
      notes: draft.notes,
      doNotContact: draft.doNotContact,
      doNotContactReason: draft.doNotContactReason,
      rowVersion: contact.rowVersion,
    };
    if (canEditPhone) Object.assign(body, { phone: draft.phone, altPhone: draft.altPhone, whatsapp: draft.whatsapp, email: draft.email });
    const response = await fetch(`/api/admin/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) return setMessage({ tone: "error", text: data.error || "Could not save." });
    setMessage({ tone: "ok", text: "Saved." });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <label className={labelClass}>
        Name
        <input value={draft.name} onChange={(event) => set({ name: event.target.value })} className={inputClass} />
      </label>
      {canEditPhone && (
        <>
          <label className={labelClass}>
            Mobile
            <input value={draft.phone} onChange={(event) => set({ phone: event.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            WhatsApp (if different)
            <input value={draft.whatsapp} onChange={(event) => set({ whatsapp: event.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            Other number
            <input value={draft.altPhone} onChange={(event) => set({ altPhone: event.target.value })} className={inputClass} />
          </label>
          <label className={labelClass}>
            Email
            <input value={draft.email} onChange={(event) => set({ email: event.target.value })} className={inputClass} />
          </label>
        </>
      )}
      <label className={labelClass}>
        Preferred language
        <input
          value={draft.language}
          onChange={(event) => set({ language: event.target.value })}
          placeholder="Kannada, Hindi, English, Urdu…"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Notes
        <textarea value={draft.notes} onChange={(event) => set({ notes: event.target.value })} rows={3} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={draft.doNotContact} onChange={(event) => set({ doNotContact: event.target.checked })} />
        Do not contact
      </label>
      {draft.doNotContact && (
        <input
          value={draft.doNotContactReason}
          onChange={(event) => set({ doNotContactReason: event.target.value })}
          placeholder="Reason"
          className={inputClass}
        />
      )}
      {message && (
        <p className={`rounded-lg px-3 py-2 text-xs ${message.tone === "ok" ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}
      <button type="button" className="btn-primary w-full" disabled={pending} onClick={() => void save()}>
        {pending ? "Saving…" : "Save contact"}
      </button>
    </div>
  );
}

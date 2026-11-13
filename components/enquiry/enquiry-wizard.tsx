"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { CloseIcon, WhatsAppIcon } from "@/components/icons";
import { trackWhatsAppClick } from "@/lib/analytics/track";
import {
  BUYER_TYPES,
  FURNISHING_OPTIONS,
  TENANT_OPTIONS,
  TIMELINE_OPTIONS,
  bhkApplies,
  draftFromLaunch,
  newIdempotencyKey,
  ownerPayload,
  requirementPayload,
  stepError,
  stepsFor,
  summaryLines,
  whatsAppSummary,
  type EnquiryLaunch,
  type WizardDraft,
} from "@/lib/enquiry/wizard";
import { whatsAppHref } from "@/lib/services";
import { site } from "@/lib/site";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void },
  ) => string;
  reset: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function Chip({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
        selected ? "border-brand-700 bg-brand-700 text-white" : "border-brand-200 bg-white text-ink hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}

export function EnquiryWizard({ launch, onClose }: { launch: EnquiryLaunch; onClose: () => void }) {
  const pathname = usePathname();
  const titleId = useId();
  const [draft, setDraft] = useState<WizardDraft>(() => draftFromLaunch(launch));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [established, setEstablished] = useState<boolean | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [result, setResult] = useState<{ code: string; summary: string } | null>(null);
  const idempotencyKey = useRef(newIdempotencyKey());
  const turnstileHost = useRef<HTMLDivElement>(null);
  const page = launch.page || pathname || "/";
  const steps = stepsFor(draft);
  const step = result ? "success" : steps[Math.min(index, steps.length - 1)];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void refreshAttribution(setEstablished);
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (step !== "contact" || !TURNSTILE_SITE_KEY || !turnstileHost.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || !turnstileHost.current || !window.turnstile) return;
      widgetId = window.turnstile.render(turnstileHost.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: setTurnstileToken,
        "expired-callback": () => setTurnstileToken(""),
      });
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      document.body.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    };
  }, [step]);

  function update(patch: Partial<WizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    if (patch.path) setIndex(0);
    setError(null);
  }

  function continueStep() {
    const problem = stepError(draft, step);
    if (problem) {
      setError(problem);
      return;
    }
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  async function submit() {
    const problem = stepError(draft, "contact");
    if (problem) {
      setError(problem);
      return;
    }
    if (!TURNSTILE_SITE_KEY) {
      setError("Enquiry saving is not open until the site check is configured. Please call us instead.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the site check before sending.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ready = await refreshAttribution(setEstablished);
      const context = { ...launch, page };
      const body =
        draft.path === "owner"
          ? ownerPayload(draft, context, idempotencyKey.current, turnstileToken)
          : requirementPayload(draft, context, idempotencyKey.current, turnstileToken);
      const response = await fetch(draft.path === "owner" ? "/api/enquiries/owner" : "/api/enquiries/requirement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok?: boolean; code?: string; error?: string };
      if (!response.ok || !payload.code) {
        setError(payload.error || "The enquiry could not be saved. You can try again with the same details.");
        return;
      }
      const summary = whatsAppSummary(payload.code, summaryLines(draft));
      setResult({ code: payload.code, summary });
      if (!ready) setEstablished(false);
    } catch {
      setError("The enquiry could not be saved. You can try again with the same details.");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = steps.filter((item) => item !== "success");
  const progressIndex = Math.max(0, progress.findIndex((item) => item === step));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="mb-16 flex max-h-[78svh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-lift sm:mb-0 sm:max-h-[92svh] sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-brand-100 px-5 py-4">
          <div>
            <p id={titleId} className="text-base font-bold text-ink">
              {step === "success" ? "Enquiry saved" : "Send an enquiry"}
            </p>
            <p className="text-xs text-ink-muted">Gulbarga (Kalaburagi)</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-brand-50" aria-label="Close enquiry">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        {step !== "success" && (
          <div className="flex gap-1 px-5 pt-3" aria-hidden="true">
            {progress.map((item, itemIndex) => (
              <span key={item} className={`h-1 flex-1 rounded-full ${itemIndex <= progressIndex ? "bg-brand-600" : "bg-brand-100"}`} />
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === "path" && (
            <div className="grid gap-3">
              <p className="text-sm text-ink-muted">What would you like to do?</p>
              <Chip selected={draft.path === "buyer"} onClick={() => update({ path: "buyer" })}>
                I want to buy or rent
              </Chip>
              <Chip selected={draft.path === "owner"} onClick={() => update({ path: "owner" })}>
                I own a property
              </Chip>
              <Link href="/agricultural-land-joint-venture" className="btn-ghost justify-center" onClick={onClose}>
                Agricultural land joint venture
              </Link>
            </div>
          )}
          {step === "need" && draft.path === "buyer" && (
            <fieldset className="grid gap-4">
              <legend className="text-sm font-semibold text-ink">What are you looking for?</legend>
              <div className="flex flex-wrap gap-2">
                {(["Buy", "Rent"] as const).map((intent) => (
                  <Chip key={intent} selected={draft.intent === intent} onClick={() => update({ intent })}>
                    {intent}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {BUYER_TYPES.map((type) => (
                  <Chip key={type} selected={draft.propertyType === type} onClick={() => update({ propertyType: type })}>
                    {type}
                  </Chip>
                ))}
              </div>
              {bhkApplies(draft.propertyType) && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-ink-muted">
                    Minimum BHK
                    <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.bhkMin} onChange={(event) => update({ bhkMin: event.target.value })} />
                  </label>
                  <label className="text-sm text-ink-muted">
                    Maximum BHK
                    <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.bhkMax} onChange={(event) => update({ bhkMax: event.target.value })} />
                  </label>
                </div>
              )}
            </fieldset>
          )}
          {step === "need" && draft.path === "owner" && (
            <fieldset className="grid gap-4">
              <legend className="text-sm font-semibold text-ink">What do you want to do with the property?</legend>
              <div className="flex flex-wrap gap-2">
                {(["Rent", "Sale", "Lease"] as const).map((intent) => (
                  <Chip key={intent} selected={draft.ownerIntent === intent} onClick={() => update({ ownerIntent: intent })}>
                    {intent}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {BUYER_TYPES.map((type) => (
                  <Chip key={type} selected={draft.propertyType === type} onClick={() => update({ propertyType: type })}>
                    {type}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          {step === "place" && draft.path === "buyer" && (
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-ink">Where in Gulbarga (Kalaburagi)?</legend>
              <div className="flex flex-wrap gap-2">
                {site.localities.map((locality) => (
                  <Chip
                    key={locality}
                    selected={draft.localities.includes(locality)}
                    onClick={() =>
                      update({
                        localities: draft.localities.includes(locality)
                          ? draft.localities.filter((item) => item !== locality)
                          : [...draft.localities, locality],
                      })
                    }
                  >
                    {locality}
                  </Chip>
                ))}
              </div>
              <label className="text-sm text-ink-muted">
                Another locality
                <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" value={draft.otherLocality} onChange={(event) => update({ otherLocality: event.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={draft.flexibleLocality} onChange={(event) => update({ flexibleLocality: event.target.checked })} />
                I am also open to other localities
              </label>
            </fieldset>
          )}
          {step === "place" && draft.path === "owner" && (
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-ink">Where is the property?</legend>
              <label className="text-sm text-ink-muted">
                Locality in Gulbarga (Kalaburagi)
                <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" value={draft.otherLocality || draft.localities[0] || ""} onChange={(event) => update({ localities: [], otherLocality: event.target.value })} />
              </label>
              <label className="text-sm text-ink-muted">
                Full location
                <textarea className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" rows={3} value={draft.locationText} onChange={(event) => update({ locationText: event.target.value })} />
              </label>
            </fieldset>
          )}
          {step === "budget" && (
            <fieldset className="grid gap-4">
              <legend className="text-sm font-semibold text-ink">
                {draft.path === "owner"
                  ? draft.ownerIntent === "Rent"
                    ? "Expected monthly rent"
                    : "Expected price"
                  : draft.intent === "Rent"
                    ? "Monthly rent budget"
                    : "Purchase budget"}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-ink-muted">
                  {draft.path === "owner" ? "Amount" : "From"}
                  <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.budgetMin} onChange={(event) => update({ budgetMin: event.target.value })} />
                </label>
                {draft.path === "buyer" && (
                  <label className="text-sm text-ink-muted">
                    To
                    <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.budgetMax} onChange={(event) => update({ budgetMax: event.target.value })} />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {TIMELINE_OPTIONS.map((timeline) => (
                  <Chip key={timeline} selected={draft.timeline === timeline} onClick={() => update({ timeline })}>
                    {timeline}
                  </Chip>
                ))}
              </div>
              {draft.path === "owner" && (
                <label className="text-sm text-ink-muted">
                  Additional information
                  <textarea className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" rows={3} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} />
                </label>
              )}
            </fieldset>
          )}
          {step === "preferences" && (
            <fieldset className="grid gap-4">
              <legend className="text-sm font-semibold text-ink">Preferences</legend>
              <div className="flex flex-wrap gap-2">
                {FURNISHING_OPTIONS.map((furnishing) => (
                  <Chip key={furnishing} selected={draft.furnishing === furnishing} onClick={() => update({ furnishing })}>
                    {furnishing}
                  </Chip>
                ))}
              </div>
              {draft.intent === "Rent" && (
                <div className="flex flex-wrap gap-2">
                  {TENANT_OPTIONS.map((profile) => (
                    <Chip key={profile} selected={draft.tenantProfile === profile} onClick={() => update({ tenantProfile: profile })}>
                      {profile}
                    </Chip>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Chip selected={draft.parking === "Yes"} onClick={() => update({ parking: "Yes" })}>
                  Parking needed
                </Chip>
                <Chip selected={draft.parking === "No"} onClick={() => update({ parking: "No" })}>
                  Parking not needed
                </Chip>
              </div>
              <label className="text-sm text-ink-muted">
                Minimum area (sq ft)
                <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.area} onChange={(event) => update({ area: event.target.value })} />
              </label>
            </fieldset>
          )}
          {step === "contact" && (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="text-sm text-ink-muted">
                Name
                <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" value={draft.name} onChange={(event) => update({ name: event.target.value })} autoComplete="name" />
              </label>
              <div className="grid grid-cols-[5.5rem_1fr] gap-3">
                <label className="text-sm text-ink-muted">
                  Code
                  <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="numeric" value={draft.countryCode} onChange={(event) => update({ countryCode: event.target.value })} aria-label="Country code" />
                </label>
                <label className="text-sm text-ink-muted">
                  Mobile
                  <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" inputMode="tel" value={draft.mobile} onChange={(event) => update({ mobile: event.target.value })} autoComplete="tel-national" />
                </label>
              </div>
              <label className="text-sm text-ink-muted">
                Email (optional)
                <input className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-3" type="email" value={draft.email} onChange={(event) => update({ email: event.target.value })} autoComplete="email" />
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={draft.privacyAccepted} onChange={(event) => update({ privacyAccepted: event.target.checked })} />
                <span>
                  I understand this enquiry is saved so GulbargaHomes can reply. It is not only a WhatsApp chat.{" "}
                  <Link href="/privacy-policy" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                    Privacy Policy
                  </Link>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={draft.marketingConsent} onChange={(event) => update({ marketingConsent: event.target.checked })} />
                <span>Send me occasional property updates. This is optional.</span>
              </label>
              {established === false && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  We could not confirm your first visit. This enquiry will be saved with first-touch attribution marked unverified.
                </p>
              )}
              {!TURNSTILE_SITE_KEY && (
                <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink">
                  Enquiry saving is not open until the site check is configured. You can still call {site.phoneDisplay}.
                </p>
              )}
              <div ref={turnstileHost} />
              <input
                className="hidden"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                name="company"
                value={draft.company}
                onChange={(event) => update({ company: event.target.value })}
              />
            </form>
          )}
          {step === "success" && result && (
            <div className="grid gap-4">
              <p className="text-sm leading-relaxed text-ink">
                Your enquiry is saved. The reference is <span className="font-bold">{result.code}</span>. WhatsApp does not send this for you. Open a chat, check the summary, then press send there.
              </p>
              <pre className="whitespace-pre-wrap rounded-2xl bg-brand-50 p-3 text-sm text-ink">{result.summary}</pre>
              <div className="grid gap-2">
                {site.contacts.map((contact, contactIndex) => (
                  <a
                    key={contact.whatsapp}
                    href={whatsAppHref(result.summary, contactIndex)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white"
                    onClick={() => trackWhatsAppClick(launch.cta, { property_slug: launch.propertySlug, contact_phone: contact.phoneDisplay })}
                  >
                    <WhatsAppIcon className="h-4 w-4" /> Continue to WhatsApp {contact.phoneDisplay}
                  </a>
                ))}
              </div>
              <p className="text-xs text-ink-muted">If WhatsApp does not open, use the same button again or copy the summary above.</p>
            </div>
          )}
          {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
        </div>
        {step !== "success" && (
          <div className="flex gap-2 border-t border-brand-100 px-5 py-4">
            <button type="button" className="btn-ghost" disabled={index === 0 || submitting} onClick={() => setIndex((current) => Math.max(0, current - 1))}>
              Back
            </button>
            {step === "contact" ? (
              <button type="button" className="btn-primary flex-1" disabled={submitting} onClick={() => void submit()}>
                {submitting ? "Saving…" : "Save enquiry"}
              </button>
            ) : (
              <button type="button" className="btn-primary flex-1" onClick={continueStep}>
                Continue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

async function refreshAttribution(setEstablished: (value: boolean) => void): Promise<boolean> {
  try {
    const response = await fetch("/api/enquiries/attribution", { credentials: "same-origin", cache: "no-store" });
    const payload = (await response.json()) as { established?: boolean };
    const established = Boolean(payload.established);
    setEstablished(established);
    return established;
  } catch {
    setEstablished(false);
    return false;
  }
}

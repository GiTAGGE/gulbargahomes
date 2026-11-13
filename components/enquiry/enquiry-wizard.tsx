"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { CloseIcon, WhatsAppIcon } from "@/components/icons";
import { trackWhatsAppClick } from "@/lib/analytics/track";
import {
  APPROVAL_PREFERENCES,
  FACILITY_OPTIONS,
  FLOOR_PREFERENCES,
  INTENDED_USES,
  LEASE_DURATIONS,
  OCCUPANT_TYPES,
  SHARING_PREFERENCES,
  preferenceQuestions,
} from "@/lib/enquiry/questions";
import {
  BUYER_TYPES,
  FURNISHING_OPTIONS,
  TENANT_OPTIONS,
  TIMELINE_OPTIONS,
  UNVERIFIED_ATTRIBUTION_NOTICE,
  budgetQuestionLabel,
  draftFromLaunch,
  enquiryHandoff,
  finishSave,
  newIdempotencyKey,
  ownerPayload,
  requirementPayload,
  selectRequirement,
  startSave,
  stepError,
  stepsFor,
  type EnquiryLaunch,
  type SaveGate,
  type WizardDraft,
} from "@/lib/enquiry/wizard";
import { site } from "@/lib/site";

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
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [result, setResult] = useState<{ code: string; summary: string } | null>(null);
  const gate = useRef<SaveGate>({ phase: "idle", key: newIdempotencyKey() });
  const turnstileHost = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const page = launch.page || pathname || "/";
  const steps = stepsFor(draft);
  const step = result ? "success" : steps[Math.min(index, steps.length - 1)];

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    void refreshAttribution(setEstablished, setSiteKey);
    function onKey(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")].filter(
        (element) => element.tabIndex !== -1 && !element.closest("[aria-hidden='true']"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      restoreFocus.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (step !== "contact" || !siteKey || !turnstileHost.current) return;
    let widgetId = "";
    let cancelled = false;
    const render = () => {
      if (cancelled || !turnstileHost.current || !window.turnstile) return;
      widgetId = window.turnstile.render(turnstileHost.current, {
        sitekey: siteKey,
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
  }, [siteKey, step]);

  function update(patch: Partial<WizardDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    if (patch.path) setIndex(0);
    setError(null);
  }

  function replace(next: WizardDraft) {
    setDraft(next);
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
    const ready = await refreshAttribution(setEstablished, setSiteKey);
    if (!ready.siteKey) {
      setError("Enquiry saving is not open until the site check is configured. Please call us instead.");
      return;
    }
    if (!turnstileToken) {
      setError("Complete the site check before sending.");
      return;
    }
    const started = startSave(gate.current);
    if (!started) return;
    gate.current = started;
    setSubmitting(true);
    setError(null);
    let saved = false;
    try {
      const context = { ...launch, page };
      const body =
        draft.path === "owner"
          ? ownerPayload(draft, context, gate.current.key, turnstileToken)
          : requirementPayload(draft, context, gate.current.key, turnstileToken);
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
      const handoff = enquiryHandoff(payload.code, draft);
      setResult({ code: handoff.code, summary: handoff.summary });
      saved = true;
      if (!ready.established) setEstablished(false);
    } catch {
      setError("The enquiry could not be saved. You can try again with the same details.");
    } finally {
      gate.current = finishSave(gate.current, saved);
      setSubmitting(false);
    }
  }

  const progress = steps.filter((item) => item !== "success");
  const progressIndex = Math.max(0, progress.findIndex((item) => item === step));

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 sm:items-center" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="mb-16 flex max-h-[78svh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-lift outline-none sm:mb-0 sm:max-h-[92svh] sm:rounded-3xl"
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
        {established === false && (
          <p role="status" className="mx-5 mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
            {UNVERIFIED_ATTRIBUTION_NOTICE}
          </p>
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
                  <Chip key={intent} selected={draft.intent === intent} onClick={() => replace(selectRequirement(draft, { intent }))}>
                    {intent}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {BUYER_TYPES.map((type) => (
                  <Chip key={type} selected={draft.propertyType === type} onClick={() => replace(selectRequirement(draft, { propertyType: type }))}>
                    {type}
                  </Chip>
                ))}
              </div>
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
                  : budgetQuestionLabel(draft) ?? (draft.intent === "Rent" ? "Monthly rent budget" : "Total purchase budget")}
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
          {step === "preferences" && draft.intent && draft.propertyType && (
            <PreferenceStep draft={draft} onChange={update} />
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
              {siteKey === "" && (
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
            <SuccessHandoff code={result.code} draft={draft} onWhatsApp={(phoneDisplay) => trackWhatsAppClick(launch.cta, { property_slug: launch.propertySlug, contact_phone: phoneDisplay })} />
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

function PreferenceStep({ draft, onChange }: { draft: WizardDraft; onChange: (patch: Partial<WizardDraft>) => void }) {
  if (draft.intent !== "Buy" && draft.intent !== "Rent") return null;
  if (!draft.propertyType) return null;
  const questions = preferenceQuestions(draft.intent, draft.propertyType);
  return (
    <fieldset className="grid gap-4">
      <legend className="text-sm font-semibold text-ink">Preferences</legend>
      <p className="text-sm text-ink-muted">Optional. Skip anything you are not sure about.</p>
      {questions.map((question) => {
        if (question.key === "intendedUse") {
          return <ChoiceGroup key={question.key} label={question.label} options={INTENDED_USES} value={draft.intendedUse} onChange={(intendedUse) => onChange({ intendedUse })} />;
        }
        if (question.key === "plotArea") {
          return <TextAnswer key={question.key} label={question.label} value={draft.plotArea} placeholder="30×40 or 1,200 sq ft" onChange={(plotArea) => onChange({ plotArea })} />;
        }
        if (question.key === "roadAccess") {
          return <TextAnswer key={question.key} label={question.label} value={draft.roadAccess} placeholder="30 ft road, corner access" onChange={(roadAccess) => onChange({ roadAccess })} />;
        }
        if (question.key === "leaseDuration") {
          return <ChoiceGroup key={question.key} label={question.label} options={LEASE_DURATIONS} value={draft.leaseDuration} onChange={(leaseDuration) => onChange({ leaseDuration })} />;
        }
        if (question.key === "approvalPreference") {
          return <ChoiceGroup key={question.key} label={question.label} options={APPROVAL_PREFERENCES} value={draft.approvalPreference} onChange={(approvalPreference) => onChange({ approvalPreference })} />;
        }
        if (question.key === "bhk") {
          return (
            <div key={question.key} className="grid gap-2">
              <p className="text-sm font-semibold text-ink">{question.label}</p>
              <div className="grid grid-cols-2 gap-3">
                <TextAnswer label="Minimum" value={draft.bhkMin} numeric onChange={(bhkMin) => onChange({ bhkMin })} />
                <TextAnswer label="Maximum" value={draft.bhkMax} numeric onChange={(bhkMax) => onChange({ bhkMax })} />
              </div>
            </div>
          );
        }
        if (question.key === "furnishing") {
          return (
            <ChoiceGroup
              key={question.key}
              label={question.label}
              options={FURNISHING_OPTIONS}
              value={draft.furnishing}
              onChange={(furnishing) => onChange({ furnishing: FURNISHING_OPTIONS.find((option) => option === furnishing) ?? "Any" })}
            />
          );
        }
        if (question.key === "tenantProfile") {
          return (
            <ChoiceGroup
              key={question.key}
              label={question.label}
              options={TENANT_OPTIONS}
              value={draft.tenantProfile}
              onChange={(tenantProfile) => onChange({ tenantProfile: TENANT_OPTIONS.find((option) => option === tenantProfile) ?? "Any" })}
            />
          );
        }
        if (question.key === "parking") {
          return (
            <ChoiceGroup
              key={question.key}
              label={question.label}
              options={["Parking needed", "Parking not needed"]}
              value={draft.parking === "Yes" ? "Parking needed" : draft.parking === "No" ? "Parking not needed" : ""}
              onChange={(choice) => onChange({ parking: choice === "Parking needed" ? "Yes" : choice === "Parking not needed" ? "No" : "" })}
            />
          );
        }
        if (question.key === "areaMin") {
          return <TextAnswer key={question.key} label={`${question.label} (sq ft)`} value={draft.area} numeric onChange={(area) => onChange({ area })} />;
        }
        if (question.key === "commercialUse") {
          return <TextAnswer key={question.key} label={question.label} value={draft.commercialUse} placeholder="Shop, clinic, office" onChange={(commercialUse) => onChange({ commercialUse })} />;
        }
        if (question.key === "floorPreference") {
          return <ChoiceGroup key={question.key} label={question.label} options={FLOOR_PREFERENCES} value={draft.floorPreference} onChange={(floorPreference) => onChange({ floorPreference })} />;
        }
        if (question.key === "occupantType") {
          return <ChoiceGroup key={question.key} label={question.label} options={OCCUPANT_TYPES} value={draft.occupantType} onChange={(occupantType) => onChange({ occupantType })} />;
        }
        if (question.key === "sharing") {
          return <ChoiceGroup key={question.key} label={question.label} options={SHARING_PREFERENCES} value={draft.sharing} onChange={(sharing) => onChange({ sharing })} />;
        }
        if (question.key === "facilities") {
          return (
            <div key={question.key} className="grid gap-2">
              <p className="text-sm font-semibold text-ink">{question.label}</p>
              <div className="flex flex-wrap gap-2">
                {FACILITY_OPTIONS.map((facility) => (
                  <Chip
                    key={facility}
                    selected={draft.facilities.includes(facility)}
                    onClick={() =>
                      onChange({
                        facilities: draft.facilities.includes(facility)
                          ? draft.facilities.filter((item) => item !== facility)
                          : [...draft.facilities, facility],
                      })
                    }
                  >
                    {facility}
                  </Chip>
                ))}
              </div>
            </div>
          );
        }
        return <TextAnswer key={question.key} label={question.label} value={draft.notes} multiline onChange={(notes) => onChange({ notes })} />;
      })}
    </fieldset>
  );
}

function ChoiceGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip key={option} selected={value === option} onClick={() => onChange(value === option ? "" : option)}>
            {option}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function TextAnswer({
  label,
  value,
  onChange,
  placeholder,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
}) {
  const className = "mt-1 w-full rounded-xl border border-brand-200 px-3 py-3";
  return (
    <label className="text-sm text-ink-muted">
      {label}
      {multiline ? (
        <textarea className={className} rows={3} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={className} inputMode={numeric ? "numeric" : "text"} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function SuccessHandoff({
  code,
  draft,
  onWhatsApp,
}: {
  code: string;
  draft: WizardDraft;
  onWhatsApp: (phoneDisplay: string) => void;
}) {
  const handoff = enquiryHandoff(code, draft);
  return (
    <div className="grid gap-4">
      <p role="status" className="text-sm leading-relaxed text-ink">
        Your enquiry is saved. The reference is <span className="font-bold">{handoff.code}</span>. WhatsApp does not send this for you. Open a chat, check the summary, then press send there.
      </p>
      <pre className="whitespace-pre-wrap rounded-2xl bg-brand-50 p-3 text-sm text-ink">{handoff.summary}</pre>
      <div className="grid gap-2">
        {handoff.links.map((link) => (
          <a
            key={link.phoneDisplay}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white"
            onClick={() => onWhatsApp(link.phoneDisplay)}
          >
            <WhatsAppIcon className="h-4 w-4" /> Continue to WhatsApp {link.phoneDisplay}
          </a>
        ))}
      </div>
      <p className="text-xs text-ink-muted">If WhatsApp does not open, use the same link again or copy the summary above.</p>
    </div>
  );
}

async function refreshAttribution(
  setEstablished: (value: boolean) => void,
  setSiteKey: (value: string) => void,
): Promise<{ established: boolean; siteKey: string }> {
  try {
    const response = await fetch("/api/enquiries/attribution", { credentials: "same-origin", cache: "no-store" });
    const payload = (await response.json()) as { established?: boolean; siteKey?: string };
    const established = Boolean(payload.established);
    const siteKey = typeof payload.siteKey === "string" ? payload.siteKey : "";
    setEstablished(established);
    setSiteKey(siteKey);
    return { established, siteKey };
  } catch {
    setEstablished(false);
    setSiteKey("");
    return { established: false, siteKey: "" };
  }
}

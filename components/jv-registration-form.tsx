"use client";

import Link from "next/link";
import { useState } from "react";

import { trackWhatsAppClick } from "@/lib/analytics/track";
import { site } from "@/lib/site";

const TALUKAS = [
  "Kalaburagi",
  "Afzalpur",
  "Kamalapur",
  "Sedam",
  "Kalagi",
  "Jewargi",
  "Nelogi",
  "Shahabad",
  "Chincholi",
  "Other",
] as const;

const UNITS = ["Acres", "Guntas", "Square feet", "Other"] as const;
const OWNERSHIP = ["Individual", "Joint", "Family", "Multiple owners"] as const;
const YES_NO_UNSURE = ["Yes", "No", "Not sure"] as const;

type YesNoUnsure = (typeof YES_NO_UNSURE)[number];

type Fields = {
  name: string;
  mobile: string;
  email: string;
  village: string;
  taluk: string;
  talukOther: string;
  district: string;
  extent: string;
  unit: string;
  ownership: string;
  rtc: string;
  road: string;
  coOwners: string;
  partnership: string;
  notes: string;
  acknowledge: boolean;
  updates: boolean;
};

const empty: Fields = {
  name: "",
  mobile: "",
  email: "",
  village: "",
  taluk: "",
  talukOther: "",
  district: "Kalaburagi",
  extent: "",
  unit: "Acres",
  ownership: "",
  rtc: "",
  road: "",
  coOwners: "",
  partnership: "",
  notes: "",
  acknowledge: false,
  updates: false,
};

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-brand-200 bg-white px-3 py-3 text-base text-ink outline-none ring-brand-600 focus:ring-2";

function normalizeMobile(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

function validName(value: string): boolean {
  const text = value.trim();
  return text.length >= 2 && text.length <= 80 && !/[\u0000-\u001F]/.test(text);
}

function validPlace(value: string): boolean {
  const text = value.trim();
  return text.length >= 2 && text.length <= 80;
}

export function JvRegistrationForm() {
  const [fields, setFields] = useState<Fields>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [href, setHref] = useState<string | null>(null);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!validName(fields.name)) next.name = "Enter the landowner’s name.";
    if (!normalizeMobile(fields.mobile)) {
      next.mobile = "Enter a 10-digit Indian mobile number.";
    }
    if (fields.email.trim()) {
      const email = fields.email.trim();
      if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        next.email = "Enter a valid email, or leave it blank.";
      }
    }
    if (!validPlace(fields.village)) next.village = "Enter the village name.";
    if (!fields.taluk) next.taluk = "Choose a taluk or area.";
    if (fields.taluk === "Other" && !validPlace(fields.talukOther)) {
      next.talukOther = "Enter the taluk or area.";
    }
    if (!validPlace(fields.district)) next.district = "Enter the district.";
    const extent = Number(fields.extent);
    if (!fields.extent.trim() || !Number.isFinite(extent) || extent <= 0 || extent > 100000) {
      next.extent = "Enter the land extent as a number greater than zero.";
    }
    if (!UNITS.includes(fields.unit as (typeof UNITS)[number])) next.unit = "Choose a unit.";
    if (!OWNERSHIP.includes(fields.ownership as (typeof OWNERSHIP)[number])) {
      next.ownership = "Choose the ownership type.";
    }
    if (!YES_NO_UNSURE.includes(fields.rtc as YesNoUnsure)) next.rtc = "Choose one option.";
    if (!YES_NO_UNSURE.includes(fields.road as YesNoUnsure)) next.road = "Choose one option.";
    if (!YES_NO_UNSURE.includes(fields.coOwners as YesNoUnsure)) {
      next.coOwners = "Choose one option.";
    }
    if (fields.partnership !== "Yes" && fields.partnership !== "No") {
      next.partnership = "Choose yes or no.";
    }
    if (fields.notes.trim().length > 800) next.notes = "Keep notes within 800 characters.";
    if (!fields.acknowledge) {
      next.acknowledge = "Acknowledge the Privacy Policy before sending.";
    }
    return next;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) {
      setHref(null);
      const first = Object.keys(next)[0];
      document.getElementById(first)?.focus();
      return;
    }

    const mobile = normalizeMobile(fields.mobile)!;
    const taluk = fields.taluk === "Other" ? fields.talukOther.trim() : fields.taluk;
    const lines = [
      "Agricultural land JV enquiry — GulbargaHomes",
      `Name: ${fields.name.trim()}`,
      `Mobile: +91 ${mobile}`,
      `Email: ${fields.email.trim() || "not provided"}`,
      `Village: ${fields.village.trim()}`,
      `Taluk or area: ${taluk}`,
      `District: ${fields.district.trim()}`,
      `Land: ${fields.extent.trim()} ${fields.unit}`,
      `Ownership: ${fields.ownership}`,
      `RTC/Pahani available: ${fields.rtc}`,
      `Road access: ${fields.road}`,
      `Co-owners agree to a JV discussion: ${fields.coOwners}`,
      `Interested in a development partnership: ${fields.partnership}`,
      `Notes: ${fields.notes.trim() || "none"}`,
      `Other JV updates requested: ${fields.updates ? "yes" : "no"}`,
    ];
    const url = `https://wa.me/${site.contacts[0].whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`;
    setHref(url);
    trackWhatsAppClick("jv_form", {
      contact_phone: site.contacts[0].phoneDisplay,
      content_name: "agricultural land JV",
      page_type: "joint_venture",
    });
    window.location.assign(url);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-8 space-y-5 rounded-3xl border border-brand-100 bg-white p-4 shadow-soft sm:p-6">
      <TextField
        id="name"
        label="Full name"
        value={fields.name}
        error={errors.name}
        autoComplete="name"
        onChange={(value) => set("name", value)}
      />
      <TextField
        id="mobile"
        label="Mobile number"
        value={fields.mobile}
        error={errors.mobile}
        inputMode="tel"
        autoComplete="tel"
        onChange={(value) => set("mobile", value)}
      />
      <TextField
        id="email"
        label="Email address (optional)"
        value={fields.email}
        error={errors.email}
        type="email"
        autoComplete="email"
        onChange={(value) => set("email", value)}
      />
      <TextField
        id="village"
        label="Village"
        value={fields.village}
        error={errors.village}
        onChange={(value) => set("village", value)}
      />
      <SelectField
        id="taluk"
        label="Taluk or nearby area"
        value={fields.taluk}
        error={errors.taluk}
        onChange={(value) => set("taluk", value)}
        options={TALUKAS}
        placeholder="Choose an area"
      />
      {fields.taluk === "Other" ? (
        <TextField
          id="talukOther"
          label="Other taluk or area"
          value={fields.talukOther}
          error={errors.talukOther}
          onChange={(value) => set("talukOther", value)}
        />
      ) : null}
      <TextField
        id="district"
        label="District"
        value={fields.district}
        error={errors.district}
        onChange={(value) => set("district", value)}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id="extent"
          label="Land extent"
          value={fields.extent}
          error={errors.extent}
          inputMode="decimal"
          onChange={(value) => set("extent", value)}
        />
        <SelectField
          id="unit"
          label="Measurement unit"
          value={fields.unit}
          error={errors.unit}
          onChange={(value) => set("unit", value)}
          options={UNITS}
        />
      </div>
      <SelectField
        id="ownership"
        label="Ownership"
        value={fields.ownership}
        error={errors.ownership}
        onChange={(value) => set("ownership", value)}
        options={OWNERSHIP}
        placeholder="Who holds the land?"
      />
      <SelectField
        id="rtc"
        label="Is an RTC or Pahani available?"
        value={fields.rtc}
        error={errors.rtc}
        onChange={(value) => set("rtc", value)}
        options={YES_NO_UNSURE}
        placeholder="Choose one"
      />
      <SelectField
        id="road"
        label="Does the land have road access?"
        value={fields.road}
        error={errors.road}
        onChange={(value) => set("road", value)}
        options={YES_NO_UNSURE}
        placeholder="Choose one"
      />
      <SelectField
        id="coOwners"
        label="Do all co-owners agree to discuss a joint venture?"
        value={fields.coOwners}
        error={errors.coOwners}
        onChange={(value) => set("coOwners", value)}
        options={YES_NO_UNSURE}
        placeholder="Choose one"
      />
      <SelectField
        id="partnership"
        label="Are you interested in a development partnership?"
        value={fields.partnership}
        error={errors.partnership}
        onChange={(value) => set("partnership", value)}
        options={["Yes", "No"]}
        placeholder="Choose one"
      />
      <div>
        <label htmlFor="notes" className="block text-sm font-semibold text-ink">
          Anything else you want us to know (optional)
        </label>
        <textarea
          id="notes"
          value={fields.notes}
          onChange={(event) => set("notes", event.target.value)}
          rows={4}
          maxLength={800}
          className={fieldClass}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? "notes-error" : undefined}
        />
        {errors.notes ? <FieldError id="notes-error" message={errors.notes} /> : null}
      </div>

      <div>
        <label className="flex gap-3 text-sm leading-relaxed text-ink-muted">
          <input
            id="acknowledge"
            type="checkbox"
            checked={fields.acknowledge}
            onChange={(event) => set("acknowledge", event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
            aria-invalid={errors.acknowledge ? true : undefined}
            aria-describedby={errors.acknowledge ? "acknowledge-error" : undefined}
          />
          <span>
            By submitting this form, you acknowledge that GulbargaHomes may use your contact and
            agricultural land details to review your JV enquiry, contact you and facilitate
            potential introductions to suitable investors or development partners in accordance
            with our{" "}
            <Link href="/privacy-policy" className="font-semibold text-brand-700 underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acknowledge ? (
          <FieldError id="acknowledge-error" message={errors.acknowledge} />
        ) : null}
      </div>

      <label className="flex gap-3 text-sm leading-relaxed text-ink-muted">
        <input
          id="updates"
          type="checkbox"
          checked={fields.updates}
          onChange={(event) => set("updates", event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
        />
        <span>
          Optional: GulbargaHomes may contact me later about other agricultural land joint-venture
          opportunities. Leave this unticked if you only want a reply about this enquiry.
        </span>
      </label>

      <button type="submit" className="btn-primary w-full bg-[#25D366] hover:bg-[#1fb855]">
        Send enquiry on WhatsApp
      </button>
      <p className="text-xs leading-relaxed text-ink-faint">
        Submit opens WhatsApp to {site.contacts[0].phoneDisplay}. GulbargaHomes does not keep a
        copy of this form on the website. We do not promise an investor, a project, or a return.
      </p>
      {href ? (
        <p className="text-sm text-ink">
          If WhatsApp did not open,{" "}
          <a href={href} className="font-semibold text-brand-700 underline">
            continue to WhatsApp
          </a>
          .
        </p>
      ) : null}
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  error,
  onChange,
  type = "text",
  inputMode,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "tel" | "decimal" | "text";
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? <FieldError id={`${id}-error`} message={error} /> : null}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  error,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error ? <FieldError id={`${id}-error`} message={error} /> : null}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-red-700">
      {message}
    </p>
  );
}

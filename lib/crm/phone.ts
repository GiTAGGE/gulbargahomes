/** Normalise an Indian mobile number to +91XXXXXXXXXX, or null when it is not one. */
export function normalizeIndianMobile(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits.length === 13 && digits.startsWith("091")
          ? digits.slice(3)
          : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

/** Placeholder written by the manual erasure SQL (lib/crm/erasure.ts). */
export function isErasedPhone(value: string): boolean {
  return value.startsWith("erased:");
}

export function formatPhone(e164: string): string {
  if (isErasedPhone(e164)) return "Erased";
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}

export function maskPhone(e164: string): string {
  if (!e164) return "";
  if (isErasedPhone(e164)) return "Erased";
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `+91 ••••• •${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email ? "•••" : "";
  return `${user[0]}•••@${domain}`;
}

export function whatsappLink(e164: string, text?: string): string {
  const number = e164.replace(/\D/g, "");
  return text ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/${number}`;
}

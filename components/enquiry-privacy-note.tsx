import Link from "next/link";

export function EnquiryPrivacyNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-ink-faint ${className}`}>
      A call or WhatsApp message is not stored as a website account. Your number and what you
      write stay in that phone or WhatsApp chat so GulbargaHomes can reply.{" "}
      <Link
        href="/privacy-policy"
        className="font-semibold text-brand-700 underline-offset-2 hover:underline"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}

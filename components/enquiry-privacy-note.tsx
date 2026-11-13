import Link from "next/link";

export function EnquiryPrivacyNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-ink-faint ${className}`}>
      The enquiry form saves your name, phone and answers so GulbargaHomes can reply. A phone
      call by itself is not saved as an enquiry.{" "}
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

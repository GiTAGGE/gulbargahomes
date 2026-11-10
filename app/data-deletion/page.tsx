import type { Metadata } from "next";
import Link from "next/link";

import {
  TrackedPhoneLink,
  TrackedWhatsAppLink,
} from "@/components/analytics/tracked-contact";
import {
  LegalDocument,
  LegalLinks,
  LegalSection,
  PRIVACY_UPDATED,
  PRIVACY_UPDATED_LABEL,
} from "@/components/legal-document";
import { metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

const deletionText = encodeURIComponent(
  "Hi GulbargaHomes, this is a personal-data request (access, correction, withdrawal of consent, or deletion).\nName:\nMobile number I used:\nEmail, if any:\nWhat I want:",
);

export const metadata: Metadata = {
  title: "Data deletion and privacy requests",
  description: metaDescription(
    "Ask GulbargaHomes for access, correction, withdrawal of consent, or deletion of personal information, including Meta Instant Form answers, about a property or land enquiry in Gulbarga (Kalaburagi).",
  ),
  alternates: { canonical: "/data-deletion" },
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  return (
    <LegalDocument
      eyebrow="Privacy"
      title="Data deletion and privacy requests"
      path="/data-deletion"
      updated={PRIVACY_UPDATED}
      updatedLabel={PRIVACY_UPDATED_LABEL}
      description="Use this page to ask for access, a correction, withdrawal of consent, or deletion of personal information GulbargaHomes holds about you, including answers you sent through a Meta Instant Form in one of our ads. There is no visitor login on the website."
    >
      <LegalSection id="what-you-can-ask" title="What you can ask">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Access: what we hold in our enquiry system, and in WhatsApp, phone notes or email we control.</li>
          <li>Correction: fix a name, number, village, land size or other detail.</li>
          <li>Withdrawal: stop optional messages about other joint-venture opportunities, or stop a new introduction.</li>
          <li>Deletion: remove personal information where the law allows it.</li>
          <li>A complaint about how a request was handled.</li>
        </ul>
        <p>
          We may ask questions so we do not change the wrong record. We can limit a request if we
          must keep a record for a legal duty, or if we cannot find a match.
        </p>
      </LegalSection>

      <LegalSection id="what-this-covers" title="Where your information can be">
        <p>
          Property and service enquiries reach us by phone, WhatsApp, email or a Meta Instant Form
          in one of our ads. Meta Instant Form answers are imported automatically into our private
          enquiry system. Our staff may also record phone, WhatsApp and email enquiries there. The
          agricultural land form opens WhatsApp with what you typed; it does not save a copy on the
          website. Tell us the mobile number you used so we can find your records.
        </p>
        <p>
          Saved homes and recently viewed listings are in your browser only. Remove saved homes on
          the Saved page, or clear site data for {site.domain} to remove saved homes, recent
          listings and the analytics choice together.
        </p>
      </LegalSection>

      <LegalSection id="how-deletion-works" title="How a deletion request is handled">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>You send the request using one of the contacts below.</li>
          <li>
            We confirm the request comes from you, normally by contacting the mobile number the
            request is about.
          </li>
          <li>
            Our Super Admin removes your name, mobile number, email, form answers and staff notes
            from our enquiry system, or replaces them so they no longer identify you, and marks the
            record so our staff do not contact you again.
          </li>
          <li>We tell you when it is done, or explain what we must keep and why.</li>
        </ol>
        <p>
          This is done by hand by our Super Admin. It is not automatic, and this page does not
          promise a fixed number of days. Where a response period in the Digital Personal Data
          Protection Act, 2023 or its rules is in force, we will follow it.
        </p>
        <p>What a deletion does not remove:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            the internal history of who created or changed a record, which cannot be edited and can
            still show your name and number as first recorded (only our Super Admin and inventory
            managers can view it);
          </li>
          <li>the Meta reference number of a form you sent, kept so the same form is not imported again;</li>
          <li>anything a law that applies to us requires us to keep;</li>
          <li>Meta’s own copy of an Instant Form, which you manage in your Facebook or Instagram settings;</li>
          <li>Google Analytics hits, which are not tied to your name, and messages that stay on your phone.</li>
        </ul>
        <p>
          Without a request, we keep an enquiry for 12 months after our last meaningful interaction
          with you about it, and then our Super Admin reviews it by hand, as the{" "}
          <Link href="/privacy-policy#retention" className="font-semibold text-brand-700 hover:underline">
            Privacy Policy
          </Link>{" "}
          explains.
        </p>
      </LegalSection>

      <LegalSection id="how-to-ask" title="How to submit a request">
        <p>
          Include your name, the mobile number you used, an email if you used one, and whether you
          want access, correction, withdrawal, deletion, or a complaint. Mention a listing, village,
          advertisement or date if you have one.
        </p>
        <div className="grid gap-3">
          {site.contacts.map((contact) => (
            <TrackedWhatsAppLink
              key={`wa-${contact.whatsapp}`}
              href={`https://wa.me/${contact.whatsapp}?text=${deletionText}`}
              source="data_deletion"
              context={{
                contact_phone: contact.phoneDisplay,
                content_name: "data deletion",
                page_type: "data_deletion",
              }}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white shadow-soft"
            >
              WhatsApp {contact.phoneDisplay}
            </TrackedWhatsAppLink>
          ))}
          {site.contacts.map((contact) => (
            <TrackedPhoneLink
              key={contact.phone}
              href={`tel:${contact.phone}`}
              source="data_deletion"
              context={{
                contact_phone: contact.phoneDisplay,
                content_name: "data deletion",
                page_type: "data_deletion",
              }}
              className="btn-primary justify-center"
            >
              Call {contact.phoneDisplay}
            </TrackedPhoneLink>
          ))}
          <a
            href={`mailto:${site.email}?subject=${encodeURIComponent("Personal data request")}`}
            className="btn-ghost justify-center"
          >
            Email {site.email}
          </a>
        </div>
        <p>
          A named grievance officer is not published. Use these contacts. Where a response period
          in the Digital Personal Data Protection Act, 2023 or its rules is in force, we will
          follow it. This page does not state a number of days we have not been given.
        </p>
        <LegalLinks />
      </LegalSection>
    </LegalDocument>
  );
}

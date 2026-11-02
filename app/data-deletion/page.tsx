import type { Metadata } from "next";

import {
  TrackedPhoneLink,
  TrackedWhatsAppLink,
} from "@/components/analytics/tracked-contact";
import { LegalDocument, LegalLinks, LegalSection } from "@/components/legal-document";
import { metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

const deletionText = encodeURIComponent(
  "Hi GulbargaHomes, this is a personal-data request (access, correction, withdrawal of consent, or deletion).\nName:\nMobile number I used:\nEmail, if any:\nWhat I want:",
);

export const metadata: Metadata = {
  title: "Data deletion and privacy requests",
  description: metaDescription(
    "Ask GulbargaHomes for access, correction, withdrawal of consent, or deletion of personal information about a property or agricultural land enquiry in Gulbarga (Kalaburagi).",
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
      description="Use this page to ask for access, a correction, withdrawal of consent, or deletion of personal information GulbargaHomes holds about you. There is no visitor login and no enquiry database on the website."
    >
      <LegalSection id="what-you-can-ask" title="What you can ask">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Access: what we still have in WhatsApp, phone notes or email we control.</li>
          <li>Correction: fix a name, number, village, land size or other detail.</li>
          <li>Withdrawal: stop optional messages about other joint-venture opportunities, or stop a new introduction.</li>
          <li>Deletion: remove personal information where the law allows it.</li>
          <li>A complaint about how a request was handled.</li>
        </ul>
        <p>
          We may ask questions so we do not change the wrong conversation. We can limit a request
          if we must keep a record for a legal duty, or if we cannot find a match.
        </p>
      </LegalSection>

      <LegalSection id="what-this-covers" title="What this website does and does not store">
        <p>
          Property and service enquiries are phone calls and WhatsApp or email messages. The
          agricultural land form opens WhatsApp with what you typed. It does not save a second
          copy on the website. Meta Instant Form answers, if you sent any in an advertisement, are
          collected by Meta. They are not imported into this site automatically. If we downloaded a
          copy, say so in your request and we will deal with that copy.
        </p>
        <p>
          Saved homes and recently viewed listings are in your browser only. Remove saved homes on
          the Saved page, or clear site data for {site.domain} to remove saved homes, recent
          listings and the analytics choice together.
        </p>
        <p>
          We cannot delete Google Analytics hits from here. Those hits are not tied to your name.
          We also cannot delete Meta’s own copy of an Instant Form, or messages that stay on your
          phone.
        </p>
      </LegalSection>

      <LegalSection id="how-to-ask" title="How to submit a request">
        <p>
          Include your name, the mobile number you used, an email if you used one, and whether you
          want access, correction, withdrawal, deletion, or a complaint. Mention a listing, village
          or date if you have one.
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

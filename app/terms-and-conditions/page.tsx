import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument, LegalLinks, LegalSection } from "@/components/legal-document";
import { metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: metaDescription(
    "Terms for using GulbargaHomes listings, enquiries and agricultural land joint-venture introductions in Gulbarga (Kalaburagi).",
  ),
  alternates: { canonical: "/terms-and-conditions" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Terms"
      title="Terms and conditions"
      path="/terms-and-conditions"
      description="These terms apply to your use of gulbargahomes.com and to enquiries you send to GulbargaHomes about a property, a service, or an agricultural land joint venture."
    >
      <LegalSection id="business" title="The business">
        <p>
          The site is operated by GulbargaHomes, with the phone numbers {site.phonesDisplay} and
          the email {site.email}, in Kalaburagi, Karnataka, India. These terms do not state a
          company type, CIN or GST number, because those details are not published on the site.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Using the website">
        <p>
          You may browse listings, search, save homes in your own browser, and contact us by the
          links we provide. Do not misuse the site, attempt to break it, or scrape it in a way
          that disrupts it. Visitors do not get an account.
        </p>
        <p>
          Pages are information. Prices, availability, measurements, photographs and descriptions
          can change or be incomplete. Check anything that matters before you rely on it.
        </p>
      </LegalSection>

      <LegalSection id="listings" title="Listings">
        <p>
          Houses, flats, villas, paying-guest stays, residential plots, commercial space and land
          are published by GulbargaHomes after our own check. You cannot upload a property, a
          photograph or a document through the public site. Sending us details by phone, WhatsApp
          or email does not by itself create a listing.
        </p>
        <p>
          A listing is not an offer that binds the owner, and it is not proof of title. Ownership,
          boundaries, conversion, revenue records and permissions have to be verified outside this
          website.
        </p>
      </LegalSection>

      <LegalSection id="enquiries" title="Enquiries and viewings">
        <p>
          Calls and WhatsApp or email messages are requests for a conversation. They do not reserve
          a property. A viewing happens only if we, and where needed the owner, agree a time. We
          may decline an enquiry.
        </p>
        <p>
          Construction, interior, kitchen and renovation pages are ways to start a discussion.
          They are not a work order. Any paid work needs its own agreement.
        </p>
      </LegalSection>

      <LegalSection id="jv" title="Agricultural land joint ventures">
        <p>
          The{" "}
          <Link
            href="/agricultural-land-joint-venture"
            className="font-semibold text-brand-700 hover:underline"
          >
            joint-venture page
          </Link>{" "}
          lets a landowner send an enquiry. GulbargaHomes may use those details to review the
          enquiry, contact you, and introduce you to an investor or development partner if that is
          appropriate. Read the{" "}
          <Link href="/privacy-policy" className="font-semibold text-brand-700 hover:underline">
            Privacy Policy
          </Link>{" "}
          for what is collected and what is not stored on the website.
        </p>
        <p>
          We do not guarantee an investor, a developer, a meeting, a project, a revenue share, a
          profit, or any signed joint venture. We do not provide investment, legal, survey or tax
          advice. You and any other party must take your own advice and make your own decision.
          GulbargaHomes is not a party to a joint venture, sale or development agreement unless a
          separate written agreement names us.
        </p>
        <p>
          You confirm that the details you send are yours to share and are not knowingly false. Do
          not send identity documents or bank details through the form.
        </p>
      </LegalSection>

      <LegalSection id="content" title="Photographs and text">
        <p>
          Listing text, photographs and video files on the site are for viewing the listing. Do not
          copy them for another listing service without permission. Messages you send us stay yours,
          and you allow us to use them to handle the enquiry, including a necessary introduction.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" title="Other services">
        <p>
          WhatsApp, your phone network, Cloudflare, and Google Analytics if you allow it, are separate
          services with their own terms. Meta Instant Forms, if you use one in an advertisement,
          are Meta’s forms, not pages of this website.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="Limits">
        <p>
          To the extent the law allows, GulbargaHomes is not liable for a decision you make from a
          listing, a message, or an introduction, or for a loss caused by information that is
          incomplete. Nothing on the site excludes liability that the law does not allow us to
          exclude.
        </p>
      </LegalSection>

      <LegalSection id="law" title="Law">
        <p>
          These terms are governed by the laws of India. Courts at Kalaburagi, Karnataka, have
          jurisdiction, except where a law gives you a different forum that cannot be changed.
        </p>
        <p>
          We may update these terms by changing this page and its “last updated” date. The{" "}
          <Link href="/privacy-policy" className="font-semibold text-brand-700 hover:underline">
            Privacy Policy
          </Link>{" "}
          explains personal information.
        </p>
        <LegalLinks />
      </LegalSection>
    </LegalDocument>
  );
}

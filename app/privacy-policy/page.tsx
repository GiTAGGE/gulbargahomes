import type { Metadata } from "next";
import Link from "next/link";

import { AnalyticsChoice } from "@/components/analytics/analytics-choice";
import {
  LegalDocument,
  LegalLinks,
  LegalSection,
  LegalToc,
  PRIVACY_UPDATED,
  PRIVACY_UPDATED_LABEL,
} from "@/components/legal-document";
import { metaDescription } from "@/lib/seo";
import { site } from "@/lib/site";

const toc = [
  { id: "who-we-are", label: "Who we are" },
  { id: "scope", label: "What this notice covers" },
  { id: "website", label: "What the website does" },
  { id: "listings", label: "Property listings" },
  { id: "owners", label: "How listings are added" },
  { id: "enquiries", label: "Buyer and tenant enquiries" },
  { id: "joint-venture", label: "Agricultural land joint ventures" },
  { id: "meta", label: "Meta ads and Instant Forms" },
  { id: "crm", label: "Our private enquiry system" },
  { id: "messages", label: "Phone, WhatsApp and email" },
  { id: "collected", label: "Information involved" },
  { id: "cookies-and-analytics", label: "Cookies, storage and analytics" },
  { id: "advertising", label: "Advertising measurement" },
  { id: "sharing", label: "Who receives information" },
  { id: "introductions", label: "Introductions to owners or developers" },
  { id: "purposes", label: "Why we use information" },
  { id: "children", label: "Children" },
  { id: "retention", label: "How long information is kept" },
  { id: "security", label: "Security" },
  { id: "rights", label: "Your choices and requests" },
  { id: "deletion", label: "Deletion" },
  { id: "grievance", label: "Complaints" },
  { id: "breach", label: "If something goes wrong" },
  { id: "changes", label: "Changes to this notice" },
  { id: "contact", label: "Contact" },
];

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: metaDescription(
    "How GulbargaHomes handles enquiries, Meta Instant Form leads, listings, analytics and agricultural land joint-venture introductions in Gulbarga (Kalaburagi).",
  ),
  alternates: { canonical: "/privacy-policy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      eyebrow="Privacy"
      title="Privacy Policy"
      path="/privacy-policy"
      updated={PRIVACY_UPDATED}
      updatedLabel={PRIVACY_UPDATED_LABEL}
      description="This notice describes how GulbargaHomes handles personal information in connection with gulbargahomes.com, our Facebook and Instagram advertisements, and our private enquiry system. It matches how these work today, and it says plainly which tools are not connected."
    >
      <LegalToc items={toc} />

      <LegalSection id="who-we-are" title="Who we are">
        <p>
          GulbargaHomes operates {site.domain}. The published business contacts are{" "}
          {site.phonesDisplay}, {site.email}, and Kalaburagi, Karnataka 585101, India. A street
          address and a named grievance officer are not published on this website.
        </p>
        <p>
          GulbargaHomes is based in India. Where we handle digital personal data, the Digital
          Personal Data Protection Act, 2023 applies to the extent that Act and the rules made
          under it are in force. This page is a notice of our practices. It is not a compliance
          certificate, an audit, or a registration with a Consent Manager. We have not stated that
          GulbargaHomes has been classified as a Significant Data Fiduciary.
        </p>
      </LegalSection>

      <LegalSection id="scope" title="What this notice covers">
        <p>This notice covers personal information connected with:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>browsing gulbargahomes.com;</li>
          <li>phone calls and WhatsApp chats you start from the site;</li>
          <li>the agricultural land joint-venture form on this website;</li>
          <li>calls, WhatsApp chats and emails you exchange with us about a property or a joint venture;</li>
          <li>
            Meta Instant Forms you submit in a GulbargaHomes advertisement on Facebook or
            Instagram. Meta collects the form and passes your answers to our private enquiry
            system;
          </li>
          <li>the private enquiry system our staff use to record and follow up enquiries.</li>
        </ul>
        <p>
          It does not cover a separate contract you may later sign with a landowner, buyer, investor
          or developer. GulbargaHomes does not become a party to a sale, tenancy or joint venture
          unless a separate written agreement says so.
        </p>
      </LegalSection>

      <LegalSection id="website" title="What the website does">
        <p>
          The public site is a set of pages about homes, plots, commercial space, construction and
          related services in Gulbarga (Kalaburagi). Visitors do not create an account. There is no
          public registration, login, checkout or payment. The public pages do not store what you
          type. Enquiries that reach us by Meta Instant Form, phone, WhatsApp or email can be
          recorded by our staff in a private enquiry system that is not part of the public website.
        </p>
        <p>
          Search filters and the site search box send words you type to this website so results can
          be shown. Those searches are not written into a customer database. Unless you have turned
          analytics off in this browser, the search words can also be sent to Google Analytics.
        </p>
        <p>
          Saved homes and recently viewed listing addresses are stored only in your browser. They
          are not a user profile on our server.
        </p>
      </LegalSection>

      <LegalSection id="listings" title="Property listings">
        <p>Published pages can describe:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>houses, flats, villas and paying-guest stays;</li>
          <li>residential plots;</li>
          <li>commercial space;</li>
          <li>land, including agricultural land the team has chosen to publish;</li>
          <li>photographs, video files, price, area, facing, locality and other property facts;</li>
          <li>construction, interior, kitchen and renovation services, and project stories.</li>
        </ul>
        <p>
          There is no separate software category named “agricultural land”. Acreage listings that
          are published use the same listing pages as other properties. Listing pages show
          GulbargaHomes phone numbers. They do not show a property owner’s private mobile number.
        </p>
        <p>
          Photos and video files for listings are stored with the website or in Cloudflare R2
          storage. The admin screen can be
          pointed at Cloudinary, but that upload path is turned off in this project unless hosting
          environment variables are added. We do not describe Cloudinary as an active store of
          visitor data.
        </p>
        <p>
          If a listing includes a YouTube address, the page can load YouTube’s privacy-enhanced
          player. Listings published at the date of this notice use video files on the site, not
          YouTube.
        </p>
      </LegalSection>

      <LegalSection id="owners" title="How listings are added">
        <p>
          Visitors cannot submit a property, upload photographs, or open an owner account. The
          website has no owner-registration form and no buy-or-rent form that saves answers on the
          server.
        </p>
        <p>
          If you want a house, flat, plot, shop or piece of land shown on GulbargaHomes, contact us
          by phone, WhatsApp or email. We look at the details, and we may ask follow-up questions
          or ask to see the property. A listing is added by our team in the private admin, and only
          after that check. Listings are stored in our listing database on Cloudflare. It is not a
          public form.
        </p>
        <p>
          A published listing can include property facts and media. It is not an invitation to
          contact the owner directly, because the owner’s personal number is not placed on the page.
          Enquiries come to GulbargaHomes first.
        </p>
      </LegalSection>

      <LegalSection id="enquiries" title="Buyer and tenant enquiries">
        <p>
          From a listing, the contact page, the footer, or a service page, you can call or open
          WhatsApp. Some WhatsApp links include a prepared sentence, such as the listing title and
          price, so we know which page you were on. You can edit that sentence before you send it.
        </p>
        <p>
          We use those conversations to answer you, arrange a viewing, and follow up about the
          property or service you asked about. If you ask us to arrange a visit, we may tell the
          owner or their representative that someone wants to see the property, and we may pass on
          the contact details needed for that visit. The website does not forward your message to
          the owner by itself.
        </p>
        <p>
          Our staff may record your enquiry in our private enquiry system, described below, so we
          can follow it up.
        </p>
        <p>
          There is no separate “book a viewing” form. A viewing request is a phone call or a
          WhatsApp or email message.
        </p>
      </LegalSection>

      <LegalSection id="joint-venture" title="Agricultural land joint ventures">
        <p>
          GulbargaHomes can introduce agricultural landowners to people or firms that may want to
          discuss a joint venture. The areas we are working in include Kalaburagi, Afzalpur,
          Kamalapur, Sedam, Kalagi, Jewargi, Nelogi, Shahabad, Chincholi and surrounding villages.
        </p>
        <p>
          An introduction is a conversation. It is not a promise of investment, development, a
          buyer, a valuation, a profit, or a signed agreement.
        </p>
        <p>
          The page{" "}
          <Link href="/agricultural-land-joint-venture" className="font-semibold text-brand-700 hover:underline">
            Agricultural land joint venture
          </Link>{" "}
          asks for your name, mobile number, village, taluk or nearby area, district, land extent
          and unit, ownership type, whether an RTC or Pahani is available, whether the land has
          road access, whether co-owners agree to a joint-venture discussion, and whether you want
          a development partnership. Email and extra notes are optional. The form does not ask you
          to upload an RTC, an identity document, or a bank record.
        </p>
        <p>
          You must acknowledge this Privacy Policy before the form opens WhatsApp. A second box,
          which you can leave unticked, is only for later messages about other joint-venture
          opportunities. You can send the enquiry without that box.
        </p>
        <p>If you submit the form, we use the details to:</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>register the enquiry in the WhatsApp chat the form opens;</li>
          <li>understand the land’s size and location;</li>
          <li>decide whether a joint-venture conversation is realistic;</li>
          <li>ask, where needed, about ownership and papers;</li>
          <li>consider a match with an investor or developer;</li>
          <li>arrange a call, meeting or introduction if you want that;</li>
          <li>follow up by phone, WhatsApp or, if you gave one, email;</li>
          <li>keep the conversation while it is still needed, as described under retention.</li>
        </ol>
        <p>
          The form does not write your answers into a website database. Choosing submit opens
          WhatsApp to {site.contacts[0].phoneDisplay} with the answers in the message. If WhatsApp
          does not open, nothing has been stored on the website. If you send the message, our
          staff may record the enquiry in our private enquiry system.
        </p>
      </LegalSection>

      <LegalSection id="meta" title="Meta ads and Instant Forms">
        <p>
          This website does not include a Meta Pixel and it does not use Meta’s Conversions API.
          Clicking around gulbargahomes.com does not send a copy of your visit to Facebook or
          Instagram from our code.
        </p>
        <p>
          We advertise on Facebook and Instagram, including ads that use a Meta Instant Form for
          property owners, tenants, buyers and landowners in Gulbarga (Kalaburagi). When you submit
          one of those forms, Meta collects your answers under Meta’s own terms and privacy policy
          and sends them to GulbargaHomes. Our system receives them automatically and records them
          in our private enquiry system. This includes:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>your name and mobile number, and your email if the form asks for it;</li>
          <li>the answers you gave about the property, your budget, the area and your timing;</li>
          <li>which form, advertisement and campaign the answers came from;</li>
          <li>whether you used Facebook or Instagram, and when you submitted the form.</li>
        </ul>
        <p>
          We use these details to call or message you about the enquiry you made and to keep a
          record of our follow-ups. Submitting a form does not list a property, does not publish
          your details, and does not share your number with an owner, tenant or buyer. Those steps
          need a separate conversation with you.
        </p>
        <p>
          Meta also keeps its own copy. We can act on the copy we hold. We cannot delete Meta’s copy
          for you; Meta provides its own controls.
        </p>
      </LegalSection>

      <LegalSection id="crm" title="Our private enquiry system">
        <p>
          The enquiry system is a private part of our admin, hosted on Cloudflare. It holds the
          people who contact us, the properties they want to list, the homes or land they are
          looking for, the source of each enquiry, and the calls, notes and follow-ups our staff
          record. It is not visible on the public website.
        </p>
        <p>
          Only authorised GulbargaHomes staff can sign in. Each signed-in person has a role that
          limits what they can see and change. Roles that do not need your mobile number see it
          partly hidden. Only our Super Admin can connect or disconnect Meta, and only our Super
          Admin can carry out a deletion request.
        </p>
        <p>
          The system keeps a history of who created or changed each record, so we can check how an
          enquiry was handled. That history cannot be edited after it is written.
        </p>
      </LegalSection>

      <LegalSection id="messages" title="Phone, WhatsApp and email">
        <p>These are different paths. They are not one automatic system.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-ink">Website form.</strong> Only the agricultural land
            joint-venture page collects typed answers, and only by placing them in a WhatsApp
            message you send.
          </li>
          <li>
            <strong className="text-ink">WhatsApp links.</strong> Other pages open WhatsApp, sometimes
            with a prepared sentence. The chat then continues in WhatsApp. We use the click-to-chat
            link <span className="whitespace-nowrap">wa.me</span>. We have not connected the
            WhatsApp Business Platform API.
          </li>
          <li>
            <strong className="text-ink">Telephone.</strong> Calling a published number is handled by
            your phone network and by us on that number. The website does not record the call.
          </li>
          <li>
            <strong className="text-ink">Email.</strong> {site.email} is a mailbox link. The website
            does not use a separate email-sending service, and it does not store a copy of emails
            you send.
          </li>
          <li>
            <strong className="text-ink">Meta Instant Forms.</strong> Received automatically from
            Meta and recorded in our private enquiry system, as described above.
          </li>
        </ul>
        <p>
          Please do not send identity documents, bank details or an RTC photograph through the
          website form. If a file is needed to check ownership, we will ask in the conversation,
          and you can refuse.
        </p>
      </LegalSection>

      <LegalSection id="collected" title="Information involved">
        <p>Depending on what you do, the information can include:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>your name, mobile number and, if you choose, email address;</li>
          <li>village, taluk or area, district, land size, unit and ownership answers;</li>
          <li>whether you say an RTC or Pahani is available, whether there is road access, and whether co-owners agree;</li>
          <li>anything you later say by phone, WhatsApp or email, including a viewing request;</li>
          <li>answers you give in a Meta Instant Form, and which advertisement and form you used;</li>
          <li>notes our staff make about calls, visits and follow-ups on your enquiry;</li>
          <li>the page you were on, when that is included in a prepared WhatsApp sentence;</li>
          <li>search words, if you use search;</li>
          <li>property addresses you save or recently open, stored in this browser;</li>
          <li>
            technical information such as IP address, browser and device type, which the host and
            Google Analytics can process, unless you have turned analytics off in this browser. Our
            own pages do not read your IP address into an account.
          </li>
        </ul>
        <p>
          We ask for land details that help us understand a joint-venture enquiry. Email is
          optional. We do not ask for Aadhaar, payment card or bank account numbers on the website.
        </p>
      </LegalSection>

      <LegalSection id="cookies-and-analytics" title="Cookies, storage and analytics">
        <p>
          The public pages do not set an account cookie. Your choices below are kept in this
          browser under the name <span className="font-medium text-ink">gh-analytics-consent</span>.
          Saved homes use <span className="font-medium text-ink">hh-favorites</span>. Recently
          viewed listings use <span className="font-medium text-ink">hh-recent</span>. Clearing
          site data for {site.domain} removes those.
        </p>
        <p>
          On the live site, Google Analytics 4 loads without a banner. The measurement ID in this
          project is G-47GFXYGBTL, unless that ID is replaced in deployment settings. The library
          is the Google tag (gtag.js). It is not a Google Tag Manager container. There is no Meta
          Pixel and no Google Ads tag, so those consent prompts are not used. Google’s extra
          consent rule for advertising tags applies to visitors in the EEA, the UK and Switzerland.
          The Digital Personal Data Protection Act, 2023 does not add a separate cookie-banner
          rule of that kind. This page is the notice for the analytics tag, and the buttons below
          are how you turn it off in this browser. A decline saved here stays off on later visits.
          It is not switched back on by itself. Leaving the buttons unused leaves measurement on.
          While measurement is on, Google can receive page addresses, approximate technical data,
          search words, and events such as a call click, a WhatsApp click, a saved home or a shared
          listing. Those events can include the listing name, locality and price, and which of our
          published phone numbers you clicked. They do not include your name or mobile number,
          because the site does not know them until you contact us.
        </p>
        <p>
          Microsoft Clarity code is present for a future project ID. No Clarity project ID is set
          in this project, so the Clarity script is not loaded.
        </p>
        <p>
          Cloudflare Workers hosts the site and may keep standard request logs, which can include
          IP address, browser type, time and the page requested, so the site can be delivered and
          protected. We do not use those logs as a marketing list. The listing desk keeps its own
          sign-in cookie after a successful password login. Ordinary visitors do not get that cookie.
        </p>
        <AnalyticsChoice />
      </LegalSection>

      <LegalSection id="advertising" title="Advertising measurement">
        <p>
          There is no Google Ads conversion tag and no Meta Pixel on this website. We do not run
          our own code to store Google click identifiers such as GCLID, GBRAID or WBRAID.
        </p>
        <p>
          While analytics is on, the Google tag can read campaign parameters that are
          already in the page address, such as UTM tags, and Google may use click identifiers that
          its own tag understands. We do not copy those values into a GulbargaHomes database.
        </p>
        <p>
          Ads on Facebook or Instagram, and any Instant Form attached to them, are measured by
          Meta inside Meta’s tools. That measurement is not a tag on this website.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="Who receives information">
        <p>We share information only as far as the activity requires.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-ink">Cloudflare.</strong> Hosts the site on Workers, stores
            listings in D1, stores new listing photos and videos in R2, and hosts our private
            enquiry system, including enquiries received from Meta Instant Forms.
          </li>
          <li>
            <strong className="text-ink">GitHub.</strong> Stores the website source, including the
            photos and videos that ship with the site. It does not store visitor enquiry forms.
          </li>
          <li>
            <strong className="text-ink">Google.</strong> Receives analytics unless you have turned
            the tag off in this browser. Fonts used on the site are included with the build; pages do not ask Google
            Fonts for a font on each visit.
          </li>
          <li>
            <strong className="text-ink">WhatsApp / Meta.</strong> Receives a chat when you choose to
            message us. Collects Instant Form answers if you submit one in an ad, and passes them to
            us. We do not send your enquiry records back to Meta.
          </li>
          <li>
            <strong className="text-ink">Your phone network.</strong> Connects a call you place to
            our published numbers.
          </li>
          <li>
            <strong className="text-ink">Property owners or their representatives.</strong> Only when
            we need to answer or arrange a visit you asked for.
          </li>
          <li>
            <strong className="text-ink">Investors or developers.</strong> Only as described in the
            next section.
          </li>
        </ul>
        <p>
          These are not active on this website: an email delivery provider, a payment service,
          Google Ads conversion tracking, Google Tag Manager, a Meta Pixel, and Meta’s Conversions
          API. Cloudinary is not in use unless hosting settings are
          later switched on for admin uploads.
        </p>
        <p>We do not sell personal information.</p>
      </LegalSection>

      <LegalSection id="introductions" title="Introductions to owners or developers">
        <p>
          Your mobile number and land or property details are not placed on the public website
          because you contacted us. A public listing is a separate step, done by our team after
          verification, and it uses GulbargaHomes contact numbers.
        </p>
        <p>
          If you ask us to introduce an agricultural land enquiry to an investor or developer, we
          may share the name, mobile number, email if you gave one, and the land details needed for
          that introduction. We tell you before we make that introduction. You can tell us not to.
          The acknowledgement on the joint-venture form covers this use. It is not permission for
          us to publish your number.
        </p>
      </LegalSection>

      <LegalSection id="purposes" title="Why we use information">
        <p>We use personal information to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>answer a property, service or joint-venture enquiry;</li>
          <li>record and follow up an enquiry you made, including through a Meta Instant Form;</li>
          <li>call or message you about that enquiry;</li>
          <li>check whether a listing or a land opportunity is genuine before we publish or introduce it;</li>
          <li>arrange a viewing or a meeting you asked for;</li>
          <li>make an introduction you asked for or acknowledged;</li>
          <li>send other joint-venture updates only if you ticked the optional box, or later asked for them;</li>
          <li>measure site use, unless you have turned analytics off in this browser;</li>
          <li>keep a record where a tax, accounting or legal duty requires it.</li>
        </ul>
        <p>
          Contact about an enquiry you started is part of answering you. Analytics runs on the live
          site unless this browser has a saved decline, which you can set or change in the section
          above. Marketing messages about other joint ventures run only with
          the optional box or a later request. You can withdraw that permission by contacting us.
          Withdrawing it does not erase a conversation we still need for an enquiry you already
          asked us to handle.
        </p>
      </LegalSection>

      <LegalSection id="children" title="Children">
        <p>
          The site is for property and land enquiries. It is not directed at children. We do not
          knowingly collect personal data from anyone under 18. If you believe a child has sent us
          their details, contact us and we will delete the messages we can still access.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="How long information is kept">
        <p>
          We keep an enquiry in our private enquiry system for 12 months after our last meaningful
          interaction with you about it, such as a call, a message, a visit, or a change to your
          listing or requirement. After that, our Super Admin reviews the record and deletes or
          anonymises it, unless you still have an active listing or enquiry with us, you have asked
          us to keep it, or a law that applies to us requires us to keep it. This review is done by
          hand. It is not an automatic timer, so a record can stay a little longer than 12 months
          until the next review.
        </p>
        <p>
          When our system receives a Meta Instant Form, it also keeps a working copy of the answers
          while it records the enquiry. That copy is cleared 30 days after the enquiry is recorded,
          found to be a repeat, or turned away. If a form needs our staff to check it first, the copy
          stays until they record it or set it aside; setting it aside clears it straight away.
          Technical logs of messages from Meta, which contain reference numbers but not your
          answers, are deleted after 90 days.
        </p>
        <p>
          The history of who created or changed a record is kept for as long as we operate the
          enquiry system, so we can show how our staff handled an enquiry. It can still contain
          your name and mobile number as they were first recorded, even after the enquiry itself
          has been deleted or anonymised. Only our Super Admin and inventory managers can view it.
        </p>
        <p>
          A WhatsApp chat, phone note or email stays in that tool while we still need it to answer
          you, finish a viewing or introduction, or meet a legal duty.
        </p>
        <p>
          Listing text and photos stay on the site until we edit or remove them. Browser saves stay
          until you remove them or clear site data. Analytics hits already sent to Google stay
          under Google’s own retention settings; we do not attach your name to those hits, so we
          cannot point Google at one person’s record from this website.
        </p>
      </LegalSection>

      <LegalSection id="security" title="Security">
        <p>
          We have no security certification to display. The public site is hosted on Cloudflare
          Workers. Our admin and private enquiry system are limited to authorised staff who sign
          in, and each role limits what that person can see. The access that lets our system read
          Meta Instant Forms is stored encrypted. Do not send
          document copies through the joint-venture form. No method of contact is free of risk,
          especially on WhatsApp and email.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="Your choices and requests">
        <p>You can ask us to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>tell you what personal information we hold about you in our enquiry system, and in chats and mail we control;</li>
          <li>correct something that is wrong;</li>
          <li>stop optional joint-venture updates;</li>
          <li>stop using your details for a new introduction;</li>
          <li>delete personal information where we are allowed to;</li>
          <li>raise a complaint.</li>
        </ul>
        <p>
          There is no login page where you can download a file of your data. We will reply using
          the phone, WhatsApp number or email you used. We may ask enough questions to avoid
          changing or deleting the wrong person’s conversation. We can refuse or limit a request
          where the law requires us to keep a record, or where we cannot find the conversation.
        </p>
        <p>
          The analytics buttons on this page apply to this browser only. They do not delete a
          WhatsApp chat.
        </p>
      </LegalSection>

      <LegalSection id="deletion" title="Deletion">
        <p>
          Use the{" "}
          <Link href="/data-deletion" className="font-semibold text-brand-700 hover:underline">
            data deletion
          </Link>{" "}
          page for the steps and the same contacts. Deletion requests are handled by hand by our
          Super Admin, after we confirm the request comes from you. We will delete or anonymise the
          enquiry records we hold about you, including Meta Instant Form answers, and mark your
          number so our staff do not contact you again, except where a law that applies to us
          requires us to keep something. We will not keep an optional marketing permission after
          you withdraw it.
        </p>
        <p>
          We keep the Meta reference number of a form you sent, which is not your name or number,
          so the same form is not imported again. The history of who changed a record is not
          edited, as explained under how long information is kept.
        </p>
        <p>
          We cannot, from this website, erase Meta’s copy of an Instant Form, Google’s copy of an
          analytics hit, or messages that remain on your own phone.
        </p>
      </LegalSection>

      <LegalSection id="grievance" title="Complaints">
        <p>
          Contact the phone numbers or email below and say that it is a privacy complaint. A
          separate grievance officer is not named on this website. Until a name is published, these
          business contacts are the route for privacy requests. Where a response period under the
          Digital Personal Data Protection Act, 2023 or its rules is in force for a request, we
          will follow that period. This notice does not invent a number of days.
        </p>
      </LegalSection>

      <LegalSection id="breach" title="If something goes wrong">
        <p>
          If we learn that personal data we hold has been accessed or shared when it should not
          have been, we will take reasonable steps to limit the harm and to inform affected people
          and any authority where a law in force requires that. We do not keep a public incident
          log on this website.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to this notice">
        <p>
          When this notice changes, we change the “last updated” date at the top. The current date
          is {PRIVACY_UPDATED_LABEL}. Older versions are not stored as separate pages on the site.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>Privacy requests and complaints:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          {site.contacts.map((contact) => (
            <li key={contact.phone}>
              Phone and WhatsApp: {contact.phoneDisplay}
            </li>
          ))}
          <li>Email: {site.email}</li>
          <li>Place: Kalaburagi, Karnataka 585101, India</li>
        </ul>
        <LegalLinks />
      </LegalSection>
    </LegalDocument>
  );
}

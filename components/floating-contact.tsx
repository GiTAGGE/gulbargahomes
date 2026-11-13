"use client";

import { EnquiryLaunchButton } from "@/components/enquiry/enquiry-provider";
import { site } from "@/lib/site";
import { trackPhoneClick } from "@/lib/analytics/track";

import { PhoneIcon } from "./icons";

export function FloatingContact() {
  return (
    <div className="fixed bottom-24 right-4 z-30 hidden flex-col gap-2 sm:bottom-5 sm:right-5 sm:flex md:bottom-5">
      <EnquiryLaunchButton
        launch={{ cta: "floating" }}
        className="grid h-12 w-12 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white shadow-lift transition-transform hover:scale-105"
        ariaLabel="Send an enquiry"
      >
        Ask
      </EnquiryLaunchButton>
      {site.contacts.map((contact) => (
        <a
          key={contact.phone}
          href={`tel:${contact.phone}`}
          aria-label={`Call ${contact.phoneDisplay}`}
          className="grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white shadow-lift transition-transform hover:scale-105"
          title={`Call ${contact.phoneDisplay}`}
          onClick={() =>
            trackPhoneClick("floating", { contact_phone: contact.phoneDisplay })
          }
        >
          <PhoneIcon className="h-5 w-5" />
        </a>
      ))}
    </div>
  );
}

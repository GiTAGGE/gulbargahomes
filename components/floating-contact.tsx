"use client";

import { site } from "@/lib/site";
import { trackPhoneClick, trackWhatsAppClick } from "@/lib/analytics/track";

import { PhoneIcon, WhatsAppIcon } from "./icons";

export function FloatingContact() {
  const waText = encodeURIComponent(
    "Hi GulbargaHomes, I'm interested in a property listed on your site.",
  );

  return (
    <div className="fixed bottom-24 right-4 z-30 hidden flex-col gap-2 sm:bottom-5 sm:right-5 sm:flex md:bottom-5">
      {site.contacts.map((contact) => (
        <a
          key={`wa-${contact.whatsapp}`}
          href={`https://wa.me/${contact.whatsapp}?text=${waText}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Chat on WhatsApp ${contact.phoneDisplay}`}
          className="grid h-12 w-12 place-items-center rounded-full bg-[#25D366] text-white shadow-lift transition-transform hover:scale-105"
          title={`WhatsApp ${contact.phoneDisplay}`}
          onClick={() => trackWhatsAppClick("floating")}
        >
          <WhatsAppIcon className="h-6 w-6" />
        </a>
      ))}
      {site.contacts.map((contact) => (
        <a
          key={contact.phone}
          href={`tel:${contact.phone}`}
          aria-label={`Call ${contact.phoneDisplay}`}
          className="grid h-12 w-12 place-items-center rounded-full bg-brand-600 text-white shadow-lift transition-transform hover:scale-105"
          title={`Call ${contact.phoneDisplay}`}
          onClick={() => trackPhoneClick("floating")}
        >
          <PhoneIcon className="h-5 w-5" />
        </a>
      ))}
    </div>
  );
}

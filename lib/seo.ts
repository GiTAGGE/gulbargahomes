import { formatPrice } from "./format";
import { site } from "./site";
import type { Property } from "./types";
import { propertyHasVideo } from "./types";

/** Trim text for HTML meta description tags (~155 chars for SERP snippets). */
export function metaDescription(text: string, maxLength = 155): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const truncated = normalized.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut.trimEnd()}…`;
}

export function residenceSchema(property: Property) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": property.propertyType === "Plot" ? "LandPlot" : "Residence",
    name: property.title,
    description: property.description,
    url: `${site.url}/properties/${property.slug}`,
    image: [property.coverImage, ...property.gallery].filter(Boolean),
    numberOfRooms: property.bhk ?? undefined,
    numberOfBathroomsTotal: property.bathrooms || undefined,
    floorSize: {
      "@type": "QuantitativeValue",
      value: property.area,
      unitText: "SqFt",
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: property.locality,
      addressRegion: site.region,
      addressCountry: "IN",
    },
    offers: {
      "@type": "Offer",
      price: property.price,
      priceCurrency: "INR",
      availability:
        property.status === "Available"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      description: `${property.listing} - ${formatPrice(property)}`,
    },
  };

  if (propertyHasVideo(property)) {
    schema.video = property.videos
      .filter((video) => video.src || video.youtubeUrl)
      .map((video) => ({
        "@type": "VideoObject",
        name: video.title || `${property.title} video tour`,
        description: property.description,
        thumbnailUrl: video.thumbnail || property.coverImage,
        contentUrl: video.src ? `${site.url}${video.src}` : undefined,
        embedUrl: video.youtubeUrl || undefined,
      }));
  }

  return schema;
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqSchema(faq: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: entry.answer,
      },
    })),
  };
}

export function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    name: site.name,
    alternateName: ["Gulbarga Homes", "Kalaburagi Homes"],
    description: site.description,
    url: site.url,
    telephone: site.phone,
    email: site.email,
    image: `${site.url}/images/hero/hero-desktop.webp`,
    priceRange: "₹₹",
    areaServed: [
      { "@type": "City", name: "Gulbarga" },
      { "@type": "City", name: "Kalaburagi" },
    ],
    address: {
      "@type": "PostalAddress",
      addressLocality: "Kalaburagi",
      addressRegion: site.region,
      addressCountry: "IN",
      postalCode: "585101",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: site.geo.latitude,
      longitude: site.geo.longitude,
    },
    knowsAbout: [
      "Houses for rent in Gulbarga",
      "Flats for rent in Kalaburagi",
      "Residential plots for sale in Gulbarga",
      "Independent houses for sale in Kalaburagi",
    ],
  };
}

export function itemListSchema(
  name: string,
  properties: Property[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    itemListElement: properties.slice(0, 12).map((property, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${site.url}/properties/${property.slug}`,
      name: property.title,
    })),
  };
}

export const homeFaqs = [
  {
    question: "Where can I find houses for rent in Gulbarga?",
    answer:
      "GulbargaHomes lists verified rental houses and independent homes across Sedam Road, Azadpur, Biddapur Colony, Jewargi Road, Shahbazar, Station Area and other Kalaburagi localities. Filter by BHK, budget, Vastu and family or bachelor preferences.",
  },
  {
    question: "Are Gulbarga and Kalaburagi the same city?",
    answer:
      "Yes. Kalaburagi is the official name of Gulbarga. People still search for houses, flats and plots using both names. GulbargaHomes covers the same city — rentals, house sales and residential plots across Kalaburagi.",
  },
  {
    question: "Which areas are best for plots for sale in Gulbarga?",
    answer:
      "Sedam Road, Kusnoor, Ring Road, Kalnoor, Jewargi Road and Aland Road are among the most searched residential plot locations in Kalaburagi. We list NA / layout plots with area, facing and nearby schools and hospitals.",
  },
  {
    question: "Do you list 2 BHK and 3 BHK flats for rent in Kalaburagi?",
    answer:
      "Yes. Browse 1 BHK, 2 BHK and 3 BHK flats for rent in Gulbarga with photos, videos, parking, furnishing and water-supply details. WhatsApp us from any listing to schedule a visit.",
  },
  {
    question: "How do I list my property on GulbargaHomes?",
    answer:
      "Call or WhatsApp our team. Owners and agents in Gulbarga / Kalaburagi can add rental homes, houses for sale and plots. The admin dashboard also supports property photos and walkthrough videos.",
  },
];

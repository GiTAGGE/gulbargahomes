import { formatPrice } from "./format";
import { site } from "./site";
import type { Property } from "./types";
import { propertyHasVideo } from "./types";
import {
  absoluteUrl,
  isoDurationFromSeconds,
  propertyUrl,
  youtubeEmbedUrl,
  youtubeThumbnailUrl,
} from "./url";

const DEFAULT_VIDEO_SECONDS = 6;
const LOGO_URL = `${site.url}/images/hero/hero-desktop.webp`;

function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function propertyImages(property: Property): string[] {
  return Array.from(
    new Set([property.coverImage, ...property.gallery].filter(Boolean)),
  ).map(absoluteUrl);
}

function accommodationType(property: Property): string {
  switch (property.propertyType) {
    case "Plot":
      return "LandPlot";
    case "Flat":
      return "Apartment";
    case "Villa":
    case "House":
      return "House";
    case "PG":
      return "Room";
    case "Commercial":
      return "Place";
    default:
      return "Residence";
  }
}

function videoThumbnail(property: Property, thumbnail: string, youtubeUrl: string): string {
  if (thumbnail) return absoluteUrl(thumbnail);
  const youtubeThumb = youtubeUrl ? youtubeThumbnailUrl(youtubeUrl) : undefined;
  if (youtubeThumb) return youtubeThumb;
  return absoluteUrl(property.coverImage);
}

function organizationRef() {
  return {
    "@type": "RealEstateAgent",
    "@id": `${site.url}/#business`,
    name: site.name,
    url: site.url,
    telephone: site.phone,
    logo: {
      "@type": "ImageObject",
      url: LOGO_URL,
    },
  };
}

/** Trim text for HTML meta description tags (~155 chars for SERP snippets). */
export function metaDescription(text: string, maxLength = 155): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const truncated = normalized.slice(0, maxLength - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated;
  return `${cut.trimEnd()}…`;
}

/**
 * RealEstateListing + accommodation `about`. Video is emitted separately so
 * Google Video rich results get a complete VideoObject (uploadDate + absolute URLs).
 */
export function listingSchema(property: Property) {
  const url = propertyUrl(property.slug);
  const images = propertyImages(property);
  const posted = isoDate(property.publishedAt);

  const about: Record<string, unknown> = {
    "@type": accommodationType(property),
    name: property.title,
    description: property.description,
    url,
    image: images,
    address: {
      "@type": "PostalAddress",
      streetAddress: property.locality,
      addressLocality: property.city,
      addressRegion: site.region,
      addressCountry: "IN",
    },
    floorSize: {
      "@type": "QuantitativeValue",
      value: property.area,
      unitCode: "FTK",
      unitText: "SqFt",
    },
  };

  if (property.bhk) about.numberOfRooms = property.bhk;
  if (property.bathrooms) about.numberOfBathroomsTotal = property.bathrooms;

  return {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": `${url}#listing`,
    url,
    name: property.title,
    description: property.description,
    datePosted: posted,
    dateModified: posted,
    image: images,
    inLanguage: "en-IN",
    about,
    offers: {
      "@type": "Offer",
      url,
      price: property.price,
      priceCurrency: "INR",
      availability:
        property.status === "Available"
          ? "https://schema.org/InStock"
          : "https://schema.org/SoldOut",
      description: `${property.listing} - ${formatPrice(property)}`,
      businessFunction:
        property.listing === "Rent"
          ? "https://schema.org/LeaseOut"
          : "https://schema.org/Sell",
    },
    publisher: organizationRef(),
  };
}

/** @deprecated Use listingSchema — kept so older imports keep working. */
export function residenceSchema(property: Property) {
  return listingSchema(property);
}

export function videoObjectSchemas(property: Property): Record<string, unknown>[] {
  if (!propertyHasVideo(property)) return [];

  const url = propertyUrl(property.slug);
  const posted = isoDate(property.publishedAt);

  return property.videos
    .filter((video) => video.src || video.youtubeUrl)
    .map((video, index) => {
      const thumbnail = videoThumbnail(property, video.thumbnail, video.youtubeUrl);
      const schema: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "@id": `${url}#video-${index + 1}`,
        name: video.title || `${property.title} video tour`,
        description: property.description,
        thumbnailUrl: [thumbnail],
        uploadDate: posted,
        duration: isoDurationFromSeconds(DEFAULT_VIDEO_SECONDS),
        isFamilyFriendly: true,
        inLanguage: "en-IN",
        url,
        mainEntityOfPage: url,
        publisher: organizationRef(),
      };

      if (video.src) {
        schema.contentUrl = absoluteUrl(video.src);
      }

      const embed = video.youtubeUrl ? youtubeEmbedUrl(video.youtubeUrl) : undefined;
      if (embed) {
        schema.embedUrl = embed;
      }

      return schema;
    });
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

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site.url}/#website`,
    name: site.name,
    alternateName: ["Gulbarga Homes", "Kalaburagi Homes"],
    url: site.url,
    inLanguage: "en-IN",
    description: site.description,
    publisher: { "@id": `${site.url}/#business` },
  };
}

export function localBusinessSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "RealEstateAgent",
    "@id": `${site.url}/#business`,
    name: site.name,
    alternateName: ["Gulbarga Homes", "Kalaburagi Homes"],
    description: site.description,
    url: site.url,
    telephone: site.phone,
    email: site.email,
    image: LOGO_URL,
    logo: {
      "@type": "ImageObject",
      url: LOGO_URL,
      width: 1200,
      height: 630,
    },
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
    contactPoint: {
      "@type": "ContactPoint",
      telephone: site.phone,
      contactType: "sales",
      areaServed: "IN",
      availableLanguage: ["English", "Kannada", "Hindi"],
    },
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
      url: propertyUrl(property.slug),
      name: property.title,
      image: absoluteUrl(property.coverImage),
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

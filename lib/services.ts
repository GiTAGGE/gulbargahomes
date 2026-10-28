import { site } from "./site";

export type ProjectStatus = "completed" | "ongoing" | "planning";

export type HomeService = {
  slug: string;
  title: string;
  href: string;
  summary: string;
  bullets: string[];
};

export type ShowcaseProject = {
  slug: string;
  name: string;
  category: string;
  locality: string;
  status: ProjectStatus;
  statusLabel: string;
  stageNote: string;
  image: string;
  disclaimer: string;
};

export const homeServices: HomeService[] = [
  {
    slug: "house-construction",
    title: "House Construction",
    href: "/house-construction",
    summary: "New homes, turnkey builds and structural work across Kalaburagi.",
    bullets: ["Independent houses & villas", "RCC structure & finishing", "Plot-to-home coordination"],
  },
  {
    slug: "modular-kitchens",
    title: "Modular Kitchens",
    href: "/modular-kitchens",
    summary: "Kitchen planning, cabinetry and remodelling for Gulbarga homes.",
    bullets: ["Layout & storage planning", "Modular & semi-modular options", "Countertops & fittings"],
  },
  {
    slug: "interior-design",
    title: "Interior Design",
    href: "/interior-design",
    summary: "Living rooms, bedrooms, wardrobes and complete home interiors.",
    bullets: ["Room-wise design", "Wardrobes & TV units", "Lighting & finishes"],
  },
  {
    slug: "home-renovation",
    title: "Home Renovation",
    href: "/home-renovation",
    summary: "Bathrooms, painting, flooring and full-home upgrades.",
    bullets: ["Bathroom & kitchen refresh", "Painting & flooring", "Structural tweaks"],
  },
];

/** Illustrative portfolio entries — replace with verified project photos when available. */
export const showcaseProjects: ShowcaseProject[] = [
  {
    slug: "contemporary-independent-home",
    name: "Contemporary Independent Home",
    category: "Residential construction",
    locality: "Example · Kalaburagi",
    status: "completed",
    statusLabel: "Completed",
    stageNote: "Design gallery, construction milestones and handover photos.",
    image: "/images/properties/house-sale-high-court/cover.webp",
    disclaimer: "Interactive design concept — illustrative example, not a verified GulbargaHomes project.",
  },
  {
    slug: "independent-home-build",
    name: "Independent Home Build",
    category: "House construction",
    locality: "Example · Kalaburagi",
    status: "ongoing",
    statusLabel: "Ongoing",
    stageNote: "Current stage: masonry — dated site updates and next milestone.",
    image: "/images/properties/2bhk-house-sale-high-court/cover.webp",
    disclaimer: "Interactive design concept — illustrative example, not a verified GulbargaHomes project.",
  },
  {
    slug: "modern-home-design",
    name: "Modern Home Design",
    category: "Design & planning",
    locality: "Example · Kalaburagi",
    status: "planning",
    statusLabel: "Planning",
    stageNote: "Proposed elevation and layout — renders are conceptual.",
    image: "/images/properties/30x40-plot-sale-sai-nagar/cover.webp",
    disclaimer: "Concept render — not completed work or a live GulbargaHomes commitment.",
  },
];

export const processSteps = [
  {
    title: "Tell us what you need",
    body: "Property search, new construction, interiors or renovation — share location, budget and timeline on WhatsApp or phone.",
  },
  {
    title: "Discuss scope",
    body: "We clarify requirements, site visit needs, materials and a realistic next step for Kalaburagi conditions.",
  },
  {
    title: "Connect with the right team",
    body: "Listings go live on GulbargaHomes; build projects are matched with suitable contractors and specialists.",
  },
  {
    title: "Track agreed next steps",
    body: "Site updates, estimates and milestones — with clear communication in Kannada, Hindi or English as you prefer.",
  },
];

export function whatsAppHref(message: string, contactIndex = 0): string {
  const contact = site.contacts[contactIndex] ?? site.contacts[0];
  return `https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(message)}`;
}

export function projectWhatsAppMessage(projectName: string): string {
  return `Hi GulbargaHomes, I'd like to enquire about a similar project: ${projectName} (seen on your website).`;
}

export function serviceWhatsAppMessage(serviceTitle: string): string {
  return `Hi GulbargaHomes, I'd like to discuss ${serviceTitle} for my home in Gulbarga / Kalaburagi.`;
}

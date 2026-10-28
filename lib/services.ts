import { site } from "./site";

export type { ProjectStatus } from "./project-meta";

export type HomeService = {
  slug: string;
  title: string;
  href: string;
  summary: string;
  bullets: string[];
  /** Representative photo from GulbargaHomes listings or site media — not a project guarantee. */
  image: string;
  imageAlt: string;
};

export const homeServices: HomeService[] = [
  {
    slug: "house-construction",
    title: "House Construction",
    href: "/house-construction",
    summary: "New homes, turnkey builds and structural work across Kalaburagi.",
    bullets: ["Independent houses & villas", "RCC structure & finishing", "Plot-to-home coordination"],
    image: "/images/projects/real/house-construction-scaffold-workers.webp",
    imageAlt: "Multi-storey home under construction with scaffolding — Kalaburagi site work.",
  },
  {
    slug: "modular-kitchens",
    title: "Modular Kitchens",
    href: "/modular-kitchens",
    summary: "Kitchen planning, cabinetry and remodelling for Gulbarga homes.",
    bullets: ["Layout & storage planning", "Modular & semi-modular options", "Countertops & fittings"],
    image: "/images/projects/modular-kitchen-main.webp",
    imageAlt: "Modern modular kitchen with marble counters and integrated lighting.",
  },
  {
    slug: "interior-design",
    title: "Interior Design",
    href: "/interior-design",
    summary: "Living rooms, bedrooms, wardrobes and complete home interiors.",
    bullets: ["Room-wise design", "Wardrobes & TV units", "Lighting & finishes"],
    image: "/images/projects/real/renovation-wardrobe-detail.webp",
    imageAlt: "Custom wardrobe and interior carpentry — GulbargaHomes project photo.",
  },
  {
    slug: "home-renovation",
    title: "Home Renovation",
    href: "/home-renovation",
    summary: "Bathrooms, painting, flooring and full-home upgrades.",
    bullets: ["Bathroom & kitchen refresh", "Painting & flooring", "Structural tweaks"],
    image: "/images/projects/real/renovation-cabinet-install.webp",
    imageAlt: "Built-in cabinetry and shelving installation on site in Kalaburagi.",
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

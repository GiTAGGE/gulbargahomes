import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "content", "properties");

const listings = [
  {
    slug: "1bhk-house-rent-biddapur-colony",
    title: "1 BHK House for Rent, Biddapur Colony Main Road (Veg Only)",
    listing: "Rent",
    propertyType: "House",
    bhk: 1,
    price: 5500,
    area: 520,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: true,
    vegetarian: "Yes",
    bachelors: "Not Allowed",
    family: "Preferred",
    parking: "Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    video: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "First Floor",
      "Main Road Facing",
      "Vegetarian Only",
      "Separate Kitchen",
      "Municipal + Borewell Water",
      "Bike Parking",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital", "District Hospital Kalaburagi"],
    busStop: "Biddapur Colony Stop – ~5 minutes",
    body: "Vegetarian-only 1 BHK on the first floor of a main-road house in Biddapur Colony, Gulbarga (Kalaburagi). Rent is ₹5,500/month for about 520 sqft with a separate kitchen and one bathroom. Families preferred — a compact, well-connected rental toward NH-65 / NH-50 without an apartment-maintenance bill.",
  },
  {
    slug: "house-sale-high-court",
    title: "House for Sale near High Court",
    listing: "Sale",
    propertyType: "House",
    bhk: 3,
    price: 16000000,
    area: 1850,
    locality: "High Court",
    facing: "East",
    vastu: true,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Preferred",
    parking: "Car + Bike",
    bathrooms: 3,
    furnished: "Unfurnished",
    featured: true,
    video: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "Karnataka High Court Kalaburagi Bench, Kalaburagi, Karnataka",
    amenities: [
      "Independent House",
      "Near High Court",
      "Compound Wall",
      "Car Porch",
      "Terrace",
      "Municipal + Borewell Water",
      "Vastu Layout",
    ],
    schools: ["Holy Cross Convent", "National Public School Kalaburagi"],
    hospitals: ["District Hospital Kalaburagi", "KIMS Kalaburagi"],
    busStop: "Court Circle / High Court – ~3 minutes",
    body: "East-facing 3 BHK independent house for sale near the High Court in Gulbarga (Kalaburagi). About 1850 sqft built-up with three bathrooms, car porch, terrace and dual water supply, listed at ₹1.60 crore. A ready family home in the court catchment — practical for advocates, government staff and buyers who want the Kalaburagi bench, District Court and city buses within a few minutes.",
  },
  {
    slug: "2bhk-house-sale-high-court",
    title: "House for Sale near High Court Gulbarga",
    listing: "Sale",
    propertyType: "House",
    bhk: 2,
    price: 8500000,
    area: 1100,
    locality: "High Court",
    facing: "North",
    vastu: true,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Preferred",
    parking: "Car + Bike",
    bathrooms: 2,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "Karnataka High Court Kalaburagi Bench, Kalaburagi, Karnataka",
    amenities: [
      "Independent House",
      "Near High Court",
      "Car Parking",
      "Compound",
      "Municipal Water",
      "Sit-out",
    ],
    schools: ["Holy Cross Convent", "National Public School Kalaburagi"],
    hospitals: ["District Hospital Kalaburagi"],
    busStop: "Court Circle / High Court – ~4 minutes",
    body: "North-facing 2 BHK independent house for sale near High Court, Gulbarga. 1100 sqft with two bathrooms, sit-out, compound and car parking, priced at ₹85 lakh. A realistic Kalaburagi buy for a small family that wants the court, offices and Court Circle buses without a Sedam Road premium.",
  },
  {
    slug: "30x40-plot-sale-high-court-attached",
    title: "30x40 Plot for Sale Attached to High Court",
    listing: "Sale",
    propertyType: "Plot",
    bhk: null,
    price: 4200000,
    area: 1200,
    locality: "High Court",
    facing: "East",
    vastu: true,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Open",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "Karnataka High Court Kalaburagi Bench, Kalaburagi, Karnataka",
    amenities: [
      "30x40 Site (1200 sqft)",
      "Attached to High Court",
      "Wide Approach Road",
      "Electricity",
      "Clear Title",
      "Residential Zone",
    ],
    schools: ["Holy Cross Convent", "National Public School Kalaburagi"],
    hospitals: ["District Hospital Kalaburagi"],
    busStop: "Court Circle / High Court – ~2 minutes",
    body: "East-facing 30x40 (1200 sqft) residential plot attached to the High Court in Gulbarga (Kalaburagi). ₹42 lakh with a wide approach, electricity and clear title — among the closest plots for sale to the Kalaburagi bench. Suited to a custom home or a long-hold land buy in the court pocket.",
  },
  {
    slug: "30x40-plot-sale-high-court",
    title: "30x40 Plot near High Court",
    listing: "Sale",
    propertyType: "Plot",
    bhk: null,
    price: 4200000,
    area: 1200,
    locality: "High Court",
    facing: "North",
    vastu: true,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Open",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "Karnataka High Court Kalaburagi Bench, Kalaburagi, Karnataka",
    amenities: [
      "30x40 Site (1200 sqft)",
      "Near High Court",
      "Layout Road",
      "Electricity",
      "Boundary Stones",
      "Residential Zone",
    ],
    schools: ["Holy Cross Convent", "Government PU College"],
    hospitals: ["District Hospital Kalaburagi"],
    busStop: "Court Circle / High Court – ~5 minutes",
    body: "North-facing 30x40 plot (1200 sqft) for sale near High Court, Gulbarga. ₹42 lakh with layout road, electricity and marked boundaries. A Vastu-friendly Kalaburagi site for buyers comparing High Court and Court Road land without leaving the city core.",
  },
  {
    slug: "residential-plot-sale-high-court",
    title: "30x40 near High Court",
    listing: "Sale",
    propertyType: "Plot",
    bhk: null,
    price: 4200000,
    area: 1200,
    locality: "High Court",
    facing: "West",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Open",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "High Court, Kalaburagi, Karnataka",
    amenities: [
      "30x40 Plot (1200 sqft)",
      "20 ft Road",
      "Electricity Nearby",
      "High Court Catchment",
      "Compound Possible",
    ],
    schools: ["Holy Cross Convent", "National Public School Kalaburagi"],
    hospitals: ["District Hospital Kalaburagi"],
    busStop: "Court Circle – ~6 minutes",
    body: "West-facing 30x40 residential plot near High Court, Kalaburagi. 1200 sqft on a 20 ft road at ₹42 lakh, with electricity nearby and room for a compound. A straightforward plot for sale in Gulbarga for a compact independent house in the court belt.",
  },
  {
    slug: "plot-sale-near-high-court",
    title: "30x40 Plot near High Court for Sale",
    listing: "Sale",
    propertyType: "Plot",
    bhk: null,
    price: 4200000,
    area: 1200,
    locality: "High Court",
    facing: "South",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Open",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    mapQuery: "High Court, Kalaburagi, Karnataka",
    amenities: [
      "30x40 Site (1200 sqft)",
      "Street Access",
      "Electricity",
      "Investment Plot",
      "Near High Court",
    ],
    schools: ["Holy Cross Convent"],
    hospitals: ["District Hospital Kalaburagi", "KIMS Kalaburagi"],
    busStop: "High Court / Court Circle – ~6 minutes",
    body: "South-facing 30x40 (1200 sqft) plot near High Court, Gulbarga, listed at ₹42 lakh. Street access and electricity in a High Court catchment — a Kalaburagi land option for investment or a future home close to courts and city hospitals.",
  },
  {
    slug: "1rk-house-rent-biddapur-colony",
    title: "1 Room Kitchen for Rent, First Floor, Biddapur Colony",
    listing: "Rent",
    propertyType: "House",
    bhk: 1,
    price: 4000,
    area: 380,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "First Floor",
      "1 Room + Kitchen",
      "Attached Bathroom",
      "Municipal Water",
      "Bike Parking",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital", "District Hospital Kalaburagi"],
    busStop: "Biddapur Colony Stop – ~5 minutes",
    body: "First-floor 1 RK (one room and kitchen) for rent in Biddapur Colony, Gulbarga (Kalaburagi). ₹4,000/month for about 380 sqft with a bathroom and bike parking. A budget rental for working bachelors or a small household that wants Biddapur without a full 1 BHK rent.",
  },
  {
    slug: "commercial-rent-playschool-biddapur-colony",
    title: "2 Rooms with Bathroom — Play School / Tuition, 1st Floor",
    listing: "Rent",
    propertyType: "Commercial",
    bhk: null,
    price: 8000,
    area: 650,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Street / Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "First Floor",
      "Two Rooms",
      "Attached Bathroom",
      "Suitable for Play School",
      "Tuition / Coaching",
      "Municipal Water",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital"],
    busStop: "Biddapur Colony Stop – ~4 minutes",
    body: "First-floor commercial space in Biddapur Colony, Gulbarga — two rooms with an attached bathroom, about 650 sqft, at ₹8,000/month. Layout suits a play school, tuition centre or coaching class in a residential Kalaburagi colony with schools and the Biddapur bus stop nearby.",
  },
  {
    slug: "commercial-rent-biddapur-colony-second-floor",
    title: "2000 Sqft Commercial Space for Rent with Single Room, Biddapur Colony 2nd Floor",
    listing: "Rent",
    propertyType: "Commercial",
    bhk: null,
    price: 25000,
    area: 2000,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Street / Bike",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "Second Floor",
      "2000 Sqft Open Hall",
      "Single Room Layout",
      "Commercial Use",
      "Power Connection",
      "Biddapur Colony",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital", "District Hospital Kalaburagi"],
    busStop: "Biddapur Colony Stop – ~5 minutes",
    body: "Second-floor 2000 sqft commercial hall for rent in Biddapur Colony, Gulbarga (Kalaburagi). A single-room layout at ₹25,000/month — useful as an office, training floor, showroom loft or studio. Open plan with power connection in a well-known Kalaburagi residential pocket.",
  },
  {
    slug: "commercial-rent-biddapur-colony-third-floor",
    title: "3rd Floor Commercial Space for Rent, 2000 Sqft Single Room and Bathroom",
    listing: "Rent",
    propertyType: "Commercial",
    bhk: null,
    price: 25000,
    area: 2000,
    locality: "Biddapur Colony",
    facing: "West",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Street / Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "Third Floor",
      "2000 Sqft Open Hall",
      "Single Room",
      "Attached Bathroom",
      "Commercial Use",
      "Power Connection",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital", "District Hospital Kalaburagi"],
    busStop: "Biddapur Colony Stop – ~5 minutes",
    body: "Third-floor 2000 sqft commercial space for rent in Biddapur Colony, Gulbarga. Single hall with an attached bathroom at ₹25,000/month. A Kalaburagi office or institutional floor for tenants who want the same 2000 sqft plate as the second floor, with a dedicated washroom.",
  },
  {
    slug: "student-room-rent-biddapur-colony",
    title: "4th Floor Room for Students with Open Terrace and Attached Bathroom, Biddapur Colony",
    listing: "Rent",
    propertyType: "PG",
    bhk: 1,
    price: 3500,
    area: 180,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: false,
    vegetarian: "Preferred",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "Fourth Floor",
      "Attached Bathroom",
      "Open Terrace",
      "Student Friendly",
      "Bike Parking",
      "Municipal Water",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital"],
    busStop: "Biddapur Colony Stop – ~5 minutes",
    body: "Fourth-floor student room in Biddapur Colony, Gulbarga (Kalaburagi), with an attached bathroom and open terrace. About 180 sqft at ₹3,500/month, bike parking included. A simple PG-style stay for students or working bachelors who want terrace access in a residential colony rather than the university belt.",
  },
  {
    slug: "shop-rent-biddapur-colony",
    title: "Shop for Rent, Road Attached, 250 Sqft",
    listing: "Rent",
    propertyType: "Commercial",
    bhk: null,
    price: 5000,
    area: 250,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: false,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Street",
    bathrooms: 0,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "Road Facing",
      "Ground Floor",
      "250 Sqft Shop",
      "Street Frontage",
      "High Visibility",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital"],
    busStop: "Biddapur Colony Stop – ~3 minutes",
    body: "Road-attached 250 sqft shop for rent in Biddapur Colony, Gulbarga. Ground-floor frontage at ₹5,000/month — suited to a kirana, mobile shop, clinic desk or small services counter on a Kalaburagi colony main street with walk-in visibility.",
  },
  {
    slug: "commercial-rent-bank-biddapur-colony",
    title: "Ground Floor 2000 Sqft for Bank Rent with Bathroom, Biddapur Colony",
    listing: "Rent",
    propertyType: "Commercial",
    bhk: null,
    price: 25000,
    area: 2000,
    locality: "Biddapur Colony",
    facing: "East",
    vastu: true,
    vegetarian: "Not Required",
    bachelors: "Allowed",
    family: "Allowed",
    parking: "Car + Bike",
    bathrooms: 1,
    furnished: "Unfurnished",
    featured: true,
    publishedAt: "2026-09-16T10:00:00.000Z",
    amenities: [
      "Ground Floor",
      "2000 Sqft",
      "Attached Bathroom",
      "Suitable for Bank",
      "Office / Institutional",
      "Road Access",
      "Car Parking",
    ],
    schools: ["Chanakya School", "Mehta School"],
    hospitals: ["Sri Venkat Sai Hospital", "District Hospital Kalaburagi"],
    busStop: "Biddapur Colony Stop – ~3 minutes",
    body: "Ground-floor 2000 sqft commercial hall in Biddapur Colony, Gulbarga (Kalaburagi), offered at ₹25,000/month with an attached bathroom and car parking. Plate size and road access suit a bank branch, NBFC, or a large office. Same 2000 sqft footprint as the upper commercial floors, with the advantage of ground-level entry.",
  }
];

function yamlList(items, indent = 2) {
  const pad = " ".repeat(indent);
  return items.map((item) => `${pad}- ${item}`).join("\n");
}

function faqBlock(entry) {
  const type = entry.propertyType.toLowerCase();
  const verb = entry.listing === "Rent" ? "rent" : "buy";
  const faqs = [
    {
      question: `Is this ${type} in ${entry.locality} still available?`,
      answer: `Yes — contact GulbargaHomes to confirm the latest status and book a visit in ${entry.locality}, Gulbarga (Kalaburagi).`,
    },
    {
      question: `Can I ${verb} this property as a family?`,
      answer: `Family is ${entry.family.toLowerCase()}. ${entry.bachelors === "Allowed" ? "Bachelors are also allowed." : "Bachelors are not allowed."}`,
    },
    {
      question: "How far is Kalaburagi Junction?",
      answer: "Kalaburagi Junction (Gulbarga railway station) is the city's main rail head. See the listing map and WhatsApp us for exact travel time from this locality.",
    },
  ];
  if (entry.vastu) {
    faqs.push({
      question: "Is the property Vastu compliant?",
      answer: `Yes. This ${type} is ${entry.facing.toLowerCase()}-facing and listed as Vastu compliant.`,
    });
  }
  return faqs
    .map(
      (faq) =>
        `  - question: ${JSON.stringify(faq.question)}\n    answer: ${JSON.stringify(faq.answer)}`,
    )
    .join("\n");
}

function toMdx(entry) {
  const priceSuffix = entry.listing === "Rent" ? "/month" : "";
  const bhkLine = entry.bhk === null ? "" : `bhk: ${entry.bhk}\n`;
  const publishedAt = entry.publishedAt ?? "2026-08-28T12:00:00.000Z";
  const mapQuery = entry.mapQuery ?? `${entry.locality}, Kalaburagi, Karnataka`;
  const videoBlock = entry.video
    ? `videos:
  - title: ${JSON.stringify(`${entry.title} video tour`)}
    src: /videos/properties/${entry.slug}.mp4
    thumbnail: /images/properties/${entry.slug}/cover.webp
`
    : "";

  return `---
slug: ${entry.slug}
title: ${entry.title}
listing: ${entry.listing}
status: Available
propertyType: ${entry.propertyType}
${bhkLine}price: ${entry.price}
priceSuffix: ${priceSuffix}
area: ${entry.area}
locality: ${entry.locality}
city: Gulbarga
facing: ${entry.facing}
vastu: ${entry.vastu}
vegetarian: ${entry.vegetarian}
bachelors: ${entry.bachelors}
family: ${entry.family}
parking: ${entry.parking}
bathrooms: ${entry.bathrooms}
furnished: ${entry.furnished}
featured: ${entry.featured}
isNew: true
publishedAt: ${publishedAt}
amenities:
${yamlList(entry.amenities)}
rules:
  - Bachelors ${entry.bachelors}
  - Family ${entry.family}
  - Vegetarian ${entry.vegetarian}
nearby:
  schools:
${yamlList(entry.schools, 4)}
  hospitals:
${yamlList(entry.hospitals, 4)}
  busStop: ${entry.busStop}
  railway: Kalaburagi Junction (Gulbarga) – city rail head
faq:
${faqBlock(entry)}
mapQuery: ${mapQuery}
coverImage: /images/properties/${entry.slug}/cover.webp
gallery:
  - /images/properties/${entry.slug}/1.webp
  - /images/properties/${entry.slug}/2.webp
${videoBlock}---
${entry.body}
`;
}

fs.mkdirSync(ROOT, { recursive: true });
for (const entry of listings) {
  fs.writeFileSync(path.join(ROOT, `${entry.slug}.mdx`), toMdx(entry));
}
console.log(`Wrote ${listings.length} Gulbarga listings.`);

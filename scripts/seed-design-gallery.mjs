/**
 * One-off seed: converts uploaded JPGs to WebP and writes content/designs MDX.
 * Run: node scripts/seed-design-gallery.mjs
 */
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

const ROOT = process.cwd();
const ASSETS = "/home/ubuntu/.cursor/projects/workspace/assets";
const OUT = path.join(ROOT, "public", "images", "designs");
const CONTENT = path.join(ROOT, "content", "designs");

const designs = [
  ["f8025874-d146-4778-8168-60eaae3a4dc9.jpg", "u-shaped-modular-kitchen", "U-Shaped Modular Kitchen", "Modular kitchen"],
  ["10100729-7819-42cd-b522-b8073de7ae45.jpg", "sage-green-kitchen", "Sage Green Kitchen", "Modular kitchen"],
  ["e47ff72f-ebbf-45e2-bc14-f551baa0372d.jpg", "dining-kitchen-layout", "Dining & Kitchen Layout", "Dining"],
  ["fc5cad31-3bea-46ba-a8b6-a474dcffcc32.jpg", "ceiling-grid-chandelier", "Ceiling Grid & Chandelier", "Ceiling design"],
  ["cac382ec-16ee-46f1-96d1-95fe6b8f0474.jpg", "cove-ceiling-fan", "Cove Ceiling & Fan", "Ceiling design"],
  ["798855e8-08d2-4763-a2c7-8dd8d3f76054.jpg", "master-bedroom-suite", "Master Bedroom Suite", "Bedroom"],
  ["8c061317-2729-43c7-bb23-c5743bfbd65a.jpg", "designer-bedroom-wardrobes", "Bedroom with Wardrobes", "Bedroom"],
  ["9b7291b1-7664-4a2a-a02b-814e63beb7b0.jpg", "premium-hallway", "Premium Hallway", "Hallway"],
  ["7b0af461-fec9-41fd-b7ae-4429e7edfed9.jpg", "hallway-art-lighting", "Hallway Art & Lighting", "Hallway"],
  ["92fa553c-1539-41b8-8f03-797d6e844e19.jpg", "bedroom-tv-wall", "Bedroom TV Wall", "Bedroom"],
  ["201d263b-084e-4493-af23-37b2493e65cd.jpg", "living-room-feature-wall", "Living Room Feature Wall", "Living room"],
  ["06e68959-9427-45d8-8a03-0eaebdbb3398.jpg", "living-marble-tv-unit", "Living Room Marble TV Unit", "Living room"],
  ["c67596ab-eaa2-450a-a146-ebefde4ed586.jpg", "tray-ceiling-chandelier", "Tray Ceiling & Chandelier", "Ceiling design"],
  ["98e74ebc-e347-4308-a382-128b0034d654.jpg", "false-ceiling-cove", "False Ceiling Cove Lighting", "Ceiling design"],
  ["c97d208d-e9f2-4006-b45e-a519c66ea7d0.jpg", "modular-kitchen-display", "Modular Kitchen Display", "Modular kitchen"],
  ["ac03b182-7aa4-4d9e-b316-9ce876645e2f.jpg", "bedroom-feature-map", "Bedroom Feature Wall", "Bedroom"],
  ["a2601027-7569-4c6b-a89f-06cdbe3bcf28.jpg", "study-home-office", "Study & Home Office", "Study"],
  ["c1b68a31-1420-4b3a-a99f-472b7ea5c9a1.jpg", "dining-ceiling-grid", "Dining Ceiling Grid", "Dining"],
  ["ee981031-7f30-4ccb-8d55-7f9053485908.jpg", "bedroom-ceiling-fan", "Bedroom Ceiling Design", "Bedroom"],
];

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CONTENT, { recursive: true });

for (const [file, slug, title, roomType] of designs) {
  const src = path.join(ASSETS, file);
  if (!fs.existsSync(src)) {
    console.error("Missing", file);
    process.exitCode = 1;
    continue;
  }
  const webp = path.join(OUT, `${slug}.webp`);
  await sharp(src)
    .rotate()
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(webp);

  const featured = ["u-shaped-modular-kitchen", "master-bedroom-suite", "premium-hallway"].includes(
    slug,
  );

  const mdx = `---
slug: ${slug}
title: ${title}
roomType: ${roomType}
featured: ${featured}
image: /images/designs/${slug}.webp
sortOrder: ${designs.findIndex((d) => d[1] === slug)}
---

Finalized **${roomType.toLowerCase()}** design preview for Gulbarga / Kalaburagi homes — layout, finishes and lighting planned before on-site execution.
`;

  fs.writeFileSync(path.join(CONTENT, `${slug}.mdx`), mdx);
  console.log("OK", slug);
}

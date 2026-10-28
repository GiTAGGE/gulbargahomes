import "server-only";

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

const CONTENT_DIR = path.join(process.cwd(), "content", "designs");

export type InteriorDesign = {
  slug: string;
  title: string;
  roomType: string;
  image: string;
  featured: boolean;
  sortOrder: number;
  body: string;
};

let cache: InteriorDesign[] | null = null;

function normalizeImage(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http") || raw.startsWith("/")) return raw;
  return `/images/designs/${raw.replace(/^\/+/, "")}`;
}

function parseDesign(file: string): InteriorDesign {
  const filePath = path.join(CONTENT_DIR, file);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  return {
    slug: String(data.slug ?? file.replace(/\.mdx$/, "")),
    title: String(data.title ?? "Design preview"),
    roomType: String(data.roomType ?? "Interior"),
    image: normalizeImage(data.image),
    featured: Boolean(data.featured),
    sortOrder: Number(data.sortOrder ?? 0),
    body: content.trim(),
  };
}

export function getAllDesigns(): InteriorDesign[] {
  if (process.env.NODE_ENV === "production" && cache) return cache;

  if (!fs.existsSync(CONTENT_DIR)) return [];

  const designs = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map(parseDesign);

  designs.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
  });

  if (process.env.NODE_ENV === "production") {
    cache = designs;
  }
  return designs;
}

export function getDesign(slug: string): InteriorDesign | undefined {
  return getAllDesigns().find((design) => design.slug === slug);
}

export function getDesignRoomTypes(): string[] {
  return Array.from(new Set(getAllDesigns().map((d) => d.roomType))).sort();
}

export function clearDesignCache() {
  cache = null;
}

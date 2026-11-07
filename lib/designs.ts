import "server-only";

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import designSeed from "./design-seed.json";

const CONTENT_DIR = path.join(process.cwd(), "content", "designs");

type ContentSeed = {
  slug: string;
  body: string;
  data: Record<string, unknown>;
};

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

function designsFromDisk(): InteriorDesign[] | null {
  try {
    if (!fs.existsSync(CONTENT_DIR)) return null;
    const files = fs.readdirSync(CONTENT_DIR).filter((file) => file.endsWith(".mdx"));
    if (files.length === 0) return null;
    return files.map(parseDesign);
  } catch {
    // Cloudflare Workers do not expose content/ at process.cwd().
    return null;
  }
}

function designsFromSeed(): InteriorDesign[] {
  return (designSeed as ContentSeed[]).map((record) => {
    const data = record.data;
    return {
      slug: String(data.slug ?? record.slug),
      title: String(data.title ?? "Design preview"),
      roomType: String(data.roomType ?? "Interior"),
      image: normalizeImage(data.image),
      featured: Boolean(data.featured),
      sortOrder: Number(data.sortOrder ?? 0),
      body: record.body,
    };
  });
}

export function getAllDesigns(): InteriorDesign[] {
  if (process.env.NODE_ENV === "production" && cache) return cache;

  const designs = designsFromDisk() ?? designsFromSeed();

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

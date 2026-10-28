import "server-only";

import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import { canonicalLocalityName } from "./locality";
import type { ProjectStatus } from "./project-meta";
export type { ProjectStatus } from "./project-meta";
export { projectMetaLine } from "./project-meta";
import { site } from "./site";

const CONTENT_DIR = path.join(process.cwd(), "content", "projects");

export type ProjectCategory =
  | "House construction"
  | "Modular kitchen"
  | "Interior design"
  | "Home renovation"
  | "Residential construction"
  | "Design & planning"
  | "Other";

export type PortfolioProject = {
  slug: string;
  name: string;
  category: ProjectCategory | string;
  locality: string;
  city: string;
  status: ProjectStatus;
  statusLabel: string;
  summary: string;
  constructionStage: string;
  builtUpArea: string;
  scope: string;
  startedAt: string;
  completedAt: string;
  coverImage: string;
  gallery: string[];
  featured: boolean;
  isExample: boolean;
  disclaimer: string;
  body: string;
};

let cache: PortfolioProject[] | null = null;

const STATUS_LABELS: Record<ProjectStatus, string> = {
  completed: "Completed",
  ongoing: "Ongoing",
  planning: "Planning",
  upcoming: "Upcoming",
};

function normalizeImagePath(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http") || raw.startsWith("/")) return raw;
  return `/images/projects/${raw.replace(/^\/+/, "")}`;
}

function normalizeGallery(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return normalizeImagePath(entry);
      if (entry && typeof entry === "object" && "image" in entry) {
        return normalizeImagePath((entry as { image: unknown }).image);
      }
      return "";
    })
    .filter(Boolean);
}

function defaultDisclaimer(isExample: boolean): string {
  if (!isExample) {
    return "Project details and photographs published by GulbargaHomes for Gulbarga / Kalaburagi.";
  }
  return "Illustrative example for layout — replace with verified project photos and scope in the admin when ready.";
}

function normalizeProject(
  data: Record<string, unknown>,
  body: string,
): PortfolioProject {
  const status = (data.status as ProjectStatus) ?? "planning";
  const isExample = data.isExample !== false;
  const name = String(data.name ?? data.title ?? "Untitled project");

  return {
    slug: String(data.slug ?? ""),
    name,
    category: String(data.category ?? "House construction"),
    locality: canonicalLocalityName(String(data.locality ?? site.city)),
    city: String(data.city ?? site.city),
    status,
    statusLabel: String(data.statusLabel ?? STATUS_LABELS[status] ?? status),
    summary: String(data.summary ?? data.stageNote ?? "").trim(),
    constructionStage: String(data.constructionStage ?? ""),
    builtUpArea: String(data.builtUpArea ?? ""),
    scope: String(data.scope ?? ""),
    startedAt: String(data.startedAt ?? ""),
    completedAt: String(data.completedAt ?? ""),
    coverImage: normalizeImagePath(data.coverImage),
    gallery: normalizeGallery(data.gallery),
    featured: Boolean(data.featured),
    isExample,
    disclaimer: String(data.disclaimer ?? defaultDisclaimer(isExample)),
    body: body.trim(),
  };
}

function parseProject(file: string): PortfolioProject {
  const filePath = path.join(CONTENT_DIR, file);
  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);
  return normalizeProject(data as Record<string, unknown>, content);
}

export function getAllProjects(): PortfolioProject[] {
  if (process.env.NODE_ENV === "production" && cache) return cache;

  if (!fs.existsSync(CONTENT_DIR)) return [];

  const projects = fs
    .readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith(".mdx"))
    .map(parseProject);

  projects.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (process.env.NODE_ENV === "production") {
    cache = projects;
  }
  return projects;
}

export function getProject(slug: string): PortfolioProject | undefined {
  return getAllProjects().find((project) => project.slug === slug);
}

export function getProjectsByStatus(status: ProjectStatus): PortfolioProject[] {
  return getAllProjects().filter((project) => project.status === status);
}

export function clearProjectCache() {
  cache = null;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { ProjectStatus } from "@/lib/project-meta";
import { projectMetaLine, projectStatusBadgeClass } from "@/lib/project-meta";
import type { PortfolioProject } from "@/lib/projects";

import { ArrowIcon } from "./icons";

type TabId = "all" | ProjectStatus;

const tabs: { id: TabId; label: string }[] = [
  { id: "all", label: "All Projects" },
  { id: "completed", label: "Completed" },
  { id: "ongoing", label: "Ongoing" },
  { id: "upcoming", label: "Upcoming" },
];

function statusBadgeClass(status: ProjectStatus): string {
  return projectStatusBadgeClass(status);
}

export type ProjectPortfolioCardModel = Pick<
  PortfolioProject,
  | "slug"
  | "name"
  | "status"
  | "statusLabel"
  | "summary"
  | "coverImage"
  | "isExample"
  | "category"
  | "locality"
>;

function toCardModel(project: PortfolioProject): ProjectPortfolioCardModel {
  return {
    slug: project.slug,
    name: project.name,
    status: project.status,
    statusLabel: project.statusLabel,
    summary: project.summary,
    coverImage: project.coverImage,
    isExample: project.isExample,
    category: project.category,
    locality: project.locality,
  };
}

export function ProjectPortfolioShowcase({
  projects,
  compact = false,
}: {
  projects: PortfolioProject[];
  compact?: boolean;
}) {
  const models = useMemo(() => projects.map(toCardModel), [projects]);
  const [tab, setTab] = useState<TabId>("all");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => {
    if (tab === "all") return models;
    if (tab === "upcoming") {
      return models.filter((p) => p.status === "upcoming" || p.status === "planning");
    }
    return models.filter((p) => p.status === tab);
  }, [models, tab]);

  const active = filtered[index] ?? filtered[0];

  const selectTab = (id: TabId) => {
    setTab(id);
    setIndex(0);
  };

  if (!models.length) {
    return (
      <div className="rounded-3xl border border-brand-100 bg-white p-8 text-center text-sm text-ink-muted">
        No projects published yet. Add your first project in{" "}
        <Link href="/admin/index.html" className="font-semibold text-brand-600">
          admin
        </Link>
        .
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-3xl border border-brand-100/80 bg-white shadow-[0_32px_64px_-32px_rgba(15,42,36,0.18)] ${
        compact ? "" : "ring-1 ring-black/[0.03]"
      }`}
    >
      <div className="flex flex-wrap gap-2 border-b border-brand-100/80 p-4 sm:p-5">
        {tabs.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTab(item.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                selected
                  ? "bg-ink text-white shadow-soft"
                  : "bg-surface text-ink-muted hover:bg-brand-50 hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {active ? (
        <ProjectFeaturedCard
          project={active}
          filteredCount={filtered.length}
          index={Math.min(index, filtered.length - 1)}
          onPrev={() => setIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))}
          onNext={() => setIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1))}
        />
      ) : (
        <div className="p-8 text-center text-sm text-ink-muted">
          No {tab === "all" ? "" : tab} projects yet.
        </div>
      )}
    </div>
  );
}

function ProjectFeaturedCard({
  project,
  filteredCount,
  index,
  onPrev,
  onNext,
}: {
  project: ProjectPortfolioCardModel;
  filteredCount: number;
  index: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const meta = projectMetaLine(project);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link href={`/projects/${project.slug}`} className="group block">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-brand-50 sm:aspect-[2/1]">
          {project.coverImage ? (
            <Image
              src={project.coverImage}
              alt=""
              fill
              className="object-cover transition duration-700 group-hover:scale-[1.02]"
              sizes="(max-width: 768px) 100vw, 900px"
              priority
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-ink-faint">Add cover image</div>
          )}
        </div>
      </Link>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/projects/${project.slug}`}
              className="text-xl font-bold tracking-tight text-ink sm:text-2xl hover:text-brand-700"
            >
              {project.name}
            </Link>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusBadgeClass(project.status)}`}
            >
              {project.statusLabel}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-muted">{meta}</p>
        </div>

        {filteredCount > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              className="grid h-10 w-10 place-items-center rounded-full border border-brand-100 text-ink hover:bg-brand-50"
              aria-label="Previous project"
            >
              ‹
            </button>
            <span className="text-xs font-medium text-ink-faint">
              {index + 1} / {filteredCount}
            </span>
            <button
              type="button"
              onClick={onNext}
              className="grid h-10 w-10 place-items-center rounded-full border border-brand-100 text-ink hover:bg-brand-50"
              aria-label="Next project"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <details className="group/details mt-4 rounded-2xl border border-brand-100/80 bg-surface/60 open:bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink marker:hidden">
          <span className="line-clamp-1 text-ink-muted group-open/details:text-ink">
            {project.summary || "View project story, gallery and construction details."}
          </span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-brand-100 bg-white text-lg leading-none text-ink-faint group-open/details:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-brand-100/80 px-4 py-4 text-sm leading-relaxed text-ink-muted">
          <Link
            href={`/projects/${project.slug}`}
            className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700"
          >
            Open full project page <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>
      </details>
    </div>
  );
}

export function ProjectPortfolioGrid({ projects }: { projects: PortfolioProject[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {projects.map((project) => (
        <Link
          key={project.slug}
          href={`/projects/${project.slug}`}
          className="card overflow-hidden p-0 transition hover:-translate-y-0.5"
        >
          <div className="relative aspect-[16/10]">
            {project.coverImage ? (
              <Image src={project.coverImage} alt="" fill className="object-cover" sizes="400px" />
            ) : null}
            <span
              className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusBadgeClass(project.status)}`}
            >
              {project.statusLabel}
            </span>
          </div>
          <div className="p-5">
            <h2 className="text-lg font-bold text-ink">{project.name}</h2>
            <p className="mt-1 text-xs text-ink-muted">{projectMetaLine(project)}</p>
            <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{project.summary}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { ArrowIcon } from "@/components/icons";
import { ProjectPortfolioGrid, ProjectPortfolioShowcase } from "@/components/project-portfolio";
import { getAllProjects } from "@/lib/projects";
import { metaDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Projects",
  description: metaDescription(
    "Construction, interior and renovation projects in Gulbarga and Kalaburagi — completed work, ongoing sites and upcoming scopes.",
  ),
};

export default function ProjectsIndexPage() {
  const projects = getAllProjects();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ArrowIcon className="h-4 w-4 rotate-180" /> Home
      </Link>
      <h1 className="mt-6 text-3xl font-bold text-ink sm:text-4xl">Project portfolio</h1>
      <p className="mt-3 max-w-2xl text-ink-muted">
        Browse completed homes, ongoing construction and upcoming renovation work across Kalaburagi.
        Add or edit projects in{" "}
        <Link href="/admin/index.html" className="font-semibold text-brand-600">
          admin
        </Link>
        .
      </p>

      <div className="mt-10">
        <ProjectPortfolioShowcase projects={projects} />
      </div>

      <div className="mt-14">
        <h2 className="text-xl font-bold text-ink">All project stories</h2>
        <div className="mt-6">
          <ProjectPortfolioGrid projects={projects} />
        </div>
      </div>
    </div>
  );
}

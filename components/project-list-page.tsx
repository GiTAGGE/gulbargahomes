import Image from "next/image";
import Link from "next/link";

import { ArrowIcon } from "@/components/icons";
import { showcaseProjects, type ProjectStatus } from "@/lib/services";

export function ProjectListPage({
  title,
  intro,
  status,
}: {
  title: string;
  intro: string;
  status: ProjectStatus;
}) {
  const items = showcaseProjects.filter((p) => p.status === status);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
        <ArrowIcon className="h-4 w-4 rotate-180" /> Home
      </Link>
      <h1 className="mt-6 text-3xl font-bold text-ink">{title}</h1>
      <p className="mt-3 max-w-2xl text-ink-muted">{intro}</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((project) => (
          <Link
            key={project.slug}
            href={`/projects/${project.slug}`}
            className="card overflow-hidden p-0"
          >
            <div className="relative h-48">
              <Image src={project.image} alt="" fill className="object-cover" sizes="400px" />
            </div>
            <div className="p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
                {project.statusLabel}
              </p>
              <h2 className="mt-1 text-lg font-bold text-ink">{project.name}</h2>
              <p className="mt-2 text-sm text-ink-muted">{project.stageNote}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

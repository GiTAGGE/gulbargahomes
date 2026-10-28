import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowIcon, WhatsAppIcon } from "@/components/icons";
import { getAllProjects, getProject, projectMetaLine } from "@/lib/projects";
import { projectWhatsAppMessage, whatsAppHref } from "@/lib/services";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return getAllProjects().map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Props) {
  const project = getProject(params.slug);
  if (!project) return {};
  return {
    title: project.name,
    description: project.summary,
  };
}

export default function ProjectDetailPage({ params }: Props) {
  const project = getProject(params.slug);
  if (!project) notFound();

  const wa = whatsAppHref(projectWhatsAppMessage(project.name));
  const backHref =
    project.status === "ongoing"
      ? "/projects/ongoing"
      : project.status === "completed"
        ? "/projects/completed"
        : "/projects";

  const gallery = [project.coverImage, ...project.gallery].filter(
    (src, index, all) => src && all.indexOf(src) === index,
  );

  return (
    <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"
      >
        <ArrowIcon className="h-4 w-4 rotate-180" /> Back to projects
      </Link>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-brand-700">
        {project.statusLabel}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-ink">{project.name}</h1>
      <p className="mt-2 text-ink-muted">{projectMetaLine(project)}</p>

      <div className="relative mt-8 aspect-[16/10] overflow-hidden rounded-2xl bg-brand-50">
        {project.coverImage ? (
          <Image src={project.coverImage} alt="" fill className="object-cover" sizes="900px" priority />
        ) : null}
      </div>

      {project.isExample && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {project.disclaimer}
        </p>
      )}

      {project.summary && (
        <p className="mt-6 text-lg leading-relaxed text-ink">{project.summary}</p>
      )}

      {project.body && (
        <div className="prose-property mt-4 whitespace-pre-wrap">{project.body}</div>
      )}

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <dt className="text-xs font-semibold uppercase text-ink-faint">Category</dt>
          <dd className="mt-1 font-semibold text-ink">{project.category}</dd>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <dt className="text-xs font-semibold uppercase text-ink-faint">Status</dt>
          <dd className="mt-1 font-semibold text-ink">{project.statusLabel}</dd>
        </div>
        {project.constructionStage ? (
          <div className="rounded-xl border border-brand-100 bg-white p-4">
            <dt className="text-xs font-semibold uppercase text-ink-faint">Construction stage</dt>
            <dd className="mt-1 font-semibold text-ink">{project.constructionStage}</dd>
          </div>
        ) : null}
        {project.builtUpArea ? (
          <div className="rounded-xl border border-brand-100 bg-white p-4">
            <dt className="text-xs font-semibold uppercase text-ink-faint">Built-up area</dt>
            <dd className="mt-1 font-semibold text-ink">{project.builtUpArea}</dd>
          </div>
        ) : null}
        {project.scope ? (
          <div className="rounded-xl border border-brand-100 bg-white p-4 sm:col-span-2">
            <dt className="text-xs font-semibold uppercase text-ink-faint">Scope</dt>
            <dd className="mt-1 font-semibold text-ink">{project.scope}</dd>
          </div>
        ) : null}
      </dl>

      {gallery.length > 1 && (
        <div className="mt-10">
          <h2 className="text-lg font-bold text-ink">Gallery</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {gallery.slice(1).map((src) => (
              <div key={src} className="relative aspect-[4/3] overflow-hidden rounded-xl">
                <Image src={src} alt="" fill className="object-cover" sizes="400px" />
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-primary mt-10 bg-[#25D366] hover:bg-[#1fb855]"
      >
        <WhatsAppIcon className="h-5 w-5" /> Enquire about a similar project
      </a>
    </article>
  );
}

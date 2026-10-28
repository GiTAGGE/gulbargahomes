import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArrowIcon, WhatsAppIcon } from "@/components/icons";
import {
  projectWhatsAppMessage,
  showcaseProjects,
  whatsAppHref,
} from "@/lib/services";

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return showcaseProjects.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Props) {
  const project = showcaseProjects.find((p) => p.slug === params.slug);
  if (!project) return {};
  return {
    title: project.name,
    description: project.stageNote,
  };
}

export default function ProjectDetailPage({ params }: Props) {
  const project = showcaseProjects.find((p) => p.slug === params.slug);
  if (!project) notFound();

  const wa = whatsAppHref(projectWhatsAppMessage(project.name));

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14" data-pagefind-body>
      <Link
        href={project.status === "ongoing" ? "/projects/ongoing" : "/projects/completed"}
        className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600"
      >
        <ArrowIcon className="h-4 w-4 rotate-180" /> Back to projects
      </Link>

      <p className="mt-6 text-xs font-bold uppercase tracking-wide text-brand-700">
        {project.statusLabel}
      </p>
      <h1 className="mt-2 text-3xl font-bold text-ink">{project.name}</h1>
      <p className="mt-2 text-ink-muted">
        {project.category} · {project.locality}
      </p>

      <div className="relative mt-8 aspect-[16/10] overflow-hidden rounded-2xl">
        <Image src={project.image} alt="" fill className="object-cover" sizes="800px" priority />
      </div>

      <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        {project.disclaimer}
      </p>

      <p className="mt-6 leading-relaxed text-ink-muted">{project.stageNote}</p>

      <dl className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <dt className="text-xs font-semibold uppercase text-ink-faint">Category</dt>
          <dd className="mt-1 font-semibold text-ink">{project.category}</dd>
        </div>
        <div className="rounded-xl border border-brand-100 bg-white p-4">
          <dt className="text-xs font-semibold uppercase text-ink-faint">Status</dt>
          <dd className="mt-1 font-semibold text-ink">{project.statusLabel}</dd>
        </div>
      </dl>

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

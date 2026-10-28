import Image from "next/image";
import Link from "next/link";

import {
  homeServices,
  processSteps,
  serviceWhatsAppMessage,
  showcaseProjects,
  whatsAppHref,
} from "@/lib/services";

import { ArrowIcon, WhatsAppIcon } from "./icons";

export function HomeBuildRenovateSection() {
  const wa = whatsAppHref(serviceWhatsAppMessage("a home project"));

  return (
    <section id="build-renovate" className="scroll-mt-20 border-y border-brand-100 bg-[#0f2a24] text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#b8dcc9]">
              Build & renovate
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              From empty plot to finished home
            </h2>
            <p className="mt-3 text-base leading-relaxed text-white/75">
              Explore construction, interiors and renovation services available through
              GulbargaHomes — one enquiry line for Kalaburagi homeowners and plot owners.
            </p>
          </div>
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary shrink-0 bg-[#25D366] hover:bg-[#1fb855]"
          >
            <WhatsAppIcon className="h-5 w-5" /> Discuss your project
          </a>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {homeServices.map((service) => (
            <Link
              key={service.slug}
              href={service.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] transition hover:border-[#b8dcc9]/40 hover:bg-white/[0.09]"
            >
              <div className="relative h-36 overflow-hidden bg-[#1a3d34]">
                <ServiceVisual slug={service.slug} />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f2a24] via-transparent to-transparent" />
              </div>
              <div className="flex flex-1 flex-col p-5">
                <h3 className="text-lg font-bold text-white">{service.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-white/70">
                  {service.summary}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#b8dcc9]">
                  Learn more
                  <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceVisual({ slug }: { slug: string }) {
  const labels: Record<string, string> = {
    "house-construction": "Structure · Slab · Finish",
    "modular-kitchens": "Layout · Cabinets · Counter",
    "interior-design": "Wardrobe · Living · Lighting",
    "home-renovation": "Bath · Paint · Floor",
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
        {labels[slug] ?? "Kalaburagi"}
      </p>
    </div>
  );
}

export function HomeProjectsShowcase() {
  const completed = showcaseProjects.filter((p) => p.status === "completed");
  const ongoing = showcaseProjects.filter((p) => p.status === "ongoing");

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
          Project portfolio
        </p>
        <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">
          Real work. Visible progress.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
          Finished homes, work in progress and design concepts across Kalaburagi. Example cards
          below show the direction — replace with verified project stories and dated site photos.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <ProjectColumn
          title="Completed"
          subtitle="Finished homes, interiors and renovations"
          href="/projects/completed"
          projects={completed}
        />
        <ProjectColumn
          title="Ongoing"
          subtitle="Current stage, updates and recent site photos"
          href="/projects/ongoing"
          projects={ongoing}
        />
      </div>

      <p className="mt-6 rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950 sm:text-sm">
        <strong>Note:</strong> Gallery images in this section are illustrative layout examples
        until your verified project library is uploaded. Status labels will always reflect real
        project state.
      </p>
    </section>
  );
}

function ProjectColumn({
  title,
  subtitle,
  href,
  projects,
}: {
  title: string;
  subtitle: string;
  href: string;
  projects: typeof showcaseProjects;
}) {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        </div>
        <Link href={href} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
          View all
        </Link>
      </div>
      <ul className="mt-4 space-y-4">
        {projects.map((project) => (
          <li key={project.slug}>
            <Link
              href={`/projects/${project.slug}`}
              className="card flex gap-4 overflow-hidden p-0 sm:gap-5"
            >
              <div className="relative h-28 w-32 shrink-0 sm:h-32 sm:w-40">
                <Image
                  src={project.image}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="160px"
                />
                <span className="absolute left-2 top-2 rounded-full bg-ink/75 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {project.statusLabel}
                </span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center py-3 pr-4">
                <p className="font-bold text-ink">{project.name}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {project.category} · {project.locality}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{project.stageNote}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HomeTrustSection() {
  const wa = whatsAppHref(
    "Hi GulbargaHomes, I'd like help with a property or home project in Gulbarga / Kalaburagi.",
  );

  return (
    <section className="border-t border-brand-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="text-2xl font-bold text-ink sm:text-3xl">How it works</h2>
            <p className="mt-2 text-sm text-ink-muted sm:text-base">
              A short path from enquiry to next step — for listings and build projects alike.
            </p>
            <ol className="mt-8 space-y-6">
              {processSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-bold text-ink">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-3xl border border-brand-100 bg-surface p-6 sm:p-8">
            <h3 className="text-lg font-bold text-ink">WhatsApp-first enquiries</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Every property and service page can open WhatsApp with context prefilled — share
              locality, budget and photos from site for a faster response.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink-muted">
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Real photos, scope and estimates where
                available
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Project galleries with honest status
                labels
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Local team — Gulbarga & Kalaburagi
              </li>
            </ul>
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary mt-8 w-full bg-[#25D366] hover:bg-[#1fb855] sm:w-auto"
            >
              <WhatsAppIcon className="h-5 w-5" /> Chat on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

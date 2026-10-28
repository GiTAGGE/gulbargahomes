import Image from "next/image";
import Link from "next/link";

import {
  homeServices,
  processSteps,
  serviceWhatsAppMessage,
  whatsAppHref,
} from "@/lib/services";
import { getAllProjects } from "@/lib/projects";

import { ProjectPortfolioShowcase } from "./project-portfolio";
import { ArrowIcon, WhatsAppIcon } from "./icons";

export function HomeBuildRenovateSection() {
  const wa = whatsAppHref(serviceWhatsAppMessage("a home project"));

  return (
    <section
      id="build-renovate"
      className="scroll-mt-20 border-y border-[#1a3d34] bg-[#0f2a24] text-white"
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#b8dcc9]">
              <span className="h-px w-10 bg-[#c4a574]/80" aria-hidden />
              Build & renovate
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
              From empty plot to finished home
            </h2>
            <p className="mt-3 text-base leading-relaxed text-white/75">
              Explore home construction, interiors and renovation services available through
              GulbargaHomes — one enquiry line for Kalaburagi homeowners and plot owners.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Link
              href="/projects"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white hover:bg-white/10"
            >
              View projects <ArrowIcon className="h-4 w-4" />
            </Link>
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary shrink-0 bg-[#25D366] hover:bg-[#1fb855]"
            >
              <WhatsAppIcon className="h-5 w-5" /> Discuss your project
            </a>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {homeServices.map((service) => (
            <Link
              key={service.slug}
              href={service.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] transition hover:-translate-y-0.5 hover:border-[#b8dcc9]/40 hover:bg-white/[0.09] hover:shadow-[0_24px_48px_-24px_rgba(0,0,0,0.65)]"
            >
              <div className="relative h-40 overflow-hidden bg-[#1a3d34] sm:h-44">
                <Image
                  src={service.image}
                  alt={service.imageAlt}
                  fill
                  className="object-cover transition duration-500 group-hover:scale-105"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f2a24] via-[#0f2a24]/20 to-transparent" />
                <span className="absolute bottom-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur-sm">
                  Kalaburagi
                </span>
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

export function HomeProjectsShowcase() {
  const projects = getAllProjects();

  return (
    <section className="relative overflow-hidden bg-[#f6f3ec]">
      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
              Project portfolio
            </p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl lg:text-4xl">
              Real projects. Visible progress.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted sm:text-base">
              Finished homes, work in progress and renovations across Gulbarga and Kalaburagi — with
              site photos and honest status on every story.
            </p>
          </div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Full portfolio <ArrowIcon className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-8">
          <ProjectPortfolioShowcase projects={projects} />
        </div>
      </div>
    </section>
  );
}

export function HomeTrustSection() {
  const wa = whatsAppHref(
    "Hi GulbargaHomes, I'd like help with a property or home project in Gulbarga / Kalaburagi.",
  );

  return (
    <section className="border-t border-brand-100 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
              Trust & process
            </p>
            <h2 className="mt-2 text-2xl font-bold text-ink sm:text-3xl">How it works</h2>
            <p className="mt-2 text-sm text-ink-muted sm:text-base">
              Tell us what you need → discuss scope → connect with the right team → track agreed
              next steps.
            </p>
            <ol className="mt-8 space-y-6">
              {processSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-soft">
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

          <div className="rounded-3xl border border-brand-100 bg-gradient-to-br from-surface to-white p-6 shadow-soft sm:p-8">
            <h3 className="text-lg font-bold text-ink">Real work & WhatsApp-first enquiries</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Open WhatsApp from any property or service page with details prefilled — share
              locality, budget and site photos for a faster response in Kannada, Hindi or English.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink-muted">
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Project galleries, materials and scope
                where available
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Honest status labels — planning, ongoing
                or completed
              </li>
              <li className="flex gap-2">
                <span className="text-brand-600">✓</span> Local team serving Gulbarga & Kalaburagi
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

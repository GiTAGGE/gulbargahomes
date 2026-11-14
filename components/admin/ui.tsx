import Link from "next/link";

import { TONE_CLASS, type Tone } from "@/lib/admin/format";

export function Pill({ tone = "stone", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-brand-100 bg-white shadow-soft ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-brand-50 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-bold text-ink">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "alert";
}) {
  const body = (
    <>
      <p className={`text-2xl font-bold ${tone === "alert" && value ? "text-red-700" : "text-ink"}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
    </>
  );
  const className = "block rounded-2xl border border-brand-100 bg-white px-4 py-3";
  return href ? (
    <Link href={href} className={`${className} hover:border-brand-300`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-muted">{children}</p>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children === 0 || children ? children : "—"}</dd>
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Filter">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${
            tab.key === active ? "bg-brand-700 text-white" : "bg-white text-ink ring-1 ring-brand-100 hover:bg-brand-50"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1.5 text-xs ${tab.key === active ? "text-white/80" : "text-ink-faint"}`}>{tab.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** Field styling without width or margin, for inline controls. */
export const controlClass =
  "rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm text-ink outline-none ring-brand-600 focus:ring-2 disabled:bg-surface-muted";

export const inputClass = `mt-1 w-full ${controlClass}`;

export const labelClass = "block text-xs font-semibold text-ink";

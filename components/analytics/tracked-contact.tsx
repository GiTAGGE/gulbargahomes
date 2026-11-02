"use client";

import type { ReactNode } from "react";

import { trackPhoneClick, trackWhatsAppClick } from "@/lib/analytics/track";
import type { ContactSource, PropertyAnalyticsContext } from "@/lib/analytics/types";

type TrackedLinkProps = {
  href: string;
  source: ContactSource;
  context?: PropertyAnalyticsContext;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
};

export function TrackedPhoneLink({
  href,
  source,
  context,
  className,
  children,
  ariaLabel,
  title,
}: TrackedLinkProps) {
  return (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      title={title}
      onClick={() => trackPhoneClick(source, context)}
    >
      {children}
    </a>
  );
}

export function TrackedWhatsAppLink({
  href,
  source,
  context,
  className,
  children,
  ariaLabel,
  title,
}: TrackedLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
      title={title}
      onClick={() => trackWhatsAppClick(source, context)}
    >
      {children}
    </a>
  );
}

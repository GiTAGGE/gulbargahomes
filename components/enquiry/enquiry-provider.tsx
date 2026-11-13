"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { EnquiryWizard } from "@/components/enquiry/enquiry-wizard";
import type { EnquiryLaunch } from "@/lib/enquiry/wizard";

const EnquiryContext = createContext<((launch: EnquiryLaunch) => void) | null>(null);

export function useEnquiry() {
  const open = useContext(EnquiryContext);
  if (!open) throw new Error("Enquiry provider is missing");
  return open;
}

export function EnquiryProvider({ children }: { children: ReactNode }) {
  const [launch, setLaunch] = useState<EnquiryLaunch | null>(null);
  const close = useCallback(() => setLaunch(null), []);
  return (
    <EnquiryContext.Provider value={setLaunch}>
      {children}
      {launch && <EnquiryWizard launch={launch} onClose={close} />}
    </EnquiryContext.Provider>
  );
}

export function EnquiryLaunchButton({
  launch,
  className,
  children,
  ariaLabel,
}: {
  launch: EnquiryLaunch;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  const open = useEnquiry();
  return (
    <button type="button" className={className} aria-label={ariaLabel} onClick={() => open(launch)}>
      {children}
    </button>
  );
}

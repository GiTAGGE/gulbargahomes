import { ServicePageLayout, getService, serviceMetadata } from "@/components/service-page-layout";

const service = getService("modular-kitchens")!;

export const metadata = serviceMetadata(service);

export default function ModularKitchensPage() {
  return <ServicePageLayout service={service} />;
}

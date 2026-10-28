import { ServicePageLayout, getService, serviceMetadata } from "@/components/service-page-layout";

const service = getService("house-construction")!;

export const metadata = serviceMetadata(service);

export default function HouseConstructionPage() {
  return <ServicePageLayout service={service} />;
}

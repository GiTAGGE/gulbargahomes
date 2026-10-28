import { ServicePageLayout, getService, serviceMetadata } from "@/components/service-page-layout";

const service = getService("interior-design")!;

export const metadata = serviceMetadata(service);

export default function InteriorDesignPage() {
  return <ServicePageLayout service={service} />;
}

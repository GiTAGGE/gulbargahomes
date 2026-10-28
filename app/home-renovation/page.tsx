import { ServicePageLayout, getService, serviceMetadata } from "@/components/service-page-layout";

const service = getService("home-renovation")!;

export const metadata = serviceMetadata(service);

export default function HomeRenovationPage() {
  return <ServicePageLayout service={service} />;
}

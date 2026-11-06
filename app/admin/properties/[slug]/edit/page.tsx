import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { PropertyEditor } from "@/components/admin/property-editor";
import { getLocalities, getProperty } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const property = await getProperty(slug);
  if (!property) notFound();

  const localities = Array.from(
    new Set([property.locality, ...(await getLocalities()), ...site.localities]),
  ).sort();

  return (
    <AdminShell eyebrow="Edit listing" title={property.title}>
      <PropertyEditor initial={property} mode="edit" localities={localities} />
    </AdminShell>
  );
}

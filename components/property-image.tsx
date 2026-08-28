import Image from "next/image";

import { bhkLabel } from "@/lib/format";
import { getBlurDataURL } from "@/lib/images";
import type { Property } from "@/lib/types";

export function PropertyImage({
  property,
  src,
  className = "",
  label = true,
  priority = false,
}: {
  property: Property;
  src?: string;
  className?: string;
  label?: boolean;
  priority?: boolean;
}) {
  const imageSrc = src ?? property.coverImage;

  return (
    <div className={`relative overflow-hidden bg-brand-100 ${className}`}>
      <Image
        src={imageSrc}
        alt={property.title}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover"
        placeholder="blur"
        blurDataURL={getBlurDataURL(property.slug)}
        priority={priority}
      />
      <div className="absolute inset-0 [background-image:linear-gradient(transparent_55%,rgba(44,40,37,0.35))]" />
      {label && (
        <div className="absolute bottom-3 left-3 text-white">
          <p className="text-xs font-medium uppercase tracking-wide opacity-90">
            {property.locality}
          </p>
          <p className="text-lg font-bold leading-tight">{bhkLabel(property)}</p>
        </div>
      )}
    </div>
  );
}

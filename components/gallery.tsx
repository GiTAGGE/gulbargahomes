"use client";

import { useMemo, useState } from "react";

import type { Property } from "@/lib/types";
import { propertyHasVideo } from "@/lib/types";

import { PropertyImage } from "./property-image";

function youtubeId(url: string): string | null {
  const match = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/,
  );
  return match?.[1] ?? null;
}

type GalleryItem =
  | { kind: "image"; src: string; label: string }
  | { kind: "video"; src?: string; youtubeUrl?: string; thumbnail: string; label: string };

function itemsFromProperty(property: Property): GalleryItem[] {
  const photos = (property.gallery.length ? property.gallery : [property.coverImage]).map(
    (src, index) =>
      ({
        kind: "image" as const,
        src,
        label: `Photo ${index + 1}`,
      }) satisfies GalleryItem,
  );

  const videos = property.videos
    .filter((video) => video.src || video.youtubeUrl)
    .map(
      (video, index) =>
        ({
          kind: "video" as const,
          src: video.src || undefined,
          youtubeUrl: video.youtubeUrl || undefined,
          thumbnail: video.thumbnail || property.coverImage,
          label: video.title || `Video ${index + 1}`,
        }) satisfies GalleryItem,
    );

  return [...videos, ...photos];
}

function VideoPlayer({
  item,
  title,
}: {
  item: Extract<GalleryItem, { kind: "video" }>;
  title: string;
}) {
  const id = item.youtubeUrl ? youtubeId(item.youtubeUrl) : null;

  if (id) {
    return (
      <iframe
        title={title}
        className="h-full w-full rounded-2xl sm:rounded-3xl"
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  if (item.src) {
    return (
      <video
        className="h-full w-full rounded-2xl object-cover sm:rounded-3xl"
        controls
        playsInline
        preload="metadata"
        poster={item.thumbnail}
      >
        <source src={item.src} type="video/mp4" />
      </video>
    );
  }

  return null;
}

export function Gallery({ property }: { property: Property }) {
  const items = useMemo(() => itemsFromProperty(property), [property]);
  const [active, setActive] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const current = items[active] ?? items[0];
  const hasVideo = propertyHasVideo(property);

  if (!current) return null;

  return (
    <div className="min-w-0">
      <div className="relative">
        {current.kind === "image" ? (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="block w-full"
            aria-label="Open fullscreen gallery"
          >
            <PropertyImage
              property={property}
              src={current.src}
              label={false}
              priority
              className="h-56 w-full rounded-2xl sm:h-[400px] sm:rounded-3xl"
            />
          </button>
        ) : (
          <div className="h-56 w-full overflow-hidden rounded-2xl bg-ink sm:h-[400px] sm:rounded-3xl">
            <VideoPlayer item={current} title={`${property.title} — ${current.label}`} />
          </div>
        )}
        {hasVideo && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-ink/80 px-3 py-1 text-[11px] font-semibold text-white">
            Photos + video
          </span>
        )}
      </div>

      <div className="mt-3 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:gap-3">
        {items.map((item, index) => (
          <button
            key={`${item.kind}-${item.label}-${index}`}
            type="button"
            onClick={() => setActive(index)}
            aria-label={`View ${item.label}`}
            className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-xl ring-2 transition sm:h-16 sm:w-24 ${
              active === index ? "ring-brand-600" : "ring-transparent opacity-70"
            }`}
          >
            <PropertyImage
              property={property}
              src={item.kind === "image" ? item.src : item.thumbnail}
              label={false}
              className="h-full w-full"
            />
            {item.kind === "video" && (
              <span className="absolute inset-0 grid place-items-center bg-ink/35 text-[10px] font-bold uppercase tracking-wide text-white">
                Video
              </span>
            )}
          </button>
        ))}
      </div>

      {fullscreen && current.kind === "image" && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/90 p-4"
          onClick={() => setFullscreen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl" onClick={(event) => event.stopPropagation()}>
            <PropertyImage
              property={property}
              src={current.src}
              label={false}
              className="h-[60vh] w-full rounded-2xl"
            />
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="absolute right-5 top-5 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

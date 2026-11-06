"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { formatPrice } from "@/lib/format";
import { slugifyTitle } from "@/lib/property-input";
import type {
  Facing,
  Furnishing,
  Listing,
  Property,
  PropertyStatus,
  PropertyType,
  PropertyVideo,
} from "@/lib/types";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-sm text-ink outline-none ring-brand-600 focus:ring-2";

const LISTINGS: Listing[] = ["Rent", "Sale"];
const STATUSES: PropertyStatus[] = ["Available", "Rented", "Sold"];
const TYPES: PropertyType[] = ["House", "Flat", "Villa", "Plot", "Commercial", "PG"];
const FACINGS: Facing[] = ["East", "West", "North", "South"];
const FURNISHING: Furnishing[] = ["Fully Furnished", "Semi Furnished", "Unfurnished"];

export function PropertyEditor({
  initial,
  mode,
  localities,
}: {
  initial: Property;
  mode: "create" | "edit";
  localities: string[];
}) {
  const router = useRouter();
  const [property, setProperty] = useState(initial);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [mapTouched, setMapTouched] = useState(mode === "edit" && Boolean(initial.mapQuery));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const priceLabel = useMemo(() => formatPrice(property), [property]);

  function update(patch: Partial<Property>) {
    setProperty((current) => {
      const next = { ...current, ...patch };
      if (!slugTouched && patch.title !== undefined) {
        next.slug = slugifyTitle(patch.title);
      }
      if (patch.listing === "Rent" && !current.priceSuffix) next.priceSuffix = "/month";
      if (patch.listing === "Sale" && current.priceSuffix === "/month") next.priceSuffix = "";
      if (!mapTouched && patch.locality !== undefined) {
        next.mapQuery = patch.locality ? `${patch.locality}, Kalaburagi, Karnataka` : "";
      }
      return next;
    });
  }

  async function uploadFiles(files: FileList | File[], kind: "image" | "video") {
    const list = Array.from(files);
    if (!list.length) return;
    setError("");
    setUploading(kind === "image" ? "Uploading photos…" : "Uploading video…");
    try {
      for (const file of list) {
        const body = new FormData();
        body.set("file", file);
        const response = await fetch("/api/admin/upload", { method: "POST", body });
        const data = (await response.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
          kind?: string;
        };
        if (!response.ok || !data.url) {
          throw new Error(data.error || "Upload failed.");
        }
        if (kind === "video" || data.kind === "video") {
          setProperty((current) => ({
            ...current,
            videos: [
              ...current.videos,
              {
                title: file.name.replace(/\.[^.]+$/, "") || "Property video",
                src: data.url!,
                youtubeUrl: "",
                thumbnail: current.coverImage,
              },
            ],
          }));
        } else {
          setProperty((current) => ({
            ...current,
            coverImage: current.coverImage || data.url!,
            gallery: [...current.gallery, data.url!],
          }));
        }
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading("");
    }
  }

  async function save() {
    setPending(true);
    setError("");
    setNotice("");
    const endpoint =
      mode === "create"
        ? "/api/admin/properties"
        : `/api/admin/properties/${encodeURIComponent(initial.slug)}`;
    const response = await fetch(endpoint, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ property }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      property?: Property;
    };
    setPending(false);
    if (!response.ok || !data.property) {
      setError(data.error || "Could not save this listing.");
      return;
    }
    setNotice("Saved. The public site will show this version on the next visit.");
    if (mode === "create" || data.property.slug !== initial.slug) {
      router.push(`/admin/properties/${data.property.slug}/edit`);
      router.refresh();
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/properties/${encodeURIComponent(initial.slug)}`, {
      method: "DELETE",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setPending(false);
      setError(data.error || "Could not delete this listing.");
      return;
    }
    window.location.href = "/admin/properties";
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        {error && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900">{notice}</p>
        )}

        <Section title="Listing" hint="What visitors see first in search and on the card.">
          <label className="block text-sm font-semibold text-ink">
            Title
            <input
              value={property.title}
              onChange={(event) => update({ title: event.target.value })}
              className={fieldClass}
              placeholder="2 BHK house for rent in Biddapur Colony"
            />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              URL slug
              <input
                value={property.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  update({ slug: event.target.value });
                }}
                className={fieldClass}
                spellCheck={false}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Published
              <input
                type="datetime-local"
                value={toLocalInput(property.publishedAt)}
                onChange={(event) =>
                  update({
                    publishedAt: event.target.value
                      ? new Date(event.target.value).toISOString()
                      : property.publishedAt,
                  })
                }
                className={fieldClass}
              />
            </label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Choice
              label="Offer"
              value={property.listing}
              options={LISTINGS}
              onChange={(listing) => update({ listing })}
            />
            <Choice
              label="Availability"
              value={property.status}
              options={STATUSES}
              onChange={(status) => update({ status })}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-ink">
              Type
              <select
                value={property.propertyType}
                onChange={(event) =>
                  update({ propertyType: event.target.value as PropertyType })
                }
                className={fieldClass}
              >
                {TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-ink">
              BHK
              <input
                type="number"
                min={0}
                value={property.bhk ?? ""}
                onChange={(event) =>
                  update({ bhk: event.target.value === "" ? null : Number(event.target.value) })
                }
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Bathrooms
              <input
                type="number"
                min={0}
                value={property.bathrooms}
                onChange={(event) => update({ bathrooms: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Toggle
              label="Featured on home"
              checked={property.featured}
              onChange={(featured) => update({ featured })}
            />
            <Toggle
              label="Mark as new"
              checked={property.isNew}
              onChange={(isNew) => update({ isNew })}
            />
            <Toggle
              label="Vastu compliant"
              checked={property.vastu}
              onChange={(vastu) => update({ vastu })}
            />
          </div>
        </Section>

        <Section title="Price and size" hint="Rent is monthly. Sale prices are stored in rupees.">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-ink">
              Price (INR)
              <input
                type="number"
                min={0}
                value={property.price}
                onChange={(event) => update({ price: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Suffix
              <input
                value={property.priceSuffix}
                onChange={(event) => update({ priceSuffix: event.target.value })}
                placeholder={property.listing === "Rent" ? "/month" : ""}
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Area (sqft)
              <input
                type="number"
                min={0}
                value={property.area}
                onChange={(event) => update({ area: Number(event.target.value) })}
                className={fieldClass}
              />
            </label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className="block text-sm font-semibold text-ink">
              Furnishing
              <select
                value={property.furnished}
                onChange={(event) =>
                  update({ furnished: event.target.value as Furnishing })
                }
                className={fieldClass}
              >
                {FURNISHING.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-ink">
              Facing
              <select
                value={property.facing}
                onChange={(event) => update({ facing: event.target.value as Facing })}
                className={fieldClass}
              >
                {FACINGS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold text-ink">
              Parking
              <input
                value={property.parking}
                onChange={(event) => update({ parking: event.target.value })}
                placeholder="Bike, car, none"
                className={fieldClass}
              />
            </label>
          </div>
        </Section>

        <Section title="Who it suits">
          <div className="grid gap-4 sm:grid-cols-3">
            <Choice
              label="Vegetarian"
              value={property.vegetarian}
              options={["Yes", "Preferred", "Not Required"]}
              onChange={(vegetarian) => update({ vegetarian })}
            />
            <Choice
              label="Bachelors"
              value={property.bachelors}
              options={["Allowed", "Not Allowed"]}
              onChange={(bachelors) => update({ bachelors })}
            />
            <Choice
              label="Family"
              value={property.family}
              options={["Preferred", "Allowed"]}
              onChange={(family) => update({ family })}
            />
          </div>
        </Section>

        <Section title="Location" hint="Use the Gulbarga name visitors search for. Kalaburagi is added on the public page.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              Locality
              <input
                value={property.locality}
                list="locality-options"
                onChange={(event) => update({ locality: event.target.value })}
                className={fieldClass}
                placeholder="Biddapur Colony"
              />
              <datalist id="locality-options">
                {localities.map((locality) => (
                  <option key={locality} value={locality} />
                ))}
              </datalist>
            </label>
            <label className="block text-sm font-semibold text-ink">
              City label
              <input
                value={property.city}
                onChange={(event) => update({ city: event.target.value })}
                className={fieldClass}
              />
            </label>
          </div>
          <label className="mt-4 block text-sm font-semibold text-ink">
            Map search
            <input
              value={property.mapQuery}
              onChange={(event) => {
                setMapTouched(true);
                update({ mapQuery: event.target.value });
              }}
              className={fieldClass}
              placeholder="Biddapur Colony, Kalaburagi, Karnataka"
            />
          </label>
        </Section>

        <Section
          title="Photos"
          hint="Existing site photos stay where they are. New uploads are stored for this listing."
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn-ghost cursor-pointer">
              Add photos
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                multiple
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files, "image");
                  event.target.value = "";
                }}
              />
            </label>
            {uploading && <span className="text-sm text-ink-muted">{uploading}</span>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {property.gallery.map((src, index) => (
              <figure key={`${src}-${index}`} className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-28 w-full object-cover" />
                <figcaption className="flex flex-wrap gap-1 p-2">
                  <Mini
                    onClick={() => update({ coverImage: src })}
                    active={property.coverImage === src}
                  >
                    {property.coverImage === src ? "Cover" : "Set cover"}
                  </Mini>
                  <Mini
                    onClick={() => moveGallery(index, -1)}
                    disabled={index === 0}
                  >
                    Up
                  </Mini>
                  <Mini
                    onClick={() => moveGallery(index, 1)}
                    disabled={index === property.gallery.length - 1}
                  >
                    Down
                  </Mini>
                  <Mini onClick={() => removeGallery(index)} tone="danger">
                    Remove
                  </Mini>
                </figcaption>
              </figure>
            ))}
          </div>
          {!property.gallery.length && (
            <p className="mt-3 text-sm text-ink-muted">No photos yet. Add at least a cover before publishing.</p>
          )}
        </Section>

        <Section title="Videos" hint="Upload an MP4 or MOV, or paste a YouTube link. Both can sit on the same listing.">
          <label className="btn-ghost cursor-pointer">
            Upload video
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="sr-only"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files, "video");
                event.target.value = "";
              }}
            />
          </label>
          <div className="mt-4 space-y-3">
            {property.videos.map((video, index) => (
              <div key={`${video.src}-${video.youtubeUrl}-${index}`} className="rounded-2xl border border-brand-100 bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-ink">
                    Title
                    <input
                      value={video.title}
                      onChange={(event) => patchVideo(index, { title: event.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className="text-sm font-semibold text-ink">
                    YouTube URL
                    <input
                      value={video.youtubeUrl}
                      onChange={(event) => patchVideo(index, { youtubeUrl: event.target.value })}
                      placeholder="https://www.youtube.com/watch?v="
                      className={fieldClass}
                    />
                  </label>
                  <label className="text-sm font-semibold text-ink sm:col-span-2">
                    Video file
                    <input
                      value={video.src}
                      onChange={(event) => patchVideo(index, { src: event.target.value })}
                      placeholder="/videos/properties/tour.mp4"
                      className={fieldClass}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-red-700"
                  onClick={() =>
                    update({ videos: property.videos.filter((_, item) => item !== index) })
                  }
                >
                  Remove video
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm font-semibold text-brand-700"
              onClick={() =>
                update({
                  videos: [
                    ...property.videos,
                    { title: "Property video", src: "", youtubeUrl: "", thumbnail: property.coverImage },
                  ],
                })
              }
            >
              Add YouTube or existing file
            </button>
          </div>
        </Section>

        <Section title="Description" hint="Plain paragraphs are enough. This is the text under the gallery.">
          <textarea
            value={property.description}
            onChange={(event) =>
              update({ description: event.target.value, body: event.target.value })
            }
            rows={8}
            className={fieldClass}
          />
        </Section>

        <Section title="Amenities and rules">
          <ChipEditor
            label="Amenities"
            items={property.amenities}
            placeholder="Separate kitchen"
            onChange={(amenities) => update({ amenities })}
          />
          <div className="mt-4">
            <ChipEditor
              label="Rules"
              items={property.rules}
              placeholder="Family preferred"
              onChange={(rules) => update({ rules })}
            />
          </div>
        </Section>

        <Section title="Nearby">
          <div className="grid gap-4 sm:grid-cols-2">
            <ChipEditor
              label="Schools"
              items={property.nearby.schools}
              placeholder="School name"
              onChange={(schools) => update({ nearby: { ...property.nearby, schools } })}
            />
            <ChipEditor
              label="Hospitals"
              items={property.nearby.hospitals}
              placeholder="Hospital name"
              onChange={(hospitals) => update({ nearby: { ...property.nearby, hospitals } })}
            />
            <label className="block text-sm font-semibold text-ink">
              Bus stop
              <input
                value={property.nearby.busStop}
                onChange={(event) =>
                  update({ nearby: { ...property.nearby, busStop: event.target.value } })
                }
                className={fieldClass}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Railway
              <input
                value={property.nearby.railway}
                onChange={(event) =>
                  update({ nearby: { ...property.nearby, railway: event.target.value } })
                }
                className={fieldClass}
              />
            </label>
          </div>
        </Section>

        <Section title="Questions visitors ask">
          <div className="space-y-3">
            {property.faq.map((entry, index) => (
              <div key={index} className="rounded-2xl border border-brand-100 bg-white p-3">
                <input
                  value={entry.question}
                  onChange={(event) => patchFaq(index, { question: event.target.value })}
                  placeholder="Question"
                  className={fieldClass}
                />
                <textarea
                  value={entry.answer}
                  onChange={(event) => patchFaq(index, { answer: event.target.value })}
                  placeholder="Answer"
                  rows={3}
                  className={fieldClass}
                />
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-red-700"
                  onClick={() => update({ faq: property.faq.filter((_, item) => item !== index) })}
                >
                  Remove question
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-sm font-semibold text-brand-700"
              onClick={() =>
                update({ faq: [...property.faq, { question: "", answer: "" }] })
              }
            >
              Add question
            </button>
          </div>
        </Section>
      </div>

      <aside className="xl:sticky xl:top-20">
        <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-soft">
          <div className="h-40 bg-brand-50">
            {property.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={property.coverImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-sm text-ink-faint">No cover yet</div>
            )}
          </div>
          <div className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              {property.listing === "Rent" ? "For rent" : "For sale"} · {property.propertyType}
            </p>
            <p className="font-bold text-ink">{property.title || "Untitled property"}</p>
            <p className="text-sm text-ink-muted">
              {property.locality || "Locality"} · {priceLabel}
            </p>
            <p className="text-sm text-ink-muted">
              {property.gallery.length} photos · {property.videos.length} videos · {property.status}
            </p>
            {mode === "edit" && property.slug && (
              <Link href={`/properties/${property.slug}`} className="inline-block text-sm font-semibold text-brand-700">
                Open public page
              </Link>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <button type="button" className="btn-primary" disabled={pending || Boolean(uploading)} onClick={() => void save()}>
            {pending ? "Saving…" : mode === "create" ? "Publish listing" : "Save changes"}
          </button>
          {mode === "edit" && (
            <button
              type="button"
              className="btn-ghost text-red-800"
              disabled={pending}
              onClick={() => void remove()}
            >
              {confirmDelete ? "Confirm delete" : "Delete listing"}
            </button>
          )}
        </div>
      </aside>
    </div>
  );

  function moveGallery(index: number, direction: -1 | 1) {
    const next = [...property.gallery];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    update({ gallery: next });
  }

  function removeGallery(index: number) {
    const removed = property.gallery[index];
    const gallery = property.gallery.filter((_, item) => item !== index);
    update({
      gallery,
      coverImage: property.coverImage === removed ? gallery[0] ?? "" : property.coverImage,
    });
  }

  function patchVideo(index: number, patch: Partial<PropertyVideo>) {
    update({
      videos: property.videos.map((video, item) => (item === index ? { ...video, ...patch } : video)),
    });
  }

  function patchFaq(index: number, patch: { question?: string; answer?: string }) {
    update({
      faq: property.faq.map((entry, item) => (item === index ? { ...entry, ...patch } : entry)),
    });
  }
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-brand-100 bg-white p-4 shadow-soft sm:p-5">
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
              option === value
                ? "bg-brand-700 text-white"
                : "bg-brand-50 text-ink hover:bg-brand-100"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
        checked ? "bg-brand-700 text-white" : "bg-surface-muted text-ink-muted"
      }`}
      aria-pressed={checked}
    >
      {label}
    </button>
  );
}

function Mini({
  children,
  onClick,
  disabled,
  active,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-2 py-1 text-[11px] font-semibold disabled:opacity-40 ${
        tone === "danger"
          ? "text-red-700"
          : active
            ? "bg-brand-700 text-white"
            : "bg-brand-50 text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ChipEditor({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  }

  return (
    <div>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <button
            key={`${item}-${index}`}
            type="button"
            onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
            className="rounded-full bg-brand-50 px-3 py-1 text-sm text-ink"
            title="Remove"
          >
            {item} ×
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={fieldClass}
        />
        <button type="button" className="btn-ghost shrink-0" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

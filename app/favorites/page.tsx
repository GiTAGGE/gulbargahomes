import type { Metadata } from "next";

import { FavoritesList } from "@/components/favorites-list";
import { metaDescription } from "@/lib/seo";
import { getAllProperties } from "@/lib/properties";

export const metadata: Metadata = {
  title: "Your Saved Favorites",
  description: metaDescription(
    "Your shortlisted GulbargaHomes properties, saved on this device.",
  ),
  robots: { index: false, follow: false },
};

export default function FavoritesPage() {
  const properties = getAllProperties();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Saved favorites</h1>
      <p className="mt-1 text-sm text-ink-muted sm:text-base">
        Your shortlist is stored on this device — no login required.
      </p>
      <div className="mt-6 sm:mt-8">
        <FavoritesList properties={properties} />
      </div>
    </div>
  );
}

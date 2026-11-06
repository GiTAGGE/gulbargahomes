import "server-only";

import { revalidatePath } from "next/cache";

/** Refresh public pages after a property is created, edited, or removed. */
export function revalidateListings() {
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/video-sitemap.xml");
}

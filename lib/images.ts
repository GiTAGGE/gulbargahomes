import blurData from "./image-blur.json";

const DEFAULT_BLUR =
  "data:image/webp;base64,UklGRjIAAABXRUJQVlA4ICYAAACyCdQeCdWfAQA=";

export function getBlurDataURL(slug: string): string {
  return blurData[slug as keyof typeof blurData] ?? DEFAULT_BLUR;
}

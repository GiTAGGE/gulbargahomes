import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const SAFE_IMAGE = /^\/images\/properties\/[^?#]+\.(?:webp|jpe?g|png|gif)$/i;

const markdownComponents: Components = {
  img: ({ src, alt }) => {
    if (!src || !SAFE_IMAGE.test(src)) return null;

    return (
      // eslint-disable-next-line @next/next/no-img-element -- CMS markdown images are static WebP/JPEG paths.
      <img src={src} alt={alt ?? ""} loading="lazy" className="rounded-xl" />
    );
  },
};

export function PropertyBody({ content }: { content: string }) {
  return (
    <div className="prose-property">
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
}

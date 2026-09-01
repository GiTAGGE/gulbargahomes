import { getLocationPages } from "@/lib/locations";
import { getAllProperties } from "@/lib/properties";
import { site } from "@/lib/site";
import { propertyHasVideo } from "@/lib/types";
import { absoluteUrl, propertyUrl, youtubeEmbedUrl } from "@/lib/url";

const VIDEO_DURATION_SECONDS = 6;

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function lastmod(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function locTag(url: string): string {
  return `    <loc>${xmlEscape(url)}</loc>`;
}

function lastmodTag(value: string): string {
  return `    <lastmod>${xmlEscape(lastmod(value))}</lastmod>`;
}

function imageTag(url: string, title: string): string {
  return [
    "    <image:image>",
    `      <image:loc>${xmlEscape(absoluteUrl(url))}</image:loc>`,
    `      <image:title>${xmlEscape(title)}</image:title>`,
    "    </image:image>",
  ].join("\n");
}

function videoTagsForProperty(property: {
  title: string;
  description: string;
  publishedAt: string;
  coverImage: string;
  videos: { title: string; src: string; youtubeUrl: string; thumbnail: string }[];
}): string {
  return property.videos
    .filter((video) => video.src || video.youtubeUrl)
    .map((video) => {
      const thumbnail = absoluteUrl(video.thumbnail || property.coverImage);
      const embed = video.youtubeUrl ? youtubeEmbedUrl(video.youtubeUrl) : undefined;
      const lines = [
        "    <video:video>",
        `      <video:thumbnail_loc>${xmlEscape(thumbnail)}</video:thumbnail_loc>`,
        `      <video:title>${xmlEscape(video.title || `${property.title} video tour`)}</video:title>`,
        `      <video:description>${xmlEscape(property.description.slice(0, 2048))}</video:description>`,
      ];
      if (video.src) {
        lines.push(
          `      <video:content_loc>${xmlEscape(absoluteUrl(video.src))}</video:content_loc>`,
        );
      }
      if (embed) {
        lines.push(`      <video:player_loc>${xmlEscape(embed)}</video:player_loc>`);
      }
      lines.push(
        `      <video:publication_date>${xmlEscape(lastmod(property.publishedAt))}</video:publication_date>`,
        `      <video:duration>${VIDEO_DURATION_SECONDS}</video:duration>`,
        "      <video:family_friendly>yes</video:family_friendly>",
        "      <video:live>no</video:live>",
        "    </video:video>",
      );
      return lines.join("\n");
    })
    .join("\n");
}

const URLSET_OPEN = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`;

export function buildUrlSitemapXml(): string {
  const now = new Date().toISOString();
  const properties = getAllProperties();
  const newestListing = properties.reduce(
    (latest, property) => (property.publishedAt > latest ? property.publishedAt : latest),
    properties[0]?.publishedAt ?? now,
  );

  const urls: string[] = [];

  urls.push(
    [
      "  <url>",
      locTag(site.url),
      lastmodTag(newestListing),
      "    <changefreq>daily</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
    ].join("\n"),
  );

  const staticPages = [
    { path: "/properties", changefreq: "weekly", priority: "0.8" },
    { path: "/about", changefreq: "monthly", priority: "0.6" },
    { path: "/contact", changefreq: "monthly", priority: "0.6" },
  ];

  for (const page of staticPages) {
    urls.push(
      [
        "  <url>",
        locTag(`${site.url}${page.path}`),
        lastmodTag(newestListing),
        `    <changefreq>${page.changefreq}</changefreq>`,
        `    <priority>${page.priority}</priority>`,
        "  </url>",
      ].join("\n"),
    );
  }

  for (const property of properties) {
    const images = [property.coverImage, ...property.gallery].filter(Boolean);
    const uniqueImages = Array.from(new Set(images));
    const blocks = [
      "  <url>",
      locTag(propertyUrl(property.slug)),
      lastmodTag(property.publishedAt),
      "    <changefreq>weekly</changefreq>",
      "    <priority>0.9</priority>",
      ...uniqueImages.map((src) => imageTag(src, property.title)),
    ];
    if (propertyHasVideo(property)) {
      blocks.push(videoTagsForProperty(property));
    }
    blocks.push("  </url>");
    urls.push(blocks.join("\n"));
  }

  for (const page of getLocationPages()) {
    urls.push(
      [
        "  <url>",
        locTag(`${site.url}/${page.slug}`),
        lastmodTag(newestListing),
        "    <changefreq>weekly</changefreq>",
        "    <priority>0.75</priority>",
        "  </url>",
      ].join("\n"),
    );
  }

  return `${URLSET_OPEN}\n${urls.join("\n")}\n</urlset>\n`;
}

export function buildVideoSitemapXml(): string {
  const properties = getAllProperties().filter(propertyHasVideo);

  const urls = properties.map((property) =>
    [
      "  <url>",
      locTag(propertyUrl(property.slug)),
      lastmodTag(property.publishedAt),
      videoTagsForProperty(property),
      "  </url>",
    ].join("\n"),
  );

  return `${URLSET_OPEN}\n${urls.join("\n")}\n</urlset>\n`;
}

export function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

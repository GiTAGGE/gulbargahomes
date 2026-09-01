import { ImageResponse } from "next/og";

import { site } from "@/lib/site";

export const runtime = "edge";
export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0f2a24 0%, #1a5142 48%, #2f7d62 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, opacity: 0.85 }}>
          {site.domain}
        </div>
        <div style={{ fontSize: 88, fontWeight: 800, marginTop: 16, lineHeight: 1.05 }}>
          {site.tagline}
        </div>
        <div style={{ fontSize: 36, marginTop: 24, opacity: 0.9 }}>
          Rent · Buy · Houses · Flats · Plots — Gulbarga & Kalaburagi
        </div>
      </div>
    ),
    { ...size },
  );
}

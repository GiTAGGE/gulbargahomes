import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getMediaBucket } from "@/lib/properties";

const MAX_BYTES = 80 * 1024 * 1024;

const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/avif", "avif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

function safeBase(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").toLowerCase();
  const cleaned = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || "file").slice(0, 60);
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a photo or video to upload." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Use a JPG, PNG, WebP, GIF, AVIF, MP4, MOV, or WebM file." },
      { status: 400 },
    );
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Files must be under 80 MB." }, { status: 400 });
  }

  const extension = ALLOWED.get(file.type) ?? "bin";
  const key = `uploads/${new Date().getUTCFullYear()}/${crypto.randomUUID()}-${safeBase(file.name)}.${extension}`;
  const bucket = await getMediaBucket();

  if (bucket) {
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    return NextResponse.json({
      url: `/media/${key}`,
      kind: file.type.startsWith("video/") ? "video" : "image",
    });
  }

  if (process.env.NODE_ENV === "development") {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const relative = key;
    const destination = path.join(process.cwd(), "public", relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({
      url: `/${relative}`,
      kind: file.type.startsWith("video/") ? "video" : "image",
    });
  }

  return NextResponse.json(
    {
      error:
        "Media storage is not available. Create the R2 bucket gulbargahomes-media and bind it as MEDIA.",
    },
    { status: 503 },
  );
}

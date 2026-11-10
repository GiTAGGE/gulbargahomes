import { getMediaBucket } from "@/lib/properties";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string[] }> };

export async function GET(request: Request, context: Context) {
  const { key } = await context.params;
  const objectKey = key.join("/");
  if (!objectKey || objectKey.includes("..") || objectKey.startsWith("private/")) {
    return new Response("Not found", { status: 404 });
  }

  const bucket = await getMediaBucket();
  if (!bucket) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  const object = await bucket.get(
    objectKey,
    range ? { range: request.headers } : undefined,
  );
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");

  if (range && object.range && typeof object.range.offset === "number" && object.range.length) {
    const start = object.range.offset;
    const end = start + object.range.length - 1;
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(object.range.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

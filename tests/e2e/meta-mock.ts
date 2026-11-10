/**
 * Local stand-in for graph.facebook.com and the OAuth dialog, for `next dev`
 * with META_GRAPH_BASE_URL / META_DIALOG_BASE_URL pointing here.
 *   npx tsx tests/e2e/meta-mock.ts   (listens on 127.0.0.1:4545)
 * Test hooks: POST /__lead {form, answers} adds a lead; POST /__mode {mode}.
 */
import { createServer } from "node:http";

import { attribution, BUYER_FORM, FakeMeta, leadId, OWNER_FORM, TENANT_FORM } from "../helpers/fake-meta";

const meta = new FakeMeta();
meta.forms = [OWNER_FORM, TENANT_FORM, BUYER_FORM];
const port = Number(process.env.PORT ?? 4545);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const body = url.pathname.startsWith("/__") && raw ? JSON.parse(raw) : {};

  if (url.pathname.endsWith("/dialog/oauth")) {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", "fake-code");
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }
  if (url.pathname === "/__lead") {
    const form = [OWNER_FORM, TENANT_FORM, BUYER_FORM].find((item) => item.id === body.form) ?? OWNER_FORM;
    const lead = {
      id: leadId(),
      form_id: form.id,
      created_time: body.created_time ?? new Date().toISOString().replace("Z", "+0000"),
      ...attribution(body.campaign ?? "1"),
      field_data: Object.entries(body.answers ?? {}).map(([name, value]) => ({ name, values: [String(value)] })),
    };
    meta.leads.push(lead);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(lead));
    return;
  }
  if (url.pathname === "/__mode") {
    meta.mode = body.mode ?? "ok";
    res.writeHead(200).end("ok");
    return;
  }
  if (url.pathname === "/__calls") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(meta.calls));
    return;
  }
  const response = await meta.fetch(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    ...(raw ? { body: raw } : {}),
  });
  res.writeHead(response.status, { "content-type": "application/json" }).end(await response.text());
}).listen(port, "127.0.0.1", () => console.log(`meta mock on http://127.0.0.1:${port}`));

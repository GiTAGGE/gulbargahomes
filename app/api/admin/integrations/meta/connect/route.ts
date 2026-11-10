import { NextResponse } from "next/server";

import { authorize } from "@/lib/admin/route";
import { META_SCOPES, OAUTH_STATE_COOKIE, readMetaConfig } from "@/lib/meta/config";
import { randomToken } from "@/lib/meta/crypto";
import { createGraphClient } from "@/lib/meta/graph";

export const dynamic = "force-dynamic";

/** Starts Facebook Login for Business. Super admins only. */
export async function GET(request: Request) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  const origin = new URL(request.url).origin;
  const { config, missing } = readMetaConfig(process.env, origin);
  if (missing.length) {
    return NextResponse.redirect(new URL(`/admin/integrations/meta?error=${encodeURIComponent(`Set ${missing.join(", ")} on the Worker first.`)}`, origin));
  }
  const state = randomToken();
  const response = NextResponse.redirect(createGraphClient(config).oauthDialogUrl(state, META_SCOPES));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/admin/integrations/meta",
    maxAge: 600,
  });
  return response;
}

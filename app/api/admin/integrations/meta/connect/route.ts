import { NextResponse } from "next/server";

import { authorize } from "@/lib/admin/route";
import { OAUTH_STATE_COOKIE, readMetaConfig, requestedScopes } from "@/lib/meta/config";
import { randomToken } from "@/lib/meta/crypto";
import { createGraphClient } from "@/lib/meta/graph";

export const dynamic = "force-dynamic";

/** Starts Facebook Login for Business. Super admins only. `?optional=ads_read` adds optional scopes. */
export async function GET(request: Request) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const origin = url.origin;
  const { config, missing } = readMetaConfig(process.env, origin);
  if (missing.length) {
    return NextResponse.redirect(new URL(`/admin/integrations/meta?error=${encodeURIComponent(`Set ${missing.join(", ")} on the Worker first.`)}`, origin));
  }
  const optional = url.searchParams.getAll("optional").flatMap((value) => value.split(","));
  const state = randomToken();
  const response = NextResponse.redirect(createGraphClient(config).oauthDialogUrl(state, requestedScopes(optional)));
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/admin/integrations/meta",
    maxAge: 600,
  });
  return response;
}

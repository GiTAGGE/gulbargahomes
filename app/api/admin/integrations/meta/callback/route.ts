import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { authorize } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { OAUTH_STATE_COOKIE, readMetaConfig } from "@/lib/meta/config";
import { getConnection, storeUserToken } from "@/lib/meta/connection";
import { constantTimeEqual } from "@/lib/meta/crypto";
import { createGraphClient, MetaApiError } from "@/lib/meta/graph";
import { selectPage } from "@/lib/meta/setup";

export const dynamic = "force-dynamic";

/** Facebook redirects here after the super admin approves the app. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/admin/integrations/meta?${query}`, url.origin));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/admin/integrations/meta", maxAge: 0 });
    return response;
  };
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;

  const cookieStore = await cookies();
  const expected = cookieStore.get(OAUTH_STATE_COOKIE)?.value ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!expected || !constantTimeEqual(state, expected)) {
    return back(`error=${encodeURIComponent("The Facebook sign-in expired or did not start here. Try Connect again.")}`);
  }
  if (url.searchParams.get("error")) {
    return back(`error=${encodeURIComponent(url.searchParams.get("error_description") || "Facebook sign-in was cancelled.")}`);
  }
  const code = url.searchParams.get("code");
  if (!code) return back(`error=${encodeURIComponent("Facebook did not return an authorisation code.")}`);

  const { config, missing } = readMetaConfig(process.env, url.origin);
  if (missing.length) return back(`error=${encodeURIComponent(`Set ${missing.join(", ")} on the Worker first.`)}`);
  const graph = createGraphClient(config);
  const now = nowIso();
  try {
    const { accessToken, expiresAt } = await graph.exchangeCode(code);
    const [me, info] = await Promise.all([graph.me(accessToken), graph.debugToken(accessToken)]);
    await storeUserToken(auth.db, auth.admin, {
      tokenKey: config.tokenKey,
      token: accessToken,
      expiresAt: info.expiresAt ?? expiresAt,
      userName: me.name,
      scopes: info.scopes,
      now,
    });
    // Reconnecting the same Page refreshes its token without asking again.
    const previous = await getConnection(auth.db);
    if (previous.pageId) {
      const pages = await graph.listPages(accessToken);
      if (pages.some((page) => page.id === previous.pageId)) {
        await selectPage(auth.db, auth.admin, config, graph, previous.pageId, now);
        return back("connected=1");
      }
    }
    return back("step=page");
  } catch (error) {
    const message = error instanceof MetaApiError || error instanceof Error ? error.message : "Facebook sign-in failed.";
    return back(`error=${encodeURIComponent(message.slice(0, 200))}`);
  }
}

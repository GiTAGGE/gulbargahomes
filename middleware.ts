import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, verifyAdminSessionToken } from "@/lib/admin-session";
import { ATTRIBUTION_COOKIE, ATTRIBUTION_MAX_AGE_SECONDS, nextAttributionCookie } from "@/lib/enquiry/cookie";

async function adminGate(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const signedIn = await verifyAdminSessionToken(token);

  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    if (!signedIn) return NextResponse.next();
    return NextResponse.redirect(new URL("/admin/properties", request.url));
  }

  if (!signedIn) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (pathname === "/admin" || pathname === "/admin/") {
    return NextResponse.redirect(new URL("/admin/properties", request.url));
  }

  return NextResponse.next();
}

async function rememberAttribution(request: NextRequest) {
  if (request.method !== "GET" || request.nextUrl.pathname.startsWith("/api")) return NextResponse.next();
  const secret = process.env.ENQUIRY_ATTRIBUTION_SECRET ?? "";
  if (!secret) return NextResponse.next();
  const now = new Date().toISOString();
  const sealed = await nextAttributionCookie(
    request.cookies.get(ATTRIBUTION_COOKIE)?.value ?? null,
    request.nextUrl,
    request.headers.get("referer"),
    secret,
    now,
  );
  if (!sealed) return NextResponse.next();
  const response = NextResponse.next();
  response.cookies.set({
    name: ATTRIBUTION_COOKIE,
    value: sealed,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ATTRIBUTION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/admin")) return adminGate(request);
  return rememberAttribution(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|robots.txt|sitemap.xml|pagefind/|images/|videos/|media/).*)"],
};

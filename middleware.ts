import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_COOKIE, verifyAdminSessionToken } from "@/lib/admin-session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/admin")) return NextResponse.next();

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

export const config = {
  matcher: ["/admin/:path*"],
};

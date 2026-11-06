import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE, verifyAdminSessionToken } from "./admin-session";

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminSessionToken(cookieStore.get(ADMIN_COOKIE)?.value);
}

import "server-only";

import { getCurrentAdmin } from "./admin/identity";

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getCurrentAdmin()) !== null;
}

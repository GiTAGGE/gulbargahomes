import { AdminShell } from "@/components/admin/admin-shell";
import { TeamManager } from "@/components/admin/team-manager";
import { requirePageAdmin } from "@/lib/admin/page";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/admin/permissions";
import { listAdminUsers } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { admin, db } = await requirePageAdmin("users.manage");
  const users = await listAdminUsers(db);

  return (
    <AdminShell eyebrow="Access" title="Team">
      {admin.legacy && (
        <p className="mb-4 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You are signed in with the shared password. Create a named super admin account for yourself, then set{" "}
          <code className="font-mono">ADMIN_LEGACY_LOGIN=disabled</code> on the Worker once everyone has their own login.
        </p>
      )}
      <TeamManager users={users} currentId={admin.id} />
      <div className="mt-6 grid gap-2 text-xs text-ink-muted sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((role) => (
          <p key={role}>
            <span className="font-semibold text-ink">{ROLE_LABEL[role]}.</span> {ROLE_DESCRIPTION[role]}
          </p>
        ))}
      </div>
    </AdminShell>
  );
}

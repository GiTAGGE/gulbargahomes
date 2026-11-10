"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { formatDateTime } from "@/lib/admin/format";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES, type Role } from "@/lib/admin/permissions";
import type { AdminUser } from "@/lib/admin/users";

import { Pill, inputClass, labelClass } from "./ui";

async function call(url: string, method: string, body: unknown): Promise<string | null> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return null;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return data.error || "That did not save.";
}

export function TeamManager({ users, currentId }: { users: AdminUser[]; currentId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ name: "", email: "", role: "lead_executive" as Role, password: "" });
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState<{ id: string; password: string } | null>(null);

  async function run(key: string, url: string, method: string, body: unknown) {
    setPending(key);
    setError("");
    const problem = await call(url, method, body);
    setPending("");
    if (problem) {
      setError(problem);
      return false;
    }
    router.refresh();
    return true;
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (await run("create", "/api/admin/users", "POST", draft)) {
      setDraft({ name: "", email: "", role: "lead_executive", password: "" });
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
        <ul className="divide-y divide-brand-50">
          {users.length === 0 && (
            <li className="px-4 py-6 text-sm text-ink-muted">
              No named accounts yet. Everyone is using the shared password. Add each person so their changes are recorded
              under their own name.
            </li>
          )}
          {users.map((user) => (
            <li key={user.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{user.name}</span>
                <span className="text-sm text-ink-muted">{user.email}</span>
                {!user.active && <Pill tone="red">Deactivated</Pill>}
                {user.id === currentId && <Pill tone="blue">You</Pill>}
              </div>
              <p className="text-xs text-ink-faint">Last sign-in {formatDateTime(user.lastLoginAt)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={user.role}
                  aria-label={`Role for ${user.name}`}
                  disabled={Boolean(pending)}
                  onChange={(event) => void run(user.id, `/api/admin/users/${user.id}`, "PATCH", { role: event.target.value })}
                  className={`${inputClass} mt-0 w-auto`}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABEL[role]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={Boolean(pending) || user.id === currentId}
                  onClick={() => void run(user.id, `/api/admin/users/${user.id}`, "PATCH", { active: !user.active })}
                >
                  {user.active ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setResetting(resetting?.id === user.id ? null : { id: user.id, password: "" })}
                >
                  Reset password
                </button>
              </div>
              {resetting?.id === user.id && (
                <div className="flex gap-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={resetting.password}
                    onChange={(event) => setResetting({ id: user.id, password: event.target.value })}
                    placeholder="New password (10+ characters)"
                    className={`${inputClass} mt-0`}
                  />
                  <button
                    type="button"
                    className="btn-primary shrink-0"
                    disabled={Boolean(pending) || resetting.password.length < 10}
                    onClick={async () => {
                      if (await run(user.id, `/api/admin/users/${user.id}`, "PATCH", { password: resetting.password })) {
                        setResetting(null);
                      }
                    }}
                  >
                    Set
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={create} className="space-y-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-soft">
        <h2 className="text-sm font-bold text-ink">Add a team member</h2>
        <label className={labelClass}>
          Name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required className={inputClass} />
        </label>
        <label className={labelClass}>
          Work email
          <input
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            required
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Role
          <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })} className={inputClass}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-ink-muted">{ROLE_DESCRIPTION[draft.role]}</span>
        </label>
        <label className={labelClass}>
          Starting password
          <input
            type="password"
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            minLength={10}
            required
            className={inputClass}
          />
          <span className="mt-1 block font-normal text-ink-muted">At least 10 characters. Share it privately.</span>
        </label>
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={Boolean(pending)}>
          {pending === "create" ? "Adding…" : "Add team member"}
        </button>
      </form>
    </div>
  );
}

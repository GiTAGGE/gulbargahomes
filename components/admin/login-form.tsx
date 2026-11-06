"use client";

import { useState, type FormEvent } from "react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Could not sign in.");
      setPending(false);
      return;
    }
    window.location.href = nextPath;
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block text-sm font-semibold text-ink">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1.5 w-full rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-sm outline-none ring-brand-600 focus:ring-2"
        />
      </label>
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Enter listing desk"}
      </button>
    </form>
  );
}

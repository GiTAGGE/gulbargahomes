"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const API = "/api/admin/integrations/meta";

export function FormRetry({
  formId,
  rows,
}: {
  formId: string;
  rows: { id: string; leadgenId: string; name: string; phone: string; error: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (rows.length === 0) return null;

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function retry() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const response = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry", ids: selected, formId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(body?.error || "Those leads were not retried.");
      return;
    }
    setSelected([]);
    router.refresh();
  }

  return (
    <div className="mt-4 border-t border-brand-50 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Needs attention — retryable</p>
      <ul className="mt-2 divide-y divide-brand-50">
        {rows.map((row) => (
          <li key={row.id} className="flex gap-3 py-2">
            <input
              type="checkbox"
              aria-label={`Select lead ${row.leadgenId}`}
              checked={selected.includes(row.id)}
              onChange={() => toggle(row.id)}
              className="mt-1"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {row.name || "Unknown name"}
                {row.phone ? <span className="ml-2 font-normal text-ink-muted">{row.phone}</span> : null}
              </p>
              <p className="text-xs text-ink-muted">{row.error}</p>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-ghost mt-2" disabled={busy || selected.length === 0} onClick={() => void retry()}>
        {busy ? "Retrying…" : `Retry ${selected.length} selected`}
      </button>
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

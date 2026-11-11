"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Super-admin action. Reads names for ids already stored. It does not re-import leads or spend. */
export function SyncNamesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function sync() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/integrations/meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "sync_names" }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string; incomplete?: boolean };
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: data.error || "Campaign names were not synced." });
      return;
    }
    setMessage({ tone: data.incomplete ? "warn" : "ok", text: data.message || "Campaign names synced." });
    router.refresh();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void sync()}>
        {busy ? "Syncing names…" : "Sync names"}
      </button>
      {message && (
        <p className={`text-sm ${message.tone === "error" ? "text-red-700" : message.tone === "warn" ? "text-amber-800" : "text-brand-800"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

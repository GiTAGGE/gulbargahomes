"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Super-admin action. Reads campaign spend for the selected ad account. It does not import leads. */
export function ImportSpendButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/integrations/meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "import_spend" }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage({ tone: "error", text: data.error || "Campaign spend was not imported." });
      return;
    }
    setMessage({ tone: "ok", text: data.message || "Campaign spend imported." });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run()}>
        {busy ? "Importing spend…" : "Import spend"}
      </button>
      {message && <p className={`text-sm ${message.tone === "error" ? "text-red-700" : "text-brand-800"}`}>{message.text}</p>}
    </div>
  );
}

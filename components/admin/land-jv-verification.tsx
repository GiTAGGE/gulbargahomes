"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { controlClass } from "./ui";

export function LandJvVerification({
  id,
  rowVersion,
  verifiedVillage,
  additionalPhone,
}: {
  id: string;
  rowVersion: number;
  verifiedVillage: string;
  additionalPhone: string;
}) {
  const router = useRouter();
  const [village, setVillage] = useState(verifiedVillage);
  const [phone, setPhone] = useState(additionalPhone);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError("");
        try {
          const response = await fetch(`/api/admin/land-jv/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ verifiedVillage: village, additionalPhone: phone, rowVersion }),
          });
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) {
            setError(body.error || "The village could not be saved.");
            return;
          }
          router.refresh();
        } catch {
          setError("The village could not be saved. Check the connection and try again.");
        } finally {
          savingRef.current = false;
          setSaving(false);
        }
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-ink-faint">Verified village</span>
        <input className={controlClass} value={village} maxLength={80} onChange={(event) => setVillage(event.target.value)} placeholder="Village name only" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-ink-faint">Additional phone, if staff verified one</span>
        <input className={controlClass} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Leave blank unless you typed a number" inputMode="tel" />
      </label>
      <p className="text-xs text-ink-muted">
        The original village answer is not scanned. A number is stored only when you type it here. Leave verified village blank to clear a name that was saved earlier.
      </p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? "Saving…" : "Save verified village"}
      </button>
    </form>
  );
}

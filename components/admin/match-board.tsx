"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { budgetDifferenceLabel, formatRupees } from "@/lib/crm/match-score";
import type { MatchDecision, StoredMatch } from "@/lib/crm/matching";

import { Pill } from "./ui";

const ACTIONS: Array<{ decision: MatchDecision; label: string; reason?: boolean }> = [
  { decision: "Shortlisted", label: "Shortlist" },
  { decision: "Rejected", label: "Reject", reason: true },
  { decision: "Shared", label: "Mark shared" },
  { decision: "Visit scheduled", label: "Schedule visit" },
  { decision: "Visited", label: "Mark visited" },
  { decision: "Negotiation", label: "Record negotiation" },
  { decision: "Converted", label: "Mark converted" },
];

const BLOCKED_CONVERSION = new Set(["Lost", "Duplicate", "Invalid", "Postponed"]);

export function MatchBoard({
  requirementId,
  requirementStatus,
  matches,
  budgetMax,
  canManage,
}: {
  requirementId: string;
  requirementStatus: string;
  matches: StoredMatch[];
  budgetMax: number | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const canConvert = !BLOCKED_CONVERSION.has(requirementStatus);

  async function decide(match: StoredMatch, decision: MatchDecision) {
    const reason = (notes[match.id] ?? "").trim();
    if (decision === "Rejected" && reason.length < 2) {
      setError("Say why this property was rejected.");
      return;
    }
    setPending(`${match.id}:${decision}`);
    setError("");
    const response = await fetch(
      `/api/admin/requirements/${encodeURIComponent(requirementId)}/matches/${encodeURIComponent(match.id)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      },
    );
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setPending("");
    if (!response.ok) {
      setError(data.error || "Could not save that decision.");
      return;
    }
    router.refresh();
  }

  if (matches.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No properties are on file for this requirement yet. Eligible matches are verified, available, and confirmed with
        the owner.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted">
        Mark shared only when you have actually shared the property. Nothing here sends a WhatsApp message, an email, or
        the listing to the client.
      </p>
      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <ol className="space-y-4">
        {matches.map((match) => (
          <li key={match.id} className="min-w-0 break-words rounded-2xl border border-brand-100 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {match.rank}. {match.propertyTitle}
                </p>
                <p className="text-xs text-ink-faint">{match.propertyCode}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Pill tone={match.matchingMode === "internal" ? "violet" : "green"}>
                  {match.matchingMode === "internal" ? "Internal" : "Public"}
                </Pill>
                <Pill>{match.status}</Pill>
                <Pill tone={match.eligible ? "green" : "stone"}>{match.eligible ? "Eligible" : "No longer eligible"}</Pill>
              </div>
            </div>
            <p className="mt-2 text-sm text-ink">
              {match.propertyType} · {match.listing} · {match.locality}
            </p>
            <p className="text-sm text-ink">
              {formatRupees(match.price)} · {budgetDifferenceLabel(match.price, budgetMax)}
            </p>
            {match.area > 0 && <p className="text-sm text-ink">{match.area.toLocaleString("en-IN")} sq ft</p>}
            {match.plotDimensions && <p className="text-sm text-ink">Plot {match.plotDimensions}</p>}
            <p className="mt-2 text-sm font-semibold text-ink">Match {match.score}</p>
            <p className="text-xs text-ink-muted">
              Locality {match.localityScore} · Area {match.areaScore} · Budget {match.budgetScore}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{match.explanation}</p>
            {match.decisionReason && <p className="mt-2 text-xs text-ink-muted">Latest note: {match.decisionReason}</p>}
            {canManage && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs font-semibold text-ink">
                  Note
                  <textarea
                    value={notes[match.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [match.id]: event.target.value }))}
                    rows={2}
                    maxLength={500}
                    placeholder="Required when rejecting. Optional for other decisions."
                    className="mt-1 w-full rounded-xl border border-brand-200 px-3 py-2 text-sm font-normal text-ink outline-none ring-brand-600 focus:ring-2"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {ACTIONS.filter((action) => action.decision !== "Converted" || canConvert).map((action) => {
                    const busy = pending === `${match.id}:${action.decision}`;
                    return (
                      <button
                        key={action.decision}
                        type="button"
                        className="btn-ghost px-3 py-2 text-xs"
                        disabled={Boolean(pending)}
                        onClick={() => void decide(match, action.decision)}
                      >
                        {busy ? "Saving…" : action.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

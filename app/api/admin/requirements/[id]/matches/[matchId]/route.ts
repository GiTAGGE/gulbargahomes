import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { MATCH_DECISIONS, decideRequirementMatch, type MatchDecision } from "@/lib/crm/matching";

type Context = { params: Promise<{ id: string; matchId: string }> };

/** Records a staff match decision. Nothing is sent to the client. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "match.manage");
  if ("response" in auth) return auth.response;
  const { id, matchId } = await context.params;

  try {
    const body = await readJson(request);
    const decision = body.decision;
    if (typeof decision !== "string" || !(MATCH_DECISIONS as readonly string[]).includes(decision)) {
      return jsonError(400, "Choose a match decision.");
    }
    const match = await decideRequirementMatch(
      auth.db,
      auth.admin,
      id,
      matchId,
      decision as MatchDecision,
      body.reason,
      nowIso(),
    );
    return NextResponse.json({ match });
  } catch (error) {
    return errorResponse(error);
  }
}

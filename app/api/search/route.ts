import { NextRequest, NextResponse } from "next/server";

import { searchSite } from "@/lib/site-search-data";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  return NextResponse.json({ results: searchSite(query) });
}

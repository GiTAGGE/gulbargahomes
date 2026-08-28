"use client";

import { useEffect } from "react";

const KEY = "hh-recent";

export function RecordView({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
      const next = [slug, ...stored.filter((item) => item !== slug)].slice(0, 8);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      localStorage.setItem(KEY, JSON.stringify([slug]));
    }
  }, [slug]);

  return null;
}

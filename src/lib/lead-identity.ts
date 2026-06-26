import type { Lead } from "./lead-types";

// Business-identity key for deduplication.
// IMPORTANT: never use the DB row id — every import creates a fresh row,
// so id-based "dedup" never merges duplicates.
const norm = (s: unknown) =>
  typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "";

export function leadIdentityKey(l: Lead): string {
  const placeId = (l as Record<string, unknown>).placeId;
  if (typeof placeId === "string" && placeId.trim()) return `pid:${placeId.trim()}`;
  const fid = (l as Record<string, unknown>).fid;
  if (typeof fid === "string" && fid.trim()) return `fid:${fid.trim()}`;
  const website = norm(l.website).replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (website) return `web:${website}`;
  const t = norm(l.title);
  const a = norm(l.address);
  if (t && a) return `ta:${t}|${a}`;
  const p = norm(l.phone);
  if (t && p) return `tp:${t}|${p}`;
  const id = (l as Record<string, unknown>).id;
  return `id:${typeof id === "string" ? id : ""}`;
}

export function dedupeLeads(arr: Lead[]): Lead[] {
  const map = new Map<string, Lead>();
  for (const l of arr) {
    const k = leadIdentityKey(l);
    const existing = map.get(k);
    if (!existing || (l.leadScore ?? 0) > (existing.leadScore ?? 0)) map.set(k, l);
  }
  return [...map.values()];
}
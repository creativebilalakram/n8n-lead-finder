import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "./lead-types";
import { applyFiltersToLead, type FilterSettings } from "./filter-settings";
import { leadIdentityKey } from "./lead-identity";

const COMPACT_LEADS_SELECT =
  "id, search_run_id, place_id, title, category, address, city, country_code, phone, email, website, rating, reviews_count, lead_score, lead_tier, passed, owner_update_age_days, auto_enrich_status, created_at, website_modern_score, website_label";

type CompactLeadRow = {
  id: string;
  search_run_id?: string | null;
  place_id?: string | null;
  title?: string | null;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  country_code?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  rating?: number | null;
  reviews_count?: number | null;
  lead_score?: number | null;
  lead_tier?: string | null;
  passed?: boolean | null;
  owner_update_age_days?: number | null;
  auto_enrich_status?: string | null;
  created_at?: string | null;
  website_modern_score?: number | null;
  website_label?: string | null;
};

function rowToLead(r: CompactLeadRow): Lead {
  return {
    id: r.id,
    searchRunId: r.search_run_id ?? undefined,
    placeId: r.place_id ?? undefined,
    title: r.title ?? undefined,
    categoryName: r.category ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    countryCode: r.country_code ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    emails: r.email ? [r.email] : undefined,
    website: r.website ?? undefined,
    totalScore: r.rating ?? undefined,
    reviewsCount: r.reviews_count ?? undefined,
    leadScore: r.lead_score ?? undefined,
    leadTier: r.lead_tier ?? undefined,
    ownerUpdateAgeDays: r.owner_update_age_days ?? undefined,
    autoEnrichStatus: r.auto_enrich_status ?? undefined,
    createdAtIso: r.created_at ?? undefined,
    passed: Boolean(r.passed),
    websiteModernScore: r.website_modern_score ?? undefined,
    websiteLabel: r.website_label ?? undefined,
  };
}

export async function fetchCompactLeads(searchRunId?: string): Promise<Lead[]> {
  const PAGE = 1000;
  let from = 0;
  const out: Lead[] = [];
  while (true) {
    let query = supabase.from("leads").select(COMPACT_LEADS_SELECT);
    if (searchRunId) query = query.eq("search_run_id", searchRunId);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as CompactLeadRow[];
    out.push(...rows.map(rowToLead));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function leadTime(l: Lead): number {
  const raw = (l as Record<string, unknown>).createdAtIso;
  return typeof raw === "string" ? new Date(raw).getTime() || 0 : 0;
}

function preferLead(candidate: Lead, existing: Lead): boolean {
  if (candidate.passed && !existing.passed) return true;
  if (candidate.passed !== existing.passed) return false;
  const scoreDiff = (candidate.leadScore ?? 0) - (existing.leadScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff > 0;
  return leadTime(candidate) > leadTime(existing);
}

export function getLiveLeadSets(rawLeads: Lead[], settings: FilterSettings) {
  const evaluated = rawLeads.map((l) => applyFiltersToLead(l, settings));
  const map = new Map<string, Lead>();
  for (const lead of evaluated) {
    const key = leadIdentityKey(lead);
    const existing = map.get(key);
    if (!existing || preferLead(lead, existing)) map.set(key, lead);
  }
  const all = [...map.values()].sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
  return {
    all,
    qualified: all.filter((l) => l.passed),
    filteredOut: all.filter((l) => !l.passed),
  };
}

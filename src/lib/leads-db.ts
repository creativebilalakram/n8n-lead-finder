import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { Lead, SearchParamsSnapshot, SearchRecord } from "./lead-types";

// ----- helpers -----

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  return undefined;
}
function pickNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}
function pickArr<T = unknown>(v: unknown): T[] | undefined {
  return Array.isArray(v) ? (v as T[]) : undefined;
}

function leadToRow(lead: Lead, searchRunId: string, apifyRunId: string | null) {
  const emails = pickArr<string>(lead.emails);
  const phones = pickArr<string>(lead.phones);
  const ownerUpdateAgeDays = pickNum((lead as Record<string, unknown>).ownerUpdateAgeDays);
  // Preserve the FULL enriched Apify payload so the Lovable prompt can be
  // rebuilt on-demand with every original field intact. We strip the giant
  // pre-encoded `lovableUrl` (rebuilt at click time) to keep row size sane.
  const rawSource = (lead as Record<string, unknown>).raw ?? lead;
  let raw: Json | null = null;
  try {
    const clone = { ...(rawSource as Record<string, unknown>) };
    delete clone.lovableUrl;
    raw = clone as unknown as Json;
  } catch {
    raw = null;
  }
  return {
    search_run_id: searchRunId,
    apify_run_id: apifyRunId,
    place_id: pickStr((lead as Record<string, unknown>).placeId) ?? pickStr((lead as Record<string, unknown>).fid) ?? null,
    title: pickStr(lead.title) ?? null,
    category: pickStr(lead.categoryName) ?? null,
    address: pickStr(lead.address) ?? null,
    city: pickStr((lead as Record<string, unknown>).city) ?? null,
    country_code: pickStr((lead as Record<string, unknown>).countryCode) ?? null,
    phone: pickStr(lead.phone) ?? phones?.[0] ?? null,
    phones: phones ?? null,
    email: emails?.[0] ?? null,
    emails: emails ?? null,
    website: pickStr(lead.website) ?? null,
    rating: pickNum(lead.totalScore) ?? null,
    reviews_count: pickNum(lead.reviewsCount) ?? null,
    lead_score: pickNum(lead.leadScore) ?? null,
    lead_tier: pickStr(lead.leadTier) ?? null,
    red_flags: (pickArr(lead.redFlags) as Json) ?? null,
    passed: Boolean(lead.passed),
    rejection_reasons: (pickArr(lead.rejectionReasons) as Json) ?? null,
    // Lovable URL is rebuilt on demand from `raw` to avoid bloating row size.
    lovable_url: null,
    owner_update_age_days: ownerUpdateAgeDays ?? null,
    raw,
  };
}

// ----- writes -----

export type SaveSearchInput = {
  apifyRunId?: string | null;
  source: "search" | "import";
  params: SearchParamsSnapshot;
  leads: Lead[];
  filteredOut: Lead[];
  total: number;
  apifyStartedAt?: string | null;
  apifyFinishedAt?: string | null;
};

export async function saveSearchRun(input: SaveSearchInput): Promise<string> {
  const { data: run, error: runErr } = await supabase
    .from("search_runs")
    .insert({
      apify_run_id: input.apifyRunId ?? null,
      source: input.source,
      params: input.params as unknown as Json,
      qualified_count: input.leads.length,
      filtered_count: input.filteredOut.length,
      total_count: input.total,
      apify_started_at: input.apifyStartedAt ?? null,
      apify_finished_at: input.apifyFinishedAt ?? null,
    })
    .select("id")
    .single();
  if (runErr || !run) throw runErr ?? new Error("Failed to create search_run");

  const allLeads = [
    ...input.leads.map((l) => ({ ...l, passed: true })),
    ...input.filteredOut.map((l) => ({ ...l, passed: false })),
  ];
  if (allLeads.length) {
    const rows = allLeads.map((l) => leadToRow(l, run.id, input.apifyRunId ?? null));
    // chunk to avoid payload limits (raw jsonb can be heavy)
    const CHUNK = 25;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase.from("leads").insert(rows.slice(i, i + CHUNK) as never);
      if (error) {
        // rollback parent row so we don't leave an orphan "0 leads" run
        await supabase.from("search_runs").delete().eq("id", run.id);
        throw error;
      }
    }
  }
  return run.id;
}

export async function deleteSearchRun(id: string) {
  const { error } = await supabase.from("search_runs").delete().eq("id", id);
  if (error) throw error;
}

export async function clearAllSearchRuns() {
  const { error } = await supabase
    .from("search_runs")
    .delete()
    .not("id", "is", null);
  if (error) throw error;
}

// ----- reads -----

export type SearchRunSummary = {
  id: string;
  createdAt: string;
  apifyRunId: string | null;
  source: "search" | "import";
  params: SearchParamsSnapshot;
  qualifiedCount: number;
  filteredCount: number;
  totalCount: number;
};

export async function listSearchRuns(limit = 200): Promise<SearchRunSummary[]> {
  const { data, error } = await supabase
    .from("search_runs")
    .select(
      "id, created_at, apify_run_id, source, params, qualified_count, filtered_count, total_count",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    apifyRunId: r.apify_run_id,
    source: r.source as "search" | "import",
    params: (r.params ?? {}) as unknown as SearchParamsSnapshot,
    qualifiedCount: r.qualified_count ?? 0,
    filteredCount: r.filtered_count ?? 0,
    totalCount: r.total_count ?? 0,
  }));
}

export async function listImportedApifyRunIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("search_runs")
    .select("apify_run_id")
    .not("apify_run_id", "is", null);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.apify_run_id as string));
}

export async function getSearchRunDetail(
  id: string,
): Promise<(SearchRecord & { source: "search" | "import"; apifyRunId: string | null }) | null> {
  const { data: run, error } = await supabase
    .from("search_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;

  const { data: rows, error: lErr } = await supabase
    .from("leads")
    .select(
      "id, place_id, title, category, address, city, country_code, phone, email, website, rating, reviews_count, lead_score, lead_tier, red_flags, passed, rejection_reasons, owner_update_age_days",
    )
    .eq("search_run_id", id)
    .order("lead_score", { ascending: false, nullsFirst: false });
  if (lErr) throw lErr;

  const leads: Lead[] = [];
  const filteredOut: Lead[] = [];
  for (const r of rows ?? []) {
    const lead: Lead = {
      id: r.id,
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
      redFlags: (r.red_flags as string[] | null) ?? undefined,
      ownerUpdateAgeDays: r.owner_update_age_days ?? undefined,
      passed: r.passed,
      rejectionReasons: (r.rejection_reasons as string[] | null) ?? undefined,
    };
    if (r.passed) leads.push(lead);
    else filteredOut.push(lead);
  }

  return {
    id: run.id,
    createdAt: new Date(run.created_at).getTime(),
    params: (run.params ?? {}) as unknown as SearchParamsSnapshot,
    leads,
    filteredOut,
    total: run.total_count ?? leads.length + filteredOut.length,
    source: run.source as "search" | "import",
    apifyRunId: run.apify_run_id,
  };
}

// One-shot migration of legacy localStorage data into DB.
export async function migrateLegacyLocalStorage(): Promise<number> {
  if (typeof window === "undefined") return 0;
  const FLAG = "lead-gen-db-migrated-v1";
  if (localStorage.getItem(FLAG)) return 0;
  const raw = localStorage.getItem("lead-gen-searches-v1");
  if (!raw) {
    localStorage.setItem(FLAG, "1");
    return 0;
  }
  let arr: SearchRecord[] = [];
  try {
    arr = JSON.parse(raw) as SearchRecord[];
  } catch {
    localStorage.setItem(FLAG, "1");
    return 0;
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    localStorage.setItem(FLAG, "1");
    return 0;
  }
  let saved = 0;
  for (const rec of arr) {
    try {
      const apifyRunId =
        (rec as SearchRecord & { apifyRunId?: string }).apifyRunId ?? null;
      await saveSearchRun({
        apifyRunId,
        source: apifyRunId ? "import" : "search",
        params: rec.params,
        leads: rec.leads ?? [],
        filteredOut: rec.filteredOut ?? [],
        total: rec.total ?? (rec.leads?.length ?? 0) + (rec.filteredOut?.length ?? 0),
      });
      saved++;
    } catch {
      // skip duplicates / errors
    }
  }
  localStorage.setItem(FLAG, "1");
  return saved;
}
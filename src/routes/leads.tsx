import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Users, Search as SearchIcon, Check } from "lucide-react";
import { LeadCard } from "@/components/lead-card";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/lead-types";
import { isClicked, leadKey, useClickedSync } from "@/lib/clicked-leads";
import { leadIdentityKey } from "@/lib/lead-identity";
import { applyFiltersToLead, useFilterSettings } from "@/lib/filter-settings";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "All Leads — LeadForge" }] }),
  component: AllLeadsPage,
});

async function fetchAllLeads(): Promise<Lead[]> {
  const PAGE = 1000;
  let from = 0;
  const out: Lead[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select(
        "id, place_id, title, category, address, city, country_code, phone, email, website, rating, reviews_count, lead_score, lead_tier, passed, owner_update_age_days",
      )
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      out.push({
        id: r.id,
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
        passed: r.passed,
        placeId: r.place_id ?? undefined,
      });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  // sort client-side to avoid DB sort on huge jsonb result
  return out.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
}

function AllLeadsPage() {
  useClickedSync();
  const [settings] = useFilterSettings();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | "hot" | "warm" | "mild" | "cold">("all");
  const [onlyUnopened, setOnlyUnopened] = useState(false);
  const [view, setView] = useState<"qualified" | "filtered">("qualified");

  const { data: rawLeads, isLoading, isError, error } = useQuery({
    queryKey: ["all-leads-compact-v3"],
    queryFn: fetchAllLeads,
    retry: 1,
  });

  // Re-evaluate against current filter settings (live), then dedupe both sets.
  // IMPORTANT: dedupe by a business-identity key (placeId, else website,
  // else normalized title+address), NOT by the DB row id — every import
  // produces a fresh row id, so id-based dedup never merges duplicates.
  // Re-evaluate live, then dedupe by business identity (placeId / website /
  // title+address / title+phone). DB row id is unique per import so it
  // cannot be the dedup key.
  const { qualified, filteredOut } = useMemo(() => {
    if (!rawLeads) return { qualified: undefined as Lead[] | undefined, filteredOut: undefined as Lead[] | undefined };
    const evaluated = rawLeads.map((l) => applyFiltersToLead(l, settings));
    // Dedupe across BOTH sets together so the same business doesn't appear
    // once as Qualified and again as Filtered after a settings change.
    const map = new Map<string, Lead>();
    for (const l of evaluated) {
      const k = leadIdentityKey(l);
      const ex = map.get(k);
      if (!ex) {
        map.set(k, l);
        continue;
      }
      // Prefer the qualified copy; otherwise the one with the higher score.
      const better =
        (l.passed && !ex.passed) ||
        (l.passed === ex.passed && (l.leadScore ?? 0) > (ex.leadScore ?? 0));
      if (better) map.set(k, l);
    }
    const all = [...map.values()].sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
    return {
      qualified: all.filter((l) => l.passed),
      filteredOut: all.filter((l) => !l.passed),
    };
  }, [rawLeads, settings]);

  const leads = view === "qualified" ? qualified : filteredOut;

  const filtered = useMemo(() => {
    if (!leads) return [];
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (tier !== "all" && (l.leadTier || "").toLowerCase() !== tier) return false;
      if (onlyUnopened && isClicked(leadKey(l))) return false;
      if (!needle) return true;
      const hay = `${l.title ?? ""} ${l.address ?? ""} ${l.categoryName ?? ""} ${l.website ?? ""} ${(l.emails ?? []).join(" ")}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [leads, q, tier, onlyUnopened]);

  const openedCount = useMemo(
    () => (leads ?? []).filter((l) => isClicked(leadKey(l))).length,
    [leads],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
            <Users className="h-3.5 w-3.5" />
            All Leads
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Every qualified lead in your workspace
          </h1>
          <p className="mt-1 text-sm text-slate-500">
          Combined from every search and every Apify import. Filters are live — adjust them in{" "}
          <Link to="/settings" className="font-semibold text-indigo-600 hover:underline">
            Settings
          </Link>
          .
          </p>
        <p className="mt-1 text-xs text-slate-400">
          Current: reviews {settings.minReviews}–{settings.maxReviews} · rating{" "}
          {settings.minRating}–{settings.maxRating} · owner ≤ {settings.activeOwnerDays}d
        </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
            {(qualified?.length ?? 0)} qualified · {(filteredOut?.length ?? 0)} filtered
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
            <Check className="h-3 w-3" />
            {openedCount} opened
          </span>
        </div>
      </div>

      <div className="mt-6 inline-flex rounded-xl border border-slate-200 bg-white/70 p-1 backdrop-blur">
        <button
          type="button"
          onClick={() => setView("qualified")}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            view === "qualified" ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Qualified ({qualified?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setView("filtered")}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            view === "filtered" ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Filtered Out ({filteredOut?.length ?? 0})
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 backdrop-blur">
        <div className="relative min-w-[220px] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, address, email, website…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "hot", "warm", "mild", "cold"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition ${
                tier === t
                  ? "bg-slate-900 text-white shadow"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={onlyUnopened}
            onChange={(e) => setOnlyUnopened(e.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-600"
          />
          Only unopened
        </label>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="py-20 text-center text-slate-500">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <div className="mt-2 text-sm">Loading leads…</div>
          </div>
        ) : isError ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50/70 px-8 py-10 text-center text-rose-700 backdrop-blur">
            <p className="text-sm font-semibold">Could not load leads.</p>
            <p className="mt-1 text-xs text-rose-600">
              {error instanceof Error ? error.message : "Please refresh and try again."}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-16 text-center backdrop-blur">
            <p className="text-sm text-slate-500">
              {leads && leads.length === 0
                ? "No qualified leads yet. Run a search or import an Apify run."
                : "No leads match your filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 text-xs text-slate-500">
              Showing {filtered.length} of {leads?.length ?? 0}
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((lead, i) => (
                <LeadCard key={leadKey(lead) + i} lead={lead} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
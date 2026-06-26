import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Loader2, Users, Search as SearchIcon, Check } from "lucide-react";
import { LeadCard } from "@/components/lead-card";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/lead-types";
import { isClicked, leadKey, useClickedSync } from "@/lib/clicked-leads";

export const Route = createFileRoute("/leads")({
  head: () => ({ meta: [{ title: "All Leads — LeadForge" }] }),
  component: AllLeadsPage,
});

async function fetchAllQualifiedLeads(): Promise<Lead[]> {
  const PAGE = 1000;
  let from = 0;
  const out: Lead[] = [];
  // paginate to avoid the 1000-row default cap
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("passed", true)
      .order("lead_score", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const raw = (r.raw as Record<string, unknown> | null) ?? {};
      out.push({
        ...raw,
        title: r.title ?? (raw.title as string | undefined),
        categoryName: r.category ?? (raw.categoryName as string | undefined),
        address: r.address ?? (raw.address as string | undefined),
        phone: r.phone ?? (raw.phone as string | undefined),
        phones: (r.phones as string[] | null) ?? (raw.phones as string[] | undefined),
        emails: (r.emails as string[] | null) ?? (raw.emails as string[] | undefined),
        website: r.website ?? (raw.website as string | undefined),
        totalScore: r.rating ?? (raw.totalScore as number | undefined),
        reviewsCount: r.reviews_count ?? (raw.reviewsCount as number | undefined),
        leadScore: r.lead_score ?? (raw.leadScore as number | undefined),
        leadTier: r.lead_tier ?? (raw.leadTier as string | undefined),
        redFlags: (r.red_flags as string[] | null) ?? (raw.redFlags as string[] | undefined),
        lovableUrl: r.lovable_url ?? (raw.lovableUrl as string | undefined),
        passed: true,
        placeId: r.place_id ?? (raw.placeId as string | undefined),
      });
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  // de-duplicate by leadKey, keep highest score
  const map = new Map<string, Lead>();
  for (const l of out) {
    const k = leadKey(l);
    const existing = map.get(k);
    if (!existing || (l.leadScore ?? 0) > (existing.leadScore ?? 0)) map.set(k, l);
  }
  return [...map.values()].sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
}

function AllLeadsPage() {
  useClickedSync();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<"all" | "hot" | "warm" | "mild" | "cold">("all");
  const [onlyUnopened, setOnlyUnopened] = useState(false);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["all-qualified-leads"],
    queryFn: fetchAllQualifiedLeads,
  });

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
            Combined from every search and every Apify import. Clicking{" "}
            <span className="font-semibold">Open in Lovable</span> marks the lead as opened.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
            {leads?.length ?? 0} total
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
            <Check className="h-3 w-3" />
            {openedCount} opened
          </span>
        </div>
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
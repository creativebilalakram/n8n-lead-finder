import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Filter, ChevronDown, ChevronUp, Flame, Loader2 } from "lucide-react";
import { LeadCard } from "@/components/lead-card";
import { getSearchRunDetail } from "@/lib/leads-db";
import { applyFiltersToLead, useFilterSettings } from "@/lib/filter-settings";
import type { Lead } from "@/lib/lead-types";

export const Route = createFileRoute("/history/$id")({
  head: () => ({ meta: [{ title: "Search — LeadForge" }] }),
  component: HistoryDetailPage,
});

function HistoryDetailPage() {
  const { id } = useParams({ from: "/history/$id" });
  const [settings] = useFilterSettings();
  const [showFiltered, setShowFiltered] = useState(true);
  const { data: record, isLoading } = useQuery({
    queryKey: ["search_run", id],
    queryFn: () => getSearchRunDetail(id),
  });

  // Live re-evaluation: combine and re-split using current global filter settings.
  const { liveLeads, liveFiltered } = useMemo(() => {
    if (!record) return { liveLeads: [] as Lead[], liveFiltered: [] as Lead[] };
    const all: Lead[] = [...record.leads, ...record.filteredOut].map((l) =>
      applyFiltersToLead(l, settings),
    );
    const pass: Lead[] = [];
    const fail: Lead[] = [];
    for (const l of all) (l.passed ? pass : fail).push(l);
    pass.sort((a, b) => (b.leadScore ?? 0) - (a.leadScore ?? 0));
    return { liveLeads: pass, liveFiltered: fail };
  }, [record, settings]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-slate-500">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
        <div className="mt-2 text-sm">Loading search…</div>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Search not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          It may have been deleted from this device.
        </p>
        <Link
          to="/history"
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to history
        </Link>
      </div>
    );
  }

  const tierCounts = liveLeads.reduce<{ hot: number; warm: number; mild: number }>(
    (acc, l) => {
      const t = (l.leadTier || "").toLowerCase();
      if (t === "hot") acc.hot++;
      else if (t === "warm") acc.warm++;
      else if (t === "mild") acc.mild++;
      return acc;
    },
    { hot: 0, warm: 0, mild: 0 },
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
      <Link
        to="/history"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to history
      </Link>
      <div className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {record.params.keywords.join(" · ")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {new Date(record.createdAt).toLocaleString()} · country{" "}
          <span className="font-medium uppercase">{record.params.countryCode}</span> · max{" "}
          {record.params.maxPlaces} places
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Live filters: reviews {settings.minReviews}–{settings.maxReviews} · rating{" "}
          {settings.minRating}–{settings.maxRating} · owner ≤ {settings.activeOwnerDays}d ·{" "}
          <Link to="/settings" className="font-semibold text-indigo-600 hover:underline">
            adjust
          </Link>
        </p>
      </div>

      <div className="mt-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">
            {liveLeads.length} qualified lead{liveLeads.length === 1 ? "" : "s"}
          </h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {tierCounts.hot > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 font-medium text-rose-700 ring-1 ring-rose-200">
                <Flame className="h-3 w-3" />
                {tierCounts.hot} Hot
              </span>
            )}
            {tierCounts.warm > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
                {tierCounts.warm} Warm
              </span>
            )}
            {tierCounts.mild > 0 && (
              <span className="rounded-full bg-sky-100 px-3 py-1 font-medium text-sky-700 ring-1 ring-sky-200">
                {tierCounts.mild} Mild
              </span>
            )}
          </div>
        </div>

        {liveLeads.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-12 text-center backdrop-blur">
            <p className="text-sm text-slate-500">No leads passed the filters for this search.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {liveLeads.map((lead, i) => (
              <LeadCard key={i} lead={lead} />
            ))}
          </div>
        )}

        {liveFiltered.length > 0 && (
          <div className="mt-14">
            <button
              type="button"
              onClick={() => setShowFiltered((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white/60 px-5 py-4 text-left shadow-sm backdrop-blur transition hover:bg-white/80"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white shadow">
                  <Filter className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {liveFiltered.length} filtered out
                  </div>
                  <div className="text-xs text-slate-500">
                    Businesses that didn't pass your filters — see why
                  </div>
                </div>
              </div>
              {showFiltered ? (
                <ChevronUp className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              )}
            </button>

            {showFiltered && (
              <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {liveFiltered.map((lead, i) => (
                  <LeadCard key={i} lead={lead} muted />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
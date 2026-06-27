import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  Sparkles,
  Search,
  History as HistoryIcon,
  TrendingUp,
  Filter,
  ArrowRight,
} from "lucide-react";
import { listSearchRuns, migrateLegacyLocalStorage, type SearchRunSummary } from "@/lib/leads-db";
import { useFilterSettings } from "@/lib/filter-settings";
import { fetchCompactLeads, getLiveLeadSets } from "@/lib/leads-query";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — LeadForge" },
      {
        name: "description",
        content: "Your lead generation dashboard with stats and recent searches.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const [settings] = useFilterSettings();

  const { data: searches = [], refetch } = useQuery<SearchRunSummary[]>({
    queryKey: ["search_runs"],
    queryFn: () => listSearchRuns(200),
  });

  const { data: rawLeads = [] } = useQuery({
    queryKey: ["dashboard-leads-compact-v4"],
    queryFn: () => fetchCompactLeads(),
    retry: 1,
  });

  useEffect(() => {
    (async () => {
      const n = await migrateLegacyLocalStorage();
      if (n > 0) refetch();
    })();
  }, [refetch]);

  const liveStats = useMemo(() => {
    const { qualified, filteredOut } = getLiveLeadSets(rawLeads, settings);
    return {
      qualified: qualified.length,
      filtered: filteredOut.length,
      hot: qualified.filter((l) => (l.leadTier || "").toLowerCase() === "hot").length,
    };
  }, [rawLeads, settings]);

  return (
    <div className="relative min-h-[calc(100vh-3rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-300/40 to-fuchsia-300/40 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-amber-200/40 to-rose-300/40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-[11px] font-medium text-slate-600 backdrop-blur">
              <Sparkles className="h-3 w-3 text-indigo-500" />
              Welcome back
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Dashboard
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Find scored local-business leads, then open the best ones directly in Lovable.
            </p>
          </div>
          <Link
            to="/search"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl hover:shadow-indigo-500/40"
          >
            <Search className="h-4 w-4" />
            New Search
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<HistoryIcon className="h-5 w-5" />}
            label="Total Searches"
            value={searches.length}
            tint="from-indigo-500 to-violet-500"
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label="Qualified Leads"
            value={liveStats.qualified}
            tint="from-emerald-500 to-teal-500"
          />
          <StatCard
            icon={<Flame className="h-5 w-5" />}
            label="Hot Leads"
            value={liveStats.hot}
            tint="from-rose-500 to-orange-500"
          />
          <StatCard
            icon={<Filter className="h-5 w-5" />}
            label="Filtered Out"
            value={liveStats.filtered}
            tint="from-slate-500 to-slate-700"
          />
        </div>

        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Recent searches</h2>
            {searches.length > 0 && (
              <Link
                to="/history"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {searches.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-16 text-center backdrop-blur">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-200">
                <Search className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">No searches yet</h3>
              <p className="mt-1 text-sm text-slate-500">
                Run your first search to populate your dashboard.
              </p>
              <Link
                to="/search"
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-md"
              >
                <Search className="h-4 w-4" />
                Start a search
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {searches.slice(0, 6).map((r) => (
                <Link
                  key={r.id}
                  to="/history/$id"
                  params={{ id: r.id }}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm shadow-slate-200/40 backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-200/40"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {r.params.keywords.join(" · ") || "Untitled search"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString()} ·{" "}
                      <span className="font-medium text-emerald-600">{r.qualifiedCount} kept</span>{" "}
                      ·{" "}
                      <span className="font-medium text-slate-500">{r.filteredCount} filtered</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-indigo-600" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tint: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm shadow-slate-200/50 backdrop-blur-xl">
      <div
        className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${tint} text-white shadow-md`}
      >
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-500">{label}</div>
    </div>
  );
}

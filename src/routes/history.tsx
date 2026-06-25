import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, History as HistoryIcon, Trash2, Search } from "lucide-react";
import { loadSearches, clearSearches, deleteSearch } from "@/lib/lead-store";
import type { SearchRecord } from "@/lib/lead-types";
import { toast } from "sonner";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [{ title: "History — LeadForge" }],
  }),
  component: HistoryListPage,
});

function HistoryListPage() {
  const [searches, setSearches] = useState<SearchRecord[]>([]);

  useEffect(() => {
    setSearches(loadSearches());
  }, []);

  const refresh = () => setSearches(loadSearches());

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-[11px] font-medium text-slate-600 backdrop-blur">
            <HistoryIcon className="h-3 w-3 text-indigo-500" />
            All searches
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            History
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Every search you've run is saved locally on this device.
          </p>
        </div>
        {searches.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!confirm("Delete all search history?")) return;
              clearSearches();
              refresh();
              toast.success("History cleared");
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </button>
        )}
      </div>

      <div className="mt-8">
        {searches.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-16 text-center backdrop-blur">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-200">
              <Search className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">No history yet</h3>
            <p className="mt-1 text-sm text-slate-500">Run your first search to populate it.</p>
            <Link
              to="/search"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 text-sm font-semibold text-white shadow-md"
            >
              <Search className="h-4 w-4" />
              New search
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {searches.map((r) => (
              <div
                key={r.id}
                className="group flex items-center justify-between gap-4 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm shadow-slate-200/40 backdrop-blur-xl transition hover:shadow-lg hover:shadow-indigo-200/40"
              >
                <Link
                  to="/history/$id"
                  params={{ id: r.id }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {r.params.keywords.join(" · ") || "Untitled search"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString()} ·{" "}
                      <span className="font-medium text-emerald-600">
                        {r.leads.length} kept
                      </span>{" "}
                      ·{" "}
                      <span className="font-medium text-slate-500">
                        {r.filteredOut.length} filtered
                      </span>{" "}
                      · {r.total} total
                    </div>
                  </div>
                </Link>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm("Delete this search?")) return;
                      deleteSearch(r.id);
                      refresh();
                    }}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <Link
                    to="/history/$id"
                    params={{ id: r.id }}
                    className="rounded-lg p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
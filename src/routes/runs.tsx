import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Download, RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveSearchRun, listImportedApifyRunIds } from "@/lib/leads-db";
import { triggerAutoEnrichForRun } from "@/lib/auto-enrich";
import type { Lead } from "@/lib/lead-types";

export const Route = createFileRoute("/runs")({
  head: () => ({ meta: [{ title: "Apify Runs — LeadForge" }] }),
  component: RunsPage,
});

type ApifyRun = {
  id: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  defaultDatasetId?: string;
  stats?: { inputBodyLen?: number; computeUnits?: number } & Record<string, unknown>;
  usageTotalUsd?: number;
  buildNumber?: string;
  itemCount?: number;
  cleanItemCount?: number;
};

function fmtDate(s?: string) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

function durationMs(a?: string, b?: string) {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
    SUCCEEDED: { cls: "bg-emerald-100 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
    FAILED: { cls: "bg-red-100 text-red-700 border-red-200", Icon: XCircle },
    ABORTED: { cls: "bg-slate-200 text-slate-700 border-slate-300", Icon: XCircle },
    "TIMED-OUT": { cls: "bg-amber-100 text-amber-700 border-amber-200", Icon: Clock },
    RUNNING: { cls: "bg-indigo-100 text-indigo-700 border-indigo-200", Icon: Loader2 },
    READY: { cls: "bg-slate-100 text-slate-700 border-slate-200", Icon: Clock },
  };
  const v = map[status] ?? { cls: "bg-slate-100 text-slate-700 border-slate-200", Icon: Clock };
  const { Icon, cls } = v;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <Icon className={`h-3 w-3 ${status === "RUNNING" ? "animate-spin" : ""}`} />
      {status}
    </span>
  );
}

function RunsPage() {
  const [runs, setRuns] = useState<ApifyRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedRunIds, setImportedRunIds] = useState<Set<string>>(new Set());

  const refreshImported = async () => {
    try {
      setImportedRunIds(await listImportedApifyRunIds());
    } catch {
      /* ignore */
    }
  };

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/public/apify/runs?limit=50");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRuns(json.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
    refreshImported();
  }, []);

  const importRun = async (run: ApifyRun) => {
    if (run.status !== "SUCCEEDED") {
      toast.error(`Only SUCCEEDED runs can be imported (this is ${run.status})`);
      return;
    }
    setImportingId(run.id);
    try {
      const res = await fetch(`/api/public/apify/import?runId=${run.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      const leads = (json.leads ?? []) as Lead[];
      const filteredOut = (json.filteredOut ?? []) as Lead[];

      await saveSearchRun({
        apifyRunId: run.id,
        source: "import",
        params: {
          keywords: ["(imported from Apify)"],
          countryCode: "",
          maxPlaces: json.total ?? 0,
          minReviews: 20,
          maxReviews: 150,
          minRating: 4.2,
          maxRating: 4.8,
          activeOwnerDays: 60,
        },
        leads,
        filteredOut,
        total: json.total ?? leads.length + filteredOut.length,
        apifyStartedAt: run.startedAt ?? null,
        apifyFinishedAt: run.finishedAt ?? null,
      });
      await refreshImported();
      toast.success(`Imported ${leads.length} qualified leads (${filteredOut.length} filtered)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-[11px] font-medium text-slate-600 backdrop-blur">
            <Activity className="h-3 w-3 text-indigo-500" />
            Apify sync
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Apify Runs
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Live view of every Google Places actor run on your Apify account. Import any past run to score & add it to History.
          </p>
        </div>
        <button
          onClick={fetchRuns}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm font-medium text-slate-700 backdrop-blur transition hover:bg-white disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white/70 shadow-sm backdrop-blur">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Leads</th>
              <th className="px-4 py-3">Run ID</th>
              <th className="px-4 py-3">Cost</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  <div className="mt-2">Loading runs…</div>
                </td>
              </tr>
            )}
            {!loading && runs.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  No runs found.
                </td>
              </tr>
            )}
            {runs.map((r) => {
              const isImported = importedRunIds.has(r.id);
              const isImporting = importingId === r.id;
              const canImport = r.status === "SUCCEEDED";
              return (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-slate-700">{fmtDate(r.startedAt)}</td>
                  <td className="px-4 py-3 text-slate-700">{durationMs(r.startedAt, r.finishedAt)}</td>
                  <td className="px-4 py-3">
                    {typeof r.itemCount === "number" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        {r.itemCount} {r.itemCount === 1 ? "lead" : "leads"}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.id}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {typeof r.usageTotalUsd === "number" ? `$${r.usageTotalUsd.toFixed(4)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isImported ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Imported
                      </span>
                    ) : (
                      <button
                        onClick={() => importRun(r)}
                        disabled={!canImport || isImporting}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isImporting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isImporting ? "Importing…" : "Import"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
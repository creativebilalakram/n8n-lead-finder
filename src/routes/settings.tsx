import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
  RotateCcw,
  Check,
  BarChart3,
  SlidersHorizontal,
  Loader2,
  AlertCircle,
  Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Lead } from "@/lib/lead-types";
import { isClicked, leadKey, useClickedSync } from "@/lib/clicked-leads";
import { leadIdentityKey } from "@/lib/lead-identity";
import { triggerAutoEnrichBacklog } from "@/lib/auto-enrich";
import { fetchCompactLeads, getLiveLeadSets } from "@/lib/leads-query";
import { toast } from "sonner";
import {
  DEFAULT_FILTERS,
  type FilterSettings,
  evaluateLead,
  useFilterSettings,
} from "@/lib/filter-settings";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — LeadForge" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [tab, setTab] = useState<"filters" | "analytics">("filters");
  const [settings, setSettings, settingsLoading] = useFilterSettings();
  const [draft, setDraft] = useState<FilterSettings>(() => settings);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep the editable draft in sync with the persisted backend settings.
  // This matters on first hydration and after reset/save events.
  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty =
    draft.minReviews !== settings.minReviews ||
    draft.maxReviews !== settings.maxReviews ||
    draft.minRating !== settings.minRating ||
    draft.maxRating !== settings.maxRating ||
    draft.activeOwnerDays !== settings.activeOwnerDays ||
    draft.reviewsEnabled !== settings.reviewsEnabled ||
    draft.ratingEnabled !== settings.ratingEnabled ||
    draft.ownerEnabled !== settings.ownerEnabled;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await setSettings(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    setDraft(DEFAULT_FILTERS);
    setSaving(true);
    setSaveError(null);
    try {
      await setSettings(DEFAULT_FILTERS);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not reset settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-12">
      <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
        <SettingsIcon className="h-3.5 w-3.5" />
        Settings
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Filters & Analytics
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Adjust global qualification filters and review live analytics across every lead in your
        workspace.
      </p>

      <div className="mt-6 inline-flex rounded-xl border border-slate-200 bg-white/70 p-1 backdrop-blur">
        <button
          type="button"
          onClick={() => setTab("filters")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            tab === "filters" ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        </button>
        <button
          type="button"
          onClick={() => setTab("analytics")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
            tab === "analytics" ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" /> Analytics
        </button>
      </div>

      {tab === "analytics" ? (
        <>
          <BackfillAutomationCard />
          <AnalyticsPanel settings={settings} />
        </>
      ) : (
      <div className="mt-6 space-y-5 rounded-3xl border border-slate-200 bg-white/70 p-6 shadow-sm backdrop-blur">
        <Pair
          label="Reviews count"
          help="Lead must have between X and Y reviews."
          enabled={draft.reviewsEnabled}
          onToggle={(v) => setDraft({ ...draft, reviewsEnabled: v })}
          minValue={draft.minReviews}
          maxValue={draft.maxReviews}
          step={1}
          onMin={(v) => setDraft({ ...draft, minReviews: v })}
          onMax={(v) => setDraft({ ...draft, maxReviews: v })}
        />
        <Pair
          label="Rating"
          help="Google rating must fall in this window."
          enabled={draft.ratingEnabled}
          onToggle={(v) => setDraft({ ...draft, ratingEnabled: v })}
          minValue={draft.minRating}
          maxValue={draft.maxRating}
          step={0.1}
          onMin={(v) => setDraft({ ...draft, minRating: v })}
          onMax={(v) => setDraft({ ...draft, maxRating: v })}
        />
        <div className={draft.ownerEnabled ? "" : "opacity-60"}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Active owner (days)</div>
              <div className="text-xs text-slate-500">
                Owner must have updated the listing within this many days.
              </div>
            </div>
            <Toggle checked={draft.ownerEnabled} onChange={(v) => setDraft({ ...draft, ownerEnabled: v })} />
          </div>
          <input
            type="number"
            disabled={!draft.ownerEnabled}
            value={draft.activeOwnerDays}
            onChange={(e) =>
              setDraft({ ...draft, activeOwnerDays: Number(e.target.value) || 0 })
            }
            className="mt-2 h-10 w-40 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving || settingsLoading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 px-5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
            {saving ? "Saving" : saved ? "Saved" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={saving || settingsLoading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset defaults
          </button>
          <span className="text-xs text-slate-500">
            Defaults: reviews {DEFAULT_FILTERS.minReviews}–{DEFAULT_FILTERS.maxReviews}, rating{" "}
            {DEFAULT_FILTERS.minRating}–{DEFAULT_FILTERS.maxRating}, owner ≤{" "}
            {DEFAULT_FILTERS.activeOwnerDays}d
          </span>
        </div>
        {saveError ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{saveError}</span>
          </div>
        ) : null}
      </div>
      )}

      {tab === "filters" ? (
      <p className="mt-6 text-xs text-slate-500">
        Tip: <span className="font-medium">Hot / Warm / Mild / Cold</span> tier is based on the
        full lead score and is independent of these filters — it never hides a lead.
      </p>
      ) : null}
    </div>
  );
}

function Pair(props: {
  label: string;
  help: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  minValue: number;
  maxValue: number;
  step: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
}) {
  return (
    <div className={props.enabled ? "" : "opacity-60"}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{props.label}</div>
          <div className="text-xs text-slate-500">{props.help}</div>
        </div>
        <Toggle checked={props.enabled} onChange={props.onToggle} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Min</span>
          <input
            type="number"
            disabled={!props.enabled}
            step={props.step}
            value={props.minValue}
            onChange={(e) => props.onMin(Number(e.target.value) || 0)}
            className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Max</span>
          <input
            type="number"
            disabled={!props.enabled}
            step={props.step}
            value={props.maxValue}
            onChange={(e) => props.onMax(Number(e.target.value) || 0)}
            className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ---------- Analytics ----------

function BackfillAutomationCard() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = async (mode: "new" | "retry-failed" | "force-all") => {
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    try {
      const res = await triggerAutoEnrichBacklog({
        minScore: 0,
        concurrency: 2,
        includeFailed: mode === "retry-failed",
        onlyFailed: mode === "retry-failed",
        force: mode === "force-all",
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (res.total === 0) toast.info("No qualified leads need enrichment — all caught up.");
      else if (res.triggered === 0)
        toast.warning(
          `All ${res.total} skipped by the safety gate. Use "Retry failed" for errored leads or "Force all" to re-run completed leads.`,
        );
      else
        toast.success(
          `Fired ${res.triggered} of ${res.total} leads to Apify.${res.skipped ? ` Skipped ${res.skipped} (already processed or failed).` : ""}`,
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-6 rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-amber-200">
          <Zap className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">
            Run automation on existing qualified leads
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Fires website screenshot + AI analysis (and Brand DNA + Instagram for weaker sites)
            for every qualified lead that hasn't been auto-enriched yet. New leads trigger
            automatically after search or import.
          </p>
          {progress && running ? (
            <p className="mt-2 text-xs font-medium text-amber-700">
              Queuing… {progress.done}/{progress.total}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            Current state in DB: many leads have already been processed. "Retry failed" re-runs
            ones that errored last time (bad screenshots, missing IG, etc.). "Force all" re-runs
            every qualified lead from scratch.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => run("new")}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {running ? "Running…" : "Backfill new"}
          </button>
          <button
            type="button"
            onClick={() => run("retry-failed")}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-700 shadow-sm hover:bg-amber-50 disabled:opacity-50"
          >
            Retry failed
          </button>
          <button
            type="button"
            onClick={() => run("force-all")}
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Force all
          </button>
        </div>
      </div>
    </div>
  );
}

async function fetchAllLeadsLite(): Promise<Lead[]> {
  return fetchCompactLeads();
}

function AnalyticsPanel({ settings }: { settings: FilterSettings }) {
  useClickedSync();
  const { data: raw, isLoading, isError, error } = useQuery({
    queryKey: ["analytics-all-leads-compact-v4"],
    queryFn: fetchAllLeadsLite,
    retry: 1,
  });
  const { data: runs } = useQuery({
    queryKey: ["analytics-runs-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("search_runs")
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const stats = useMemo(() => {
    if (!raw) return null;
    const counts = new Map<string, number>();
    for (const l of raw) {
      const k = leadIdentityKey(l);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const { all: leads } = getLiveLeadSets(raw, settings);
    const total = leads.length;
    const rawTotal = raw.length;
    const duplicates = rawTotal - total;
    const dupGroups = [...counts.values()].filter((n) => n > 1).length;
    let qualified = 0;
    let revFail = 0;
    let ratFail = 0;
    let ownFail = 0;
    const tiers = { hot: 0, warm: 0, mild: 0, cold: 0 } as Record<string, number>;
    const cats = new Map<string, number>();
    const countries = new Map<string, number>();
    let withEmail = 0;
    let withWebsite = 0;
    let opened = 0;
    let ratingSum = 0;
    let ratingN = 0;
    let reviewsSum = 0;

    for (const l of leads) {
      const e = evaluateLead(l, settings);
      if (e.passed) qualified++;
      if (!e.passesReviews) revFail++;
      if (!e.passesRating) ratFail++;
      if (!e.activeOwner) ownFail++;
      const t = (l.leadTier || "").toLowerCase();
      if (t in tiers) tiers[t]++;
      const c = (l.categoryName || "Unknown").trim();
      cats.set(c, (cats.get(c) ?? 0) + 1);
      const cc = ((l as Record<string, unknown>).countryCode as string | undefined) || "—";
      countries.set(cc, (countries.get(cc) ?? 0) + 1);
      if ((l.emails ?? []).length) withEmail++;
      if (l.website) withWebsite++;
      if (isClicked(leadKey(l))) opened++;
      if (typeof l.totalScore === "number") {
        ratingSum += l.totalScore;
        ratingN++;
      }
      if (typeof l.reviewsCount === "number") reviewsSum += l.reviewsCount;
    }
    const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topCountries = [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      total,
      rawTotal,
      duplicates,
      dupGroups,
      qualified,
      filtered: total - qualified,
      revFail,
      ratFail,
      ownFail,
      tiers,
      topCats,
      topCountries,
      withEmail,
      withWebsite,
      opened,
      avgRating: ratingN ? ratingSum / ratingN : 0,
      avgReviews: total ? reviewsSum / total : 0,
    };
  }, [raw, settings]);

  if (isLoading) {
    return (
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white/70 p-10 text-center backdrop-blur">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
        <div className="mt-2 text-sm text-slate-500">Crunching analytics…</div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50/70 p-10 text-center text-rose-700 backdrop-blur">
        <div className="text-sm font-semibold">Could not load analytics.</div>
        <div className="mt-1 text-xs text-rose-600">
          {error instanceof Error ? error.message : "Please refresh and try again."}
        </div>
      </div>
    );
  }

  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 1000) / 10 : 0);

  return (
    <div className="mt-6 space-y-5">
      {/* Hero qualification card */}
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-600 to-fuchsia-600 p-6 text-white shadow-md">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/80">
          Qualification rate
        </div>
        <div className="mt-1 flex flex-wrap items-end gap-3">
          <div className="text-5xl font-bold">{pct(stats.qualified)}%</div>
          <div className="text-sm text-white/85">
            {stats.qualified} qualified out of {stats.total} leads
          </div>
        </div>
        <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full bg-white"
            style={{ width: `${pct(stats.qualified)}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/85">
          <span>✅ {stats.qualified} qualified</span>
          <span>🚫 {stats.filtered} filtered out</span>
          <span>📦 {runs ?? 0} total runs</span>
        </div>
      </div>

      {/* Per-filter rejection breakdown */}
      <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur">
        <h3 className="text-sm font-bold text-slate-900">Filtered-out by reason</h3>
        <p className="text-xs text-slate-500">
          A lead can be rejected by more than one filter — counts may overlap.
        </p>
        <div className="mt-4 space-y-3">
          <RejBar
            label="Reviews"
            sub={
              settings.reviewsEnabled
                ? `outside ${settings.minReviews}–${settings.maxReviews}`
                : "disabled"
            }
            count={stats.revFail}
            total={stats.total}
            color="bg-rose-500"
          />
          <RejBar
            label="Rating"
            sub={
              settings.ratingEnabled
                ? `outside ${settings.minRating}–${settings.maxRating}`
                : "disabled"
            }
            count={stats.ratFail}
            total={stats.total}
            color="bg-amber-500"
          />
          <RejBar
            label="Active owner"
            sub={
              settings.ownerEnabled ? `> ${settings.activeOwnerDays}d inactive` : "disabled"
            }
            count={stats.ownFail}
            total={stats.total}
            color="bg-sky-500"
          />
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Avg rating" value={stats.avgRating.toFixed(2)} sub="across all leads" />
        <Tile label="Avg reviews" value={Math.round(stats.avgReviews).toString()} sub="per lead" />
        <Tile
          label="With email"
          value={`${stats.withEmail}`}
          sub={`${pct(stats.withEmail)}% of leads`}
        />
        <Tile
          label="With website"
          value={`${stats.withWebsite}`}
          sub={`${pct(stats.withWebsite)}% of leads`}
        />
      </div>

      {/* Duplication */}
      <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur">
        <h3 className="text-sm font-bold text-slate-900">Duplication</h3>
        <p className="text-xs text-slate-500">
          Same business imported across multiple runs — deduped by place / name+address.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Tile
            label="Duplicate ratio"
            value={`${stats.rawTotal ? Math.round((stats.duplicates / stats.rawTotal) * 1000) / 10 : 0}%`}
            sub={`${stats.duplicates} of ${stats.rawTotal} rows`}
          />
          <Tile label="Raw rows" value={stats.rawTotal.toString()} sub="in database" />
          <Tile label="Unique leads" value={stats.total.toString()} sub="after dedupe" />
          <Tile
            label="Duplicated businesses"
            value={stats.dupGroups.toString()}
            sub="appear 2+ times"
          />
        </div>
      </div>

      {/* Tier breakdown */}
      <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur">
        <h3 className="text-sm font-bold text-slate-900">Tier distribution</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["hot", "warm", "mild", "cold"] as const).map((t) => {
            const color =
              t === "hot"
                ? "from-rose-500 to-orange-500"
                : t === "warm"
                  ? "from-amber-500 to-yellow-500"
                  : t === "mild"
                    ? "from-sky-500 to-cyan-500"
                    : "from-slate-500 to-slate-700";
            return (
              <div
                key={t}
                className={`rounded-2xl bg-gradient-to-br ${color} p-4 text-white shadow-sm`}
              >
                <div className="text-xs font-semibold uppercase tracking-wide opacity-90">
                  {t}
                </div>
                <div className="mt-1 text-2xl font-bold">{stats.tiers[t]}</div>
                <div className="text-[11px] opacity-90">{pct(stats.tiers[t])}% of all</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Engagement + top lists */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur">
          <h3 className="text-sm font-bold text-slate-900">Outreach progress</h3>
          <div className="mt-3 flex items-end gap-3">
            <div className="text-4xl font-bold text-emerald-600">{stats.opened}</div>
            <div className="pb-1 text-xs text-slate-500">
              opened in Lovable · {pct(stats.opened)}% of all leads
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${pct(stats.opened)}%` }}
            />
          </div>
        </div>
        <TopList title="Top categories" rows={stats.topCats} total={stats.total} />
      </div>

      <TopList title="Top countries" rows={stats.topCountries} total={stats.total} />
    </div>
  );
}

function RejBar({
  label,
  sub,
  count,
  total,
  color,
}: {
  label: string;
  sub: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total ? Math.round((count / total) * 1000) / 10 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <div>
          <span className="font-semibold text-slate-800">{label}</span>{" "}
          <span className="text-slate-400">· {sub}</span>
        </div>
        <div className="font-mono text-slate-600">
          {count} / {total} <span className="text-slate-400">({pct}%)</span>
        </div>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 backdrop-blur">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

function TopList({
  title,
  rows,
  total,
}: {
  title: string;
  rows: [string, number][];
  total: number;
}) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 backdrop-blur">
      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.map(([name, n]) => {
          const w = max ? (n / max) * 100 : 0;
          const pct = total ? Math.round((n / total) * 1000) / 10 : 0;
          return (
            <div key={name}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="truncate font-medium text-slate-700">{name}</span>
                <span className="font-mono text-slate-500">
                  {n} <span className="text-slate-400">({pct}%)</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                  style={{ width: `${w}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
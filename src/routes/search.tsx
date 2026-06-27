import { createFileRoute } from "@tanstack/react-router";
import { useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Sparkles,
  X,
  Flame,
  Filter,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LeadCard } from "@/components/lead-card";
import { saveSearchRun } from "@/lib/leads-db";
import { triggerAutoEnrichForRun } from "@/lib/auto-enrich";
import type { Lead } from "@/lib/lead-types";

const START_URL = "/api/public/leads/start";
const STATUS_URL = "/api/public/leads/status";
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search Leads — LeadForge" },
      {
        name: "description",
        content: "Search and score local business leads with custom filters.",
      },
    ],
  }),
  component: SearchPage,
});

const DEFAULT_KEYWORDS = [
  "Cosmetic Dentist in Frisco, Texas",
  "Med Spa in Naples, Florida",
];

function SearchPage() {
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [keywordInput, setKeywordInput] = useState("");
  const [countryCode, setCountryCode] = useState("us");
  const [maxPlaces, setMaxPlaces] = useState(10);
  const [minReviews, setMinReviews] = useState(20);
  const [maxReviews, setMaxReviews] = useState(150);
  const [minRating, setMinRating] = useState(4.2);
  const [maxRating, setMaxRating] = useState(4.8);
  const [activeOwnerDays, setActiveOwnerDays] = useState(60);

  const [result, setResult] = useState<{ leads: Lead[]; filteredOut: Lead[] } | null>(null);
  const [showFiltered, setShowFiltered] = useState(true);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        searchStringsArray: keywords,
        countryCode,
        maxCrawledPlacesPerSearch: Number(maxPlaces),
        reviewsMin: Number(minReviews),
        reviewsMax: Number(maxReviews),
        ratingMin: Number(minRating),
        ratingMax: Number(maxRating),
        activeOwnerDays: Number(activeOwnerDays),
      };

      const startRes = await fetch(START_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const startText = await startRes.text();
      if (!startRes.ok)
        throw new Error(`Start failed: ${startRes.status} — ${startText.slice(0, 200)}`);
      const { runId } = JSON.parse(startText) as { runId: string };
      if (!runId) throw new Error("No runId returned");

      const qs = new URLSearchParams({
        runId,
        reviewsMin: String(payload.reviewsMin),
        reviewsMax: String(payload.reviewsMax),
        ratingMin: String(payload.ratingMin),
        ratingMax: String(payload.ratingMax),
        activeOwnerDays: String(payload.activeOwnerDays),
      });
      const deadline = Date.now() + POLL_MAX_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const sRes = await fetch(`${STATUS_URL}?${qs.toString()}`);
        const sText = await sRes.text();
        if (!sRes.ok)
          throw new Error(`Status failed: ${sRes.status} — ${sText.slice(0, 200)}`);
        const sJson = JSON.parse(sText) as {
          status: string;
          leads?: Lead[];
          filteredOut?: Lead[];
          total?: number;
          error?: string;
        };
        if (sJson.status === "SUCCEEDED") {
          return {
            runId,
            leads: sJson.leads ?? [],
            filteredOut: sJson.filteredOut ?? [],
            total: sJson.total ?? 0,
          };
        }
        if (["FAILED", "ABORTED", "TIMED-OUT"].includes(sJson.status))
          throw new Error(sJson.error || `Apify run ${sJson.status}`);
      }
      throw new Error("Timed out waiting for Apify run to finish");
    },
    onSuccess: async (data, _vars, _ctx) => {
      setResult({ leads: data.leads, filteredOut: data.filteredOut });
      try {
        const runId = await saveSearchRun({
          apifyRunId: data.runId ?? null,
          source: "search",
          params: {
            keywords,
            countryCode,
            maxPlaces: Number(maxPlaces),
            minReviews: Number(minReviews),
            maxReviews: Number(maxReviews),
            minRating: Number(minRating),
            maxRating: Number(maxRating),
            activeOwnerDays: Number(activeOwnerDays),
          },
          leads: data.leads,
          filteredOut: data.filteredOut,
          total: data.total,
        });
        // Fire-and-forget background enrichment for every Hot lead.
        triggerAutoEnrichForRun(runId).then((r) => {
          if (r.triggered > 0) {
            toast.message(`Auto-enriching ${r.triggered} qualified lead${r.triggered === 1 ? "" : "s"} in background`);
          }
        }).catch(() => {});
      } catch (e) {
        toast.error(
          `Saved to view but DB save failed: ${e instanceof Error ? e.message : "unknown"}`,
        );
      }
      if (!data.leads.length && !data.filteredOut.length) {
        toast.warning("No leads returned. Try widening your filters.");
      } else {
        toast.success(
          `${data.leads.length} qualified · ${data.filteredOut.length} filtered out`,
        );
      }
    },
    onError: (err: Error) => toast.error(err.message || "Something went wrong"),
  });

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (!v) return;
    if (!keywords.includes(v)) setKeywords([...keywords, v]);
    setKeywordInput("");
  };

  const handleKeywordKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeyword();
    } else if (e.key === "Backspace" && !keywordInput && keywords.length) {
      setKeywords(keywords.slice(0, -1));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keywords.length) {
      toast.error("Add at least one search keyword.");
      return;
    }
    mutation.mutate();
  };

  const tierCounts = (result?.leads ?? []).reduce<{ hot: number; warm: number; mild: number }>(
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
    <div className="relative min-h-[calc(100vh-3rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-300/40 to-fuchsia-300/40 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-amber-200/40 to-rose-300/40 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-[11px] font-medium text-slate-600 backdrop-blur">
            <Sparkles className="h-3 w-3 text-indigo-500" />
            Powered by Apify
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Search Leads
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Configure your filters, then scrape & score in one go.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-indigo-100/40 backdrop-blur-xl sm:p-8"
        >
          <div className="space-y-6">
            <div>
              <Label className="text-slate-800">Search Keywords</Label>
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
                {keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                  >
                    {k}
                    <button
                      type="button"
                      onClick={() => setKeywords(keywords.filter((x) => x !== k))}
                      className="rounded-full p-0.5 hover:bg-indigo-100"
                      aria-label={`Remove ${k}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={handleKeywordKey}
                  onBlur={addKeyword}
                  placeholder={
                    keywords.length
                      ? "Add another (press Enter)"
                      : 'e.g. "Med Spa in Frisco, Texas"'
                  }
                  className="min-w-[180px] flex-1 bg-transparent px-2 py-1 text-sm outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Press Enter or comma to add. Backspace removes the last.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Country Code">
                <Input
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  maxLength={2}
                  className="uppercase"
                />
              </Field>
              <Field label="Max Places">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxPlaces}
                  onChange={(e) => setMaxPlaces(+e.target.value)}
                />
              </Field>
              <Field label="Min Reviews">
                <Input
                  type="number"
                  min={0}
                  value={minReviews}
                  onChange={(e) => setMinReviews(+e.target.value)}
                />
              </Field>
              <Field label="Max Reviews">
                <Input
                  type="number"
                  min={0}
                  value={maxReviews}
                  onChange={(e) => setMaxReviews(+e.target.value)}
                />
              </Field>
              <Field label="Min Rating">
                <Input
                  type="number"
                  step="0.1"
                  min={1}
                  max={5}
                  value={minRating}
                  onChange={(e) => setMinRating(+e.target.value)}
                />
              </Field>
              <Field label="Max Rating">
                <Input
                  type="number"
                  step="0.1"
                  min={1}
                  max={5}
                  value={maxRating}
                  onChange={(e) => setMaxRating(+e.target.value)}
                />
              </Field>
              <Field label="Active Owner (days)">
                <Input
                  type="number"
                  min={1}
                  value={activeOwnerDays}
                  onChange={(e) => setActiveOwnerDays(+e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                size="lg"
                disabled={mutation.isPending}
                className="group relative h-12 overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-8 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl hover:shadow-indigo-500/40 disabled:opacity-70"
              >
                <span className="relative flex items-center gap-2">
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Searching leads…
                    </>
                  ) : (
                    <>
                      <Search className="h-5 w-5" />
                      Search Leads
                    </>
                  )}
                </span>
              </Button>
            </div>
          </div>
        </form>

        <section className="mt-12">
          {mutation.isPending ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-64 animate-pulse rounded-2xl border border-white/60 bg-white/60 backdrop-blur"
                />
              ))}
            </div>
          ) : !result ? (
            <EmptyState />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-900">
                  {result.leads.length} qualified lead
                  {result.leads.length === 1 ? "" : "s"}
                </h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  {tierCounts.hot > 0 && <TierChip tier="Hot" count={tierCounts.hot} />}
                  {tierCounts.warm > 0 && <TierChip tier="Warm" count={tierCounts.warm} />}
                  {tierCounts.mild > 0 && <TierChip tier="Mild" count={tierCounts.mild} />}
                </div>
              </div>

              {result.leads.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-12 text-center backdrop-blur">
                  <p className="text-sm text-slate-500">
                    No leads passed your filters. Check the filtered-out list below to widen them.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {result.leads.map((lead, i) => (
                    <LeadCard key={i} lead={lead} />
                  ))}
                </div>
              )}

              {result.filteredOut.length > 0 && (
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
                          {result.filteredOut.length} filtered out
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
                      {result.filteredOut.map((lead, i) => (
                        <LeadCard key={i} lead={lead} muted />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-medium text-slate-700">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function TierChip({ tier, count }: { tier: string; count: number }) {
  const styles: Record<string, string> = {
    Hot: "bg-rose-100 text-rose-700 ring-rose-200",
    Warm: "bg-amber-100 text-amber-700 ring-amber-200",
    Mild: "bg-sky-100 text-sky-700 ring-sky-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-medium ring-1 ${styles[tier]}`}
    >
      {tier === "Hot" && <Flame className="h-3 w-3" />}
      {count} {tier}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white/40 px-8 py-16 text-center backdrop-blur">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg shadow-indigo-200">
        <Search className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">Ready when you are</h3>
      <p className="mt-1 text-sm text-slate-500">
        Fill in the form above and hit <strong>Search Leads</strong> to start.
      </p>
    </div>
  );
}

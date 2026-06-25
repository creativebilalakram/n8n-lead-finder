import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type KeyboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  MapPin,
  Star,
  Phone,
  Mail,
  Globe,
  Sparkles,
  Trash2,
  X,
  Flame,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// n8n removed — the whole workflow now runs inside this app.
// Start the Apify run, then poll status until it succeeds. The two
// server calls each return in seconds, so we never hit the Worker
// ~100s timeout no matter how long Apify takes.
const START_URL = "/api/public/leads/start";
const STATUS_URL = "/api/public/leads/status";
const STORAGE_KEY = "lead-gen-results-v1";
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000; // 15 min hard cap

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LeadForge — Premium Lead Generation" },
      {
        name: "description",
        content:
          "Search local business leads, score them automatically, and open the winners in Lovable with one click.",
      },
      { property: "og:title", content: "LeadForge — Premium Lead Generation" },
      {
        property: "og:description",
        content:
          "Search local business leads, score them automatically, and open the winners in Lovable with one click.",
      },
    ],
  }),
  component: Index,
});

type Lead = {
  title?: string;
  categoryName?: string;
  address?: string;
  phone?: string;
  phones?: string[];
  emails?: string[];
  website?: string;
  totalScore?: number;
  reviewsCount?: number;
  leadScore?: number;
  leadTier?: string;
  redFlags?: string[];
  lovableUrl?: string;
  [k: string]: unknown;
};

const DEFAULT_KEYWORDS = [
  "Cosmetic Dentist in Frisco, Texas",
  "Med Spa in Naples, Florida",
];

function Index() {
  const [keywords, setKeywords] = useState<string[]>(DEFAULT_KEYWORDS);
  const [keywordInput, setKeywordInput] = useState("");
  const [countryCode, setCountryCode] = useState("us");
  const [maxPlaces, setMaxPlaces] = useState(10);
  const [minReviews, setMinReviews] = useState(20);
  const [maxReviews, setMaxReviews] = useState(150);
  const [minRating, setMinRating] = useState(4.2);
  const [maxRating, setMaxRating] = useState(4.8);
  const [activeOwnerDays, setActiveOwnerDays] = useState(60);
  const [leads, setLeads] = useState<Lead[]>([]);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLeads(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (leads.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
    } catch {
      /* ignore */
    }
  }, [leads]);

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

      // 1) Start the Apify run
      const startRes = await fetch(START_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const startText = await startRes.text();
      if (!startRes.ok) {
        throw new Error(`Start failed: ${startRes.status} — ${startText.slice(0, 200)}`);
      }
      const { runId } = JSON.parse(startText) as { runId: string };
      if (!runId) throw new Error("No runId returned");

      // 2) Poll status until SUCCEEDED / FAILED / timeout
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
        if (!sRes.ok) {
          throw new Error(`Status failed: ${sRes.status} — ${sText.slice(0, 200)}`);
        }
        const sJson = JSON.parse(sText) as {
          status: string;
          leads?: Lead[];
          error?: string;
        };
        if (sJson.status === "SUCCEEDED") return sJson.leads ?? [];
        if (["FAILED", "ABORTED", "TIMED-OUT"].includes(sJson.status)) {
          throw new Error(sJson.error || `Apify run ${sJson.status}`);
        }
        // else RUNNING / READY — keep polling
      }
      throw new Error("Timed out waiting for Apify run to finish");
    },
    onSuccess: (data) => {
      setLeads(data);
      if (!data.length) toast.warning("No leads returned. Try widening your filters.");
      else toast.success(`Found ${data.length} lead${data.length === 1 ? "" : "s"}.`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Something went wrong");
    },
  });

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (!v) return;
    if (keywords.includes(v)) {
      setKeywordInput("");
      return;
    }
    setKeywords([...keywords, v]);
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

  const clearResults = () => {
    setLeads([]);
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Results cleared");
  };

  const tierCounts = leads.reduce<{ hot: number; warm: number; mild: number; other: number }>(
    (acc, l) => {
      const t = (l.leadTier || "").toLowerCase();
      if (t === "hot") acc.hot++;
      else if (t === "warm") acc.warm++;
      else if (t === "mild") acc.mild++;
      else acc.other++;
      return acc;
    },
    { hot: 0, warm: 0, mild: 0, other: 0 },
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-indigo-300/40 to-fuchsia-300/40 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-amber-200/40 to-rose-300/40 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(99,102,241,0.08),transparent_60%)]" />
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
        {/* Header */}
        <header className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-4 py-1.5 text-xs font-medium text-slate-600 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            Powered by Apify
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            LeadForge
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
            Find scored local-business leads, then open the best ones directly in Lovable.
          </p>
        </header>

        {/* Form card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl shadow-indigo-100/40 backdrop-blur-xl sm:p-8"
        >
          <div className="space-y-6">
            {/* Keywords */}
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

            {/* Numeric grid */}
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

            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              {leads.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearResults}
                  className="text-slate-600 hover:text-rose-600"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Clear results
                </Button>
              ) : (
                <span />
              )}
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

        {/* Results */}
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
          ) : leads.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold text-slate-900">
                  {leads.length} lead{leads.length === 1 ? "" : "s"} found
                </h2>
                <div className="flex flex-wrap gap-2 text-xs">
                  {tierCounts.hot > 0 && (
                    <TierChip tier="Hot" count={tierCounts.hot} />
                  )}
                  {tierCounts.warm > 0 && (
                    <TierChip tier="Warm" count={tierCounts.warm} />
                  )}
                  {tierCounts.mild > 0 && (
                    <TierChip tier="Mild" count={tierCounts.mild} />
                  )}
                </div>
              </div>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {leads.map((lead, i) => (
                  <LeadCard key={i} lead={lead} />
                ))}
              </div>
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
      <h3 className="mt-4 text-lg font-semibold text-slate-900">No leads yet</h3>
      <p className="mt-1 text-sm text-slate-500">
        Fill in the form above and hit <strong>Search Leads</strong> to start.
      </p>
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const tier = (lead.leadTier || "").toLowerCase();
  const tierBadge =
    tier === "hot"
      ? "bg-gradient-to-r from-rose-500 to-orange-500 text-white"
      : tier === "warm"
        ? "bg-gradient-to-r from-amber-400 to-orange-400 text-white"
        : tier === "mild"
          ? "bg-gradient-to-r from-sky-400 to-indigo-400 text-white"
          : "bg-slate-200 text-slate-700";

  const phone = lead.phone || lead.phones?.[0];
  const email = lead.emails?.[0];

  const openLovable = () => {
    if (!lead.lovableUrl) {
      toast.error("This lead has no Lovable URL.");
      return;
    }
    window.open(lead.lovableUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm shadow-slate-200/50 backdrop-blur-xl transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-200/40">
      {/* header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">
            {lead.title || "Untitled business"}
          </h3>
          {lead.categoryName && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{lead.categoryName}</p>
          )}
        </div>
        {lead.leadTier && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tierBadge}`}
          >
            {lead.leadTier}
            {typeof lead.leadScore === "number" ? ` · ${lead.leadScore}` : ""}
          </span>
        )}
      </div>

      {/* meta */}
      <div className="space-y-2 text-sm text-slate-600">
        {lead.address && (
          <Row icon={<MapPin className="h-4 w-4 text-slate-400" />}>{lead.address}</Row>
        )}
        {(typeof lead.totalScore === "number" || typeof lead.reviewsCount === "number") && (
          <Row icon={<Star className="h-4 w-4 fill-amber-400 text-amber-400" />}>
            <span className="font-medium text-slate-800">
              {lead.totalScore ?? "—"}
            </span>
            <span className="text-slate-500">
              {" "}
              · {lead.reviewsCount ?? 0} review{lead.reviewsCount === 1 ? "" : "s"}
            </span>
          </Row>
        )}
        {phone && (
          <Row icon={<Phone className="h-4 w-4 text-slate-400" />}>
            <a href={`tel:${phone}`} className="hover:text-indigo-600">
              {phone}
            </a>
          </Row>
        )}
        {email && (
          <Row icon={<Mail className="h-4 w-4 text-slate-400" />}>
            <a href={`mailto:${email}`} className="truncate hover:text-indigo-600">
              {email}
            </a>
          </Row>
        )}
        {lead.website && (
          <Row icon={<Globe className="h-4 w-4 text-slate-400" />}>
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate hover:text-indigo-600"
            >
              {lead.website.replace(/^https?:\/\//, "")}
            </a>
          </Row>
        )}
      </div>

      {/* red flags */}
      {lead.redFlags && lead.redFlags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lead.redFlags.slice(0, 4).map((f) => (
            <Badge
              key={f}
              variant="secondary"
              className="bg-rose-50 text-[10px] font-medium text-rose-600 hover:bg-rose-50"
            >
              {f.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-auto pt-5">
        <button
          type="button"
          onClick={openLovable}
          className="group/btn relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:shadow-lg hover:shadow-indigo-500/40"
        >
          <span className="relative flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4" />
            Open in Lovable
            <ExternalLink className="h-3.5 w-3.5 opacity-80 transition group-hover/btn:translate-x-0.5" />
          </span>
        </button>
      </div>
    </div>
  );
}

function Row({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

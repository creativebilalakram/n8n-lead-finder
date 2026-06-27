import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  MapPin,
  Star,
  Phone,
  Mail,
  Globe,
  Sparkles,
  ExternalLink,
  Camera,
  Loader2,
  Instagram,
  Palette,
  Check,
  AlertTriangle,
  Database,
  Image as ImageIcon,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  ensureOpenedLoaded,
  isClicked,
  markClicked,
  subscribeClicked,
  toggleClicked,
} from "@/lib/clicked-leads";
import { computeAdjustedScore } from "@/lib/score-adjust";

export const Route = createFileRoute("/leads/$id")({
  head: () => ({ meta: [{ title: "Lead detail — LeadForge" }] }),
  component: LeadDetailPage,
});

type LeadRow = Record<string, unknown> & { id: string };

async function fetchLead(id: string): Promise<LeadRow | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as LeadRow | null) ?? null;
}

function LeadDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { data: lead, isLoading, error, refetch } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => fetchLead(id),
  });

  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    void ensureOpenedLoaded();
    setClicked(isClicked(id));
    return subscribeClicked(() => setClicked(isClicked(id)));
  }, [id]);

  const [analyzing, setAnalyzing] = useState<null | "website" | "instagram" | "brand">(null);

  const websiteScore = (lead?.website_modern_score as number | null) ?? null;
  const brandScore = (lead?.brand_dna_score as number | null) ?? null;
  const igScore = (lead?.instagram_score as number | null) ?? null;

  const adjusted = useMemo(() => {
    const base = lead?.lead_score as number | undefined;
    if (websiteScore == null) return null;
    return computeAdjustedScore(base, websiteScore);
  }, [lead, websiteScore]);

  const tier = String(adjusted?.tier ?? lead?.lead_tier ?? "").toLowerCase();
  const tierBadge =
    tier === "hot"
      ? "bg-gradient-to-r from-rose-500 to-orange-500 text-white"
      : tier === "warm"
        ? "bg-gradient-to-r from-amber-400 to-orange-400 text-white"
        : tier === "mild"
          ? "bg-gradient-to-r from-sky-400 to-indigo-400 text-white"
          : "bg-slate-200 text-slate-700";

  const callAnalyze = async (kind: "website" | "instagram" | "brand", body: Record<string, unknown>) => {
    setAnalyzing(kind);
    try {
      const path =
        kind === "website"
          ? "/api/public/website/analyze"
          : kind === "instagram"
            ? "/api/public/instagram/analyze"
            : "/api/public/brand/analyze";
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: id, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success(`${kind} ${json.score}/10 · ${json.label}`);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(null);
    }
  };

  const openInLovable = async () => {
    void markClicked(id).catch(() => {});
    let url = (lead?.lovable_url as string | null) ?? null;
    if (!url && lead?.raw) {
      const prompt =
        "Create a premium, modern, and highly trustworthy website by using the same flow in your instructions for\n\n" +
        JSON.stringify(lead.raw, null, 2);
      url = "https://lovable.dev/?autosubmit=true#prompt=" + encodeURIComponent(prompt);
    }
    if (!url) {
      toast.error("No payload available");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    a.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        ctrlKey: !isMac,
        metaKey: isMac,
      }),
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error || !lead) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-rose-600">Lead not found.</p>
        <button
          onClick={() => router.history.back()}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
    );
  }

  const phones = (lead.phones as string[] | null) ?? (lead.phone ? [lead.phone as string] : []);
  const emails = (lead.emails as string[] | null) ?? (lead.email ? [lead.email as string] : []);
  const igHandle =
    (lead.instagram_username as string | null) ||
    (lead.instagram_url as string | null) ||
    extractIgFromRaw(lead.raw);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.history.back()}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <Link to="/leads" className="text-sm text-indigo-600 hover:underline">
          All leads
        </Link>
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-sm backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
              <Building2 className="h-3.5 w-3.5" />
              {(lead.category as string | null) || "Business"}
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              {(lead.title as string | null) || "Untitled"}
            </h1>
            {(lead.address as string | null) && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                <MapPin className="h-3.5 w-3.5 text-slate-400" /> {lead.address as string}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {tier && (
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${tierBadge}`}>
                {tier}
                {typeof (adjusted?.score ?? lead.lead_score) === "number" &&
                  ` · ${adjusted?.score ?? lead.lead_score}`}
                {adjusted && adjusted.bonus > 0 ? <span className="ml-1">(+{adjusted.bonus})</span> : null}
              </span>
            )}
            {clicked ? (
              <button
                onClick={() =>
                  void toggleClicked(id).then(() => toast.success("Marked as not opened"))
                }
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[11px] font-bold uppercase text-white"
              >
                <Check className="h-3 w-3" /> Opened
              </button>
            ) : null}
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
            label="Rating"
            value={lead.rating != null ? String(lead.rating) : "—"}
          />
          <Stat
            icon={<Star className="h-3.5 w-3.5 text-slate-400" />}
            label="Reviews"
            value={lead.reviews_count != null ? String(lead.reviews_count) : "—"}
          />
          <Stat
            icon={<Sparkles className="h-3.5 w-3.5 text-indigo-500" />}
            label="Lead score"
            value={lead.lead_score != null ? String(lead.lead_score) : "—"}
          />
          <Stat
            icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
            label="Owner updated"
            value={
              lead.owner_update_age_days != null
                ? `${lead.owner_update_age_days}d ago`
                : "—"
            }
          />
        </div>

        {/* Contact strip */}
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {phones.length > 0 && (
            <ContactBlock icon={<Phone className="h-4 w-4" />} label="Phone">
              {phones.map((p) => (
                <a key={p} href={`tel:${p}`} className="block truncate hover:text-indigo-600">
                  {p}
                </a>
              ))}
            </ContactBlock>
          )}
          {emails.length > 0 && (
            <ContactBlock icon={<Mail className="h-4 w-4" />} label="Email">
              {emails.map((e) => (
                <a key={e} href={`mailto:${e}`} className="block truncate hover:text-indigo-600">
                  {e}
                </a>
              ))}
            </ContactBlock>
          )}
          {(lead.website as string | null) && (
            <ContactBlock icon={<Globe className="h-4 w-4" />} label="Website">
              <a
                href={lead.website as string}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate hover:text-indigo-600"
              >
                {(lead.website as string).replace(/^https?:\/\//, "")}
              </a>
            </ContactBlock>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={openInLovable}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 hover:shadow-lg"
          >
            <Sparkles className="h-4 w-4" />
            Open in Lovable
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Actor panels */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Website modernity */}
        <ActorPanel
          icon={<Camera className="h-4 w-4 text-slate-700" />}
          title="Website Modernity"
          subtitle="apify/website-screenshot · Gemini"
          accent="slate"
        >
          {websiteScore != null ? (
            <ScoreBlock
              score={websiteScore}
              label={(lead.website_label as string | null) || ""}
              reason={(lead.website_analysis as string | null) || ""}
              colorByScore={(s) =>
                s < 6 ? "rose" : s < 8 ? "amber" : "emerald"
              }
            />
          ) : (
            <p className="text-xs text-slate-500">Not analyzed yet.</p>
          )}
          {(lead.website_screenshot_url as string | null) && (
            <a
              href={lead.website_screenshot_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-lg border border-slate-200"
            >
              <img
                src={lead.website_screenshot_url as string}
                alt="Website"
                className="h-32 w-full object-cover object-top"
              />
            </a>
          )}
          {(lead.website as string | null) && (
            <button
              onClick={() => callAnalyze("website", { url: lead.website })}
              disabled={analyzing === "website"}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {analyzing === "website" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
              {websiteScore != null ? "Re-analyze" : "Analyze website"}
            </button>
          )}
        </ActorPanel>

        {/* Brand DNA */}
        <ActorPanel
          icon={<Palette className="h-4 w-4 text-violet-700" />}
          title="Brand DNA"
          subtitle="solutionssmart/brand-dna · Gemini"
          accent="violet"
        >
          {brandScore != null ? (
            <ScoreBlock
              score={brandScore}
              label={(lead.brand_dna_label as string | null) || ""}
              reason={(lead.brand_dna_summary as string | null) || ""}
              colorByScore={(s) =>
                s <= 3 ? "rose" : s <= 5 ? "amber" : s <= 7 ? "sky" : "emerald"
              }
            />
          ) : (
            <p className="text-xs text-slate-500">Not analyzed yet.</p>
          )}
          {(lead.brand_dna_screenshot_url as string | null) && (
            <a
              href={lead.brand_dna_screenshot_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-lg border border-violet-200"
            >
              <img
                src={lead.brand_dna_screenshot_url as string}
                alt="Brand"
                className="h-32 w-full object-cover object-top"
              />
            </a>
          )}
          {(lead.website as string | null) && (
            <button
              onClick={() => callAnalyze("brand", { url: lead.website })}
              disabled={analyzing === "brand"}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50"
            >
              {analyzing === "brand" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Palette className="h-3 w-3" />}
              {brandScore != null ? "Re-analyze" : "Analyze brand"}
            </button>
          )}
        </ActorPanel>

        {/* Instagram */}
        <ActorPanel
          icon={<Instagram className="h-4 w-4 text-fuchsia-700" />}
          title="Instagram Presence"
          subtitle="apify/instagram-profile · Gemini"
          accent="fuchsia"
        >
          {igScore != null ? (
            <>
              <ScoreBlock
                score={igScore}
                label={(lead.instagram_label as string | null) || ""}
                reason={(lead.instagram_analysis as string | null) || ""}
                colorByScore={(s) =>
                  s <= 3 ? "rose" : s <= 5 ? "amber" : s <= 7 ? "sky" : "emerald"
                }
              />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                <MiniStat label="Followers" value={fmtNum(lead.instagram_followers)} />
                <MiniStat label="Posts" value={fmtNum(lead.instagram_posts_count)} />
                <MiniStat
                  label="Verified"
                  value={lead.instagram_verified ? "Yes" : "No"}
                />
              </div>
              {(lead.instagram_bio as string | null) && (
                <p className="mt-3 text-xs text-slate-600">
                  <span className="font-medium text-slate-700">Bio:</span>{" "}
                  {lead.instagram_bio as string}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">Not analyzed yet.</p>
          )}
          {igHandle && (
            <button
              onClick={() => callAnalyze("instagram", { url: igHandle })}
              disabled={analyzing === "instagram"}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-fuchsia-200 bg-fuchsia-50/50 px-3 py-1.5 text-xs font-medium text-fuchsia-700 hover:bg-fuchsia-50 disabled:opacity-50"
            >
              {analyzing === "instagram" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Instagram className="h-3 w-3" />}
              {igScore != null ? "Re-analyze" : "Analyze Instagram"}
            </button>
          )}
        </ActorPanel>
      </div>

      {/* Rejection reasons */}
      {Array.isArray(lead.rejection_reasons) && (lead.rejection_reasons as unknown[]).length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Why it was filtered
          </h3>
          <ul className="space-y-1 text-sm text-amber-900">
            {(lead.rejection_reasons as string[]).map((r) => (
              <li key={r}>• {r.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Raw payload */}
      <details className="rounded-2xl border border-slate-200 bg-white/70 p-5 backdrop-blur-xl">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          <Database className="mr-1.5 inline h-4 w-4 text-slate-500" />
          Raw Apify payload (Google Maps actor)
        </summary>
        <pre className="mt-3 max-h-[500px] overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify(lead.raw ?? null, null, 2)}
        </pre>
      </details>

      {lead.instagram_raw || lead.brand_dna_raw ? (
        <details className="rounded-2xl border border-slate-200 bg-white/70 p-5 backdrop-blur-xl">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            <ImageIcon className="mr-1.5 inline h-4 w-4 text-slate-500" />
            Other actor payloads
          </summary>
          {lead.instagram_raw ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fuchsia-700">Instagram</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                {JSON.stringify(lead.instagram_raw, null, 2)}
              </pre>
            </div>
          ) : null}
          {lead.brand_dna_raw ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-700">Brand DNA</p>
              <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">
                {JSON.stringify(lead.brand_dna_raw, null, 2)}
              </pre>
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function extractIgFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const igs = r.instagrams;
  if (Array.isArray(igs)) {
    const f = igs.find((x) => typeof x === "string" && /instagram\.com/i.test(x as string));
    if (typeof f === "string") return f;
  }
  if (typeof r.instagram === "string") return r.instagram;
  return null;
}

function fmtNum(v: unknown): string {
  if (typeof v !== "number") return "—";
  return v.toLocaleString();
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function ContactBlock({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className="space-y-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function ActorPanel({
  icon,
  title,
  subtitle,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  accent: "slate" | "violet" | "fuchsia";
  children: React.ReactNode;
}) {
  const border =
    accent === "violet"
      ? "border-violet-200"
      : accent === "fuchsia"
        ? "border-fuchsia-200"
        : "border-slate-200";
  return (
    <div className={`rounded-2xl border ${border} bg-white/80 p-5 backdrop-blur-xl`}>
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-[10px] uppercase tracking-wide text-slate-400">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ScoreBlock({
  score,
  label,
  reason,
  colorByScore,
}: {
  score: number;
  label: string;
  reason: string;
  colorByScore: (s: number) => "rose" | "amber" | "sky" | "emerald";
}) {
  const c = colorByScore(score);
  const cls =
    c === "rose"
      ? "bg-rose-100 text-rose-700"
      : c === "amber"
        ? "bg-amber-100 text-amber-700"
        : c === "sky"
          ? "bg-sky-100 text-sky-700"
          : "bg-emerald-100 text-emerald-700";
  return (
    <div>
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${cls}`}>
        {label || `Score`} · {score}/10
      </span>
      {reason && <p className="mt-2 text-xs leading-relaxed text-slate-600">{reason}</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/70 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
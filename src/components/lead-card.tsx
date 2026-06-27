import {
  MapPin,
  Star,
  Phone,
  Mail,
  Globe,
  Sparkles,
  ExternalLink,
  AlertTriangle,
  Check,
  Camera,
  Loader2,
  Instagram,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/lead-types";
import { useEffect, useState } from "react";
import { ensureOpenedLoaded, isClicked, leadKey, markClicked, subscribeClicked, toggleClicked } from "@/lib/clicked-leads";
import { supabase } from "@/integrations/supabase/client";
import { computeAdjustedScore } from "@/lib/score-adjust";

export function LeadCard({ lead, muted = false }: { lead: Lead; muted?: boolean }) {
  const key = leadKey(lead);
  // Hydrate from localStorage after mount to avoid SSR/hydration mismatch
  // which would otherwise wipe the clicked state on every refresh.
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    void ensureOpenedLoaded();
    setClicked(isClicked(key));
    return subscribeClicked(() => setClicked(isClicked(key)));
  }, [key]);

  // Website modernity analysis (AI-scored from a live screenshot)
  type WebsiteAnalysis = { score: number; label: string; reason?: string; screenshotUrl?: string };
  const [analysis, setAnalysis] = useState<WebsiteAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Instagram presence analysis
  type IgAnalysis = {
    score: number;
    label: string;
    reason?: string;
    username?: string;
    url?: string;
    followers?: number;
    postsCount?: number;
    verified?: boolean;
  };
  const [ig, setIg] = useState<IgAnalysis | null>(null);
  const [igLoading, setIgLoading] = useState(false);
  const [igHandle, setIgHandle] = useState<string | null>(null);
  const [igInput, setIgInput] = useState("");
  const leadIdForAnalysis = typeof lead.id === "string" ? lead.id : undefined;
  useEffect(() => {
    if (!leadIdForAnalysis) return;
    let cancelled = false;
    void supabase
      .from("leads")
      .select(
        "website_modern_score, website_label, website_analysis, website_screenshot_url, instagram_score, instagram_label, instagram_analysis, instagram_username, instagram_url, instagram_followers, instagram_posts_count, instagram_verified, raw",
      )
      .eq("id", leadIdForAnalysis)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        if (data.website_modern_score != null) {
          setAnalysis({
            score: data.website_modern_score,
            label: data.website_label || "",
            reason: data.website_analysis ?? undefined,
            screenshotUrl: data.website_screenshot_url ?? undefined,
          });
        }
        if (data.instagram_score != null) {
          setIg({
            score: data.instagram_score,
            label: data.instagram_label || "",
            reason: data.instagram_analysis ?? undefined,
            username: data.instagram_username ?? undefined,
            url: data.instagram_url ?? undefined,
            followers: data.instagram_followers ?? undefined,
            postsCount: data.instagram_posts_count ?? undefined,
            verified: data.instagram_verified ?? undefined,
          });
        }
        // Try to auto-detect an instagram handle from the raw Apify payload.
        const rawObj = (data.raw ?? null) as Record<string, unknown> | null;
        if (rawObj) {
          const candidates: unknown[] = [];
          const igs = rawObj.instagrams;
          if (Array.isArray(igs)) candidates.push(...igs);
          if (typeof rawObj.instagram === "string") candidates.push(rawObj.instagram);
          const profiles = rawObj.profiles as Record<string, unknown> | undefined;
          if (profiles && typeof profiles.instagram === "string") candidates.push(profiles.instagram);
          const found = candidates.find((c) => typeof c === "string" && /instagram\.com/i.test(c as string));
          if (typeof found === "string") setIgHandle(found);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leadIdForAnalysis]);

  const analyzeWebsite = async () => {
    if (!leadIdForAnalysis || !lead.website || analyzing) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/public/website/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadIdForAnalysis, url: lead.website }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setAnalysis({ score: json.score, label: json.label, reason: json.reason, screenshotUrl: json.screenshotUrl });
      toast.success(`Scored ${json.score}/10 · ${json.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const analyzeInstagram = async (handleOverride?: string) => {
    if (!leadIdForAnalysis || igLoading) return;
    const handle = (handleOverride ?? igHandle ?? igInput).trim();
    if (!handle) {
      toast.error("Enter an Instagram username or URL");
      return;
    }
    setIgLoading(true);
    try {
      const res = await fetch("/api/public/instagram/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadIdForAnalysis, url: handle }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setIg({
        score: json.score,
        label: json.label,
        reason: json.reason,
        username: json.profile?.username,
        url: json.profile?.url,
        followers: json.profile?.followers,
        postsCount: json.profile?.postsCount,
        verified: json.profile?.verified,
      });
      toast.success(`Instagram ${json.score}/10 · ${json.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Instagram analysis failed");
    } finally {
      setIgLoading(false);
    }
  };

  const baseScore = typeof lead.leadScore === "number" ? lead.leadScore : undefined;
  const adjusted = analysis
    ? computeAdjustedScore(baseScore, analysis.score)
    : null;
  const displayScore = adjusted ? adjusted.score : baseScore;
  const displayTier = adjusted ? adjusted.tier : lead.leadTier;
  const tier = (displayTier || "").toLowerCase();
  const tierBadge =
    tier === "hot"
      ? "bg-gradient-to-r from-rose-500 to-orange-500 text-white"
      : tier === "warm"
        ? "bg-gradient-to-r from-amber-400 to-orange-400 text-white"
        : tier === "mild"
          ? "bg-gradient-to-r from-sky-400 to-indigo-400 text-white"
          : "bg-slate-200 text-slate-700";

  const phone = lead.phone || lead.phones?.[0];
  const email = lead.emails?.[0] || (typeof lead.email === "string" ? lead.email : undefined);

  const buildPromptUrl = (payload: unknown) => {
    const prompt =
      "Create a premium, modern, and highly trustworthy website by using the same flow in your instructions for\n\n" +
      JSON.stringify(payload, null, 2);
    return "https://lovable.dev/?autosubmit=true#prompt=" + encodeURIComponent(prompt);
  };

  const openLovable = async () => {
    void markClicked(key).catch(() => {
      toast.error("Couldn't save opened status");
    });
    let url = lead.lovableUrl;
    const leadId = typeof lead.id === "string" ? lead.id : undefined;
    try {
      if (!url && leadId) {
        const { data, error } = await supabase
          .from("leads")
          .select("raw, lovable_url")
          .eq("id", leadId)
          .maybeSingle();
        if (!error && data) {
          if (data.lovable_url) url = data.lovable_url;
          else if (data.raw) url = buildPromptUrl(data.raw);
        }
      }
    } catch {
      // ignore — fall through to compact fallback
    }
    if (!url) {
      // Legacy rows without `raw`. Build from every field we have on the lead.
      const fallback: Record<string, unknown> = { ...lead };
      delete (fallback as Record<string, unknown>).lovableUrl;
      url = buildPromptUrl(fallback);
      toast.message("Using compact payload", {
        description: "Re-import this Apify run to include the full original business data.",
      });
    }
    // Open in a background tab (like Ctrl/Cmd+Click) so the user stays in this app.
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
    a.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        ctrlKey: !isMac,
        metaKey: isMac,
      }),
    );
    a.remove();
  };

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border p-5 backdrop-blur-xl transition hover:-translate-y-0.5 ${
        clicked
          ? "border-emerald-300 bg-emerald-50/70 shadow-sm shadow-emerald-200/40 hover:shadow-md"
          : muted
            ? "border-slate-200/80 bg-white/50 shadow-sm hover:shadow-md"
            : "border-white/70 bg-white/80 shadow-sm shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-200/40"
      }`}
    >
      {clicked && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleClicked(key)
              .then(() => toast.success("Marked as not opened"))
              .catch(() => toast.error("Couldn't update opened status"));
          }}
          title="Click to unmark"
          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow"
        >
          <Check className="h-3 w-3" />
          Opened
        </button>
      )}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">
            {lead.title || "Untitled business"}
          </h3>
          {lead.categoryName && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{lead.categoryName}</p>
          )}
        </div>
        {displayTier && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tierBadge}`}
          >
            {displayTier}
            {typeof displayScore === "number" ? ` · ${displayScore}` : ""}
            {adjusted && adjusted.bonus > 0 ? (
              <span className="ml-1 opacity-90">(+{adjusted.bonus})</span>
            ) : null}
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm text-slate-600">
        {lead.address && (
          <Row icon={<MapPin className="h-4 w-4 text-slate-400" />}>{lead.address}</Row>
        )}
        {(typeof lead.totalScore === "number" || typeof lead.reviewsCount === "number") && (
          <Row icon={<Star className="h-4 w-4 fill-amber-400 text-amber-400" />}>
            <span className="font-medium text-slate-800">{lead.totalScore ?? "—"}</span>
            <span className="text-slate-500">
              {" "}· {lead.reviewsCount ?? 0} review{lead.reviewsCount === 1 ? "" : "s"}
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

      {lead.website && (
        <div className="mt-3">
          {analysis ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white/60 px-3 py-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  analysis.score < 6
                    ? "bg-rose-100 text-rose-700"
                    : analysis.score < 8
                      ? "bg-amber-100 text-amber-700"
                      : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {analysis.label || (analysis.score < 6 ? "OUTDATED" : "MODERN")} · {analysis.score}/10
              </span>
              {analysis.reason && (
                <span className="truncate text-[11px] text-slate-500" title={analysis.reason}>
                  {analysis.reason}
                </span>
              )}
              <button
                type="button"
                onClick={analyzeWebsite}
                disabled={analyzing}
                className="ml-auto text-[10px] font-medium text-indigo-600 hover:underline disabled:opacity-50"
              >
                {analyzing ? "…" : "Re-analyze"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={analyzeWebsite}
              disabled={analyzing || !leadIdForAnalysis}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
              {analyzing ? "Analyzing website…" : "Analyze website (AI)"}
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        {ig ? (
          <div className="flex items-center gap-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2">
            <Instagram className="h-3.5 w-3.5 text-fuchsia-600" />
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                ig.score <= 3
                  ? "bg-rose-100 text-rose-700"
                  : ig.score <= 5
                    ? "bg-amber-100 text-amber-700"
                    : ig.score <= 7
                      ? "bg-sky-100 text-sky-700"
                      : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {ig.label} · {ig.score}/10
            </span>
            <span className="truncate text-[11px] text-slate-600" title={ig.reason}>
              {ig.username ? `@${ig.username}` : ""}
              {typeof ig.followers === "number" ? ` · ${ig.followers.toLocaleString()} followers` : ""}
              {typeof ig.postsCount === "number" ? ` · ${ig.postsCount} posts` : ""}
              {ig.verified ? " · ✓" : ""}
            </span>
            <button
              type="button"
              onClick={() => analyzeInstagram(ig.url || ig.username)}
              disabled={igLoading}
              className="ml-auto text-[10px] font-medium text-fuchsia-600 hover:underline disabled:opacity-50"
            >
              {igLoading ? "…" : "Re-analyze"}
            </button>
          </div>
        ) : igHandle ? (
          <button
            type="button"
            onClick={() => analyzeInstagram()}
            disabled={igLoading || !leadIdForAnalysis}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 px-3 py-1.5 text-xs font-medium text-fuchsia-700 transition hover:bg-fuchsia-50 disabled:opacity-50"
          >
            {igLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Instagram className="h-3 w-3" />}
            {igLoading ? "Analyzing Instagram…" : "Analyze Instagram (AI)"}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={igInput}
              onChange={(e) => setIgInput(e.target.value)}
              placeholder="@handle or instagram.com/…"
              className="flex-1 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-fuchsia-300 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => analyzeInstagram()}
              disabled={igLoading || !leadIdForAnalysis || !igInput.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-2.5 py-1.5 text-xs font-medium text-fuchsia-700 transition hover:bg-fuchsia-100 disabled:opacity-50"
            >
              {igLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Instagram className="h-3 w-3" />}
              IG
            </button>
          </div>
        )}
      </div>

      {muted && lead.rejectionReasons && lead.rejectionReasons.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            Why it was filtered
          </div>
          <ul className="space-y-0.5 text-xs text-amber-800">
            {lead.rejectionReasons.map((r) => (
              <li key={r}>• {r.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </div>
      )}

      {!muted && lead.redFlags && lead.redFlags.length > 0 && (
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
          className={`group/btn relative w-full overflow-hidden rounded-xl px-4 py-3 text-sm font-semibold text-white transition ${
            clicked
              ? "bg-gradient-to-r from-emerald-600 to-teal-600 shadow-md shadow-emerald-500/30 hover:shadow-lg"
              : muted
                ? "bg-slate-700 hover:bg-slate-800"
                : "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40"
          }`}
        >
          <span className="relative flex items-center justify-center gap-2">
            {clicked ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {clicked ? "Opened — open again" : "Open in Lovable"}
            <ExternalLink className="h-3.5 w-3.5 opacity-80 transition group-hover/btn:translate-x-0.5" />
          </span>
        </button>
      </div>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}
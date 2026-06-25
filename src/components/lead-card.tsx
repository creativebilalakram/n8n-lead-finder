import {
  MapPin,
  Star,
  Phone,
  Mail,
  Globe,
  Sparkles,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/lead-types";

export function LeadCard({ lead, muted = false }: { lead: Lead; muted?: boolean }) {
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
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border p-5 backdrop-blur-xl transition hover:-translate-y-0.5 ${
        muted
          ? "border-slate-200/80 bg-white/50 shadow-sm hover:shadow-md"
          : "border-white/70 bg-white/80 shadow-sm shadow-slate-200/50 hover:shadow-xl hover:shadow-indigo-200/40"
      }`}
    >
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
            muted
              ? "bg-slate-700 hover:bg-slate-800"
              : "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 shadow-md shadow-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/40"
          }`}
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

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}
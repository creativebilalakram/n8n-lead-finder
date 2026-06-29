import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Linkedin,
  Instagram,
  MessageCircle,
  Facebook,
  Twitter,
  Wand2,
  Loader2,
  X,
  Send,
  Check,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteDraft,
  listAllDrafts,
  setStatus,
  updateDraft,
  type OutreachDraft,
  type OutreachStatus,
} from "@/lib/outreach-db";

export const Route = createFileRoute("/outreach")({
  head: () => ({ meta: [{ title: "Outreach Pipeline — LeadForge" }] }),
  component: OutreachKanban,
});

const channelIcon: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  linkedin_dm: <Linkedin className="h-3.5 w-3.5" />,
  instagram_dm: <Instagram className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
  facebook_dm: <Facebook className="h-3.5 w-3.5" />,
  twitter_dm: <Twitter className="h-3.5 w-3.5" />,
};

type LeadMeta = { id: string; title: string | null; city: string | null };

async function fetchLeadMeta(ids: string[]): Promise<Record<string, LeadMeta>> {
  if (!ids.length) return {};
  const { data } = await supabase
    .from("leads")
    .select("id, title, city")
    .in("id", ids);
  const out: Record<string, LeadMeta> = {};
  for (const r of (data ?? []) as LeadMeta[]) out[r.id] = r;
  return out;
}

const COLUMNS: { key: OutreachStatus | "scheduled_view"; label: string; tint: string }[] = [
  { key: "draft", label: "Draft", tint: "bg-amber-50 border-amber-200" },
  { key: "approved", label: "Approved", tint: "bg-emerald-50 border-emerald-200" },
  { key: "scheduled_view", label: "Scheduled", tint: "bg-sky-50 border-sky-200" },
  { key: "sent", label: "Sent", tint: "bg-indigo-50 border-indigo-200" },
  { key: "replied", label: "Replied", tint: "bg-fuchsia-50 border-fuchsia-200" },
];

function OutreachKanban() {
  const qc = useQueryClient();
  const draftsQuery = useQuery({ queryKey: ["all-drafts"], queryFn: listAllDrafts });
  const leadIds = useMemo(
    () => Array.from(new Set((draftsQuery.data ?? []).map((d) => d.lead_id))),
    [draftsQuery.data],
  );
  const leadsQuery = useQuery({
    queryKey: ["leads-meta", leadIds.sort().join(",")],
    queryFn: () => fetchLeadMeta(leadIds),
    enabled: leadIds.length > 0,
  });

  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [stepFilter, setStepFilter] = useState<string>("");
  const [active, setActive] = useState<OutreachDraft | null>(null);

  const drafts = draftsQuery.data ?? [];
  const leadMap = leadsQuery.data ?? {};

  const filtered = drafts.filter((d) => {
    if (channelFilter && d.channel !== channelFilter) return false;
    if (stepFilter !== "" && String(d.sequence_step) !== stepFilter) return false;
    if (search) {
      const lead = leadMap[d.lead_id];
      const hay = `${lead?.title ?? ""} ${d.recipient_handle ?? ""} ${d.message_body}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const grouped: Record<string, OutreachDraft[]> = {
    draft: [], approved: [], scheduled_view: [], sent: [], replied: [],
  };
  const now = Date.now();
  for (const d of filtered) {
    const scheduled = d.scheduled_for ? new Date(d.scheduled_for).getTime() : null;
    if (scheduled && scheduled > now && (d.status === "draft" || d.status === "approved")) {
      grouped.scheduled_view.push(d);
    } else if (d.status === "draft") grouped.draft.push(d);
    else if (d.status === "approved") grouped.approved.push(d);
    else if (d.status === "sent") grouped.sent.push(d);
    else if (d.status === "replied") grouped.replied.push(d);
  }

  const moveTo = async (d: OutreachDraft, status: OutreachStatus) => {
    try {
      await setStatus(d.id, status);
      await qc.invalidateQueries({ queryKey: ["all-drafts"] });
      toast.success(`Moved to ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Move failed");
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Wand2 className="h-5 w-5 text-fuchsia-600" /> Outreach Pipeline
          </h1>
          <p className="text-xs text-slate-500">Drafts → Approved → Scheduled → Sent → Replied</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lead, recipient, message…"
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All channels</option>
            {Object.keys(channelIcon).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={stepFilter}
            onChange={(e) => setStepFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All steps</option>
            {[0, 1, 2, 3, 4].map((s) => (
              <option key={s} value={s}>Step {s}{s === 0 ? " (initial)" : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {draftsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : drafts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-8 text-center text-sm text-slate-500">
          No drafts yet. Open any lead and click "Generate all drafts for this lead".
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.key} className={`rounded-2xl border ${col.tint} p-3`}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">{col.label}</h3>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {grouped[col.key]?.length ?? 0}
                </span>
              </div>
              <div className="space-y-2">
                {(grouped[col.key] ?? []).map((d) => (
                  <KanbanCard
                    key={d.id}
                    draft={d}
                    leadMeta={leadMap[d.lead_id]}
                    onMove={moveTo}
                    onOpen={() => setActive(d)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <DraftModal
          draft={active}
          leadMeta={leadMap[active.lead_id]}
          onClose={() => setActive(null)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ["all-drafts"] });
          }}
        />
      )}
    </div>
  );
}

function KanbanCard({
  draft,
  leadMeta,
  onMove,
  onOpen,
}: {
  draft: OutreachDraft;
  leadMeta?: LeadMeta;
  onMove: (d: OutreachDraft, status: OutreachStatus) => Promise<void>;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-xl border border-white bg-white p-3 shadow-sm">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-slate-600">
            {channelIcon[draft.channel] ?? <Mail className="h-3 w-3" />}
          </span>
          <span className="truncate">{leadMeta?.title ?? "—"}</span>
        </div>
        <p className="line-clamp-2 text-xs text-slate-600">
          {draft.message_body?.slice(0, 100) || <em className="text-slate-400">empty draft</em>}
        </p>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
          <span className="truncate">{draft.recipient_handle ?? "—"}</span>
          {draft.scheduled_for && (
            <span className="text-sky-600">⏱ {new Date(draft.scheduled_for).toLocaleDateString()}</span>
          )}
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          Step {draft.sequence_step}
        </div>
      </button>
      <div className="mt-2 flex flex-wrap gap-1">
        <select
          value={draft.status}
          onChange={(e) => onMove(draft, e.target.value as OutreachStatus)}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
        >
          {(["draft", "approved", "sent", "replied", "skipped"] as OutreachStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function DraftModal({
  draft,
  leadMeta,
  onClose,
  onSaved,
}: {
  draft: OutreachDraft;
  leadMeta?: LeadMeta;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.message_body);
  const [busy, setBusy] = useState<null | "save" | "sent" | "replied" | "delete">(null);

  const save = async () => {
    setBusy("save");
    try {
      await updateDraft(draft.id, {
        subject: draft.channel === "email" ? subject || null : null,
        message_body: body,
      });
      await onSaved();
      toast.success("Saved");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {leadMeta?.title ?? "Lead"} · {draft.channel}
            </h3>
            <p className="text-xs text-slate-500">
              Step {draft.sequence_step} · {draft.recipient_type} · {draft.recipient_handle ?? "—"}
              {leadMeta?.id && (
                <>
                  {" · "}
                  <Link to="/leads/$id" params={{ id: leadMeta.id }} className="text-indigo-600 hover:underline">
                    open lead
                  </Link>
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        {draft.channel === "email" && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={save}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
          <button
            onClick={async () => { setBusy("sent"); await setStatus(draft.id, "sent"); await onSaved(); setBusy(null); onClose(); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
          >
            <Send className="h-3.5 w-3.5" /> Mark sent
          </button>
          <button
            onClick={async () => { setBusy("replied"); await setStatus(draft.id, "replied"); await onSaved(); setBusy(null); onClose(); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-3 py-1.5 text-sm font-semibold text-fuchsia-700 hover:bg-fuchsia-100"
          >
            Mark replied
          </button>
          <button
            onClick={async () => {
              if (!confirm("Delete draft?")) return;
              setBusy("delete"); await deleteDraft(draft.id); await onSaved(); setBusy(null); onClose();
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

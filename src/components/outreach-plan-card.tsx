import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Linkedin,
  Instagram,
  MessageCircle,
  Facebook,
  Twitter,
  Loader2,
  Sparkles,
  Wand2,
  Check,
  X,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  approveAndScheduleFollowups,
  deleteDraft,
  generateDraft,
  listDraftsForLead,
  setStatus,
  updateDraft,
  type OutreachDraft,
} from "@/lib/outreach-db";
import {
  getBusinessChannels,
  getDmContactsForLead,
  type BusinessChannels,
  type DmContact,
} from "@/lib/contact-hub-db";

type Channel =
  | "email"
  | "linkedin_dm"
  | "instagram_dm"
  | "whatsapp"
  | "facebook_dm"
  | "twitter_dm";

const channelIcon: Record<Channel, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  linkedin_dm: <Linkedin className="h-3.5 w-3.5" />,
  instagram_dm: <Instagram className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
  facebook_dm: <Facebook className="h-3.5 w-3.5" />,
  twitter_dm: <Twitter className="h-3.5 w-3.5" />,
};

const channelLabel: Record<Channel, string> = {
  email: "Email",
  linkedin_dm: "LinkedIn DM",
  instagram_dm: "Instagram DM",
  whatsapp: "WhatsApp",
  facebook_dm: "Facebook DM",
  twitter_dm: "Twitter DM",
};

type Recipient = {
  key: string;
  dmContactId: string | null; // null = business generic
  recipientType: "decision_maker" | "business_generic";
  recipientName: string;
  recipientRole: string;
  channel: Channel;
  handle: string;
};

function dmRecipients(dm: DmContact): Recipient[] {
  const out: Recipient[] = [];
  const name = dm.full_name || [dm.first_name, dm.last_name].filter(Boolean).join(" ") || "Decision maker";
  const role = dm.role || "—";
  const push = (channel: Channel, handle: string | null) => {
    if (!handle) return;
    out.push({
      key: `dm:${dm.id}:${channel}`,
      dmContactId: dm.id,
      recipientType: "decision_maker",
      recipientName: name,
      recipientRole: role,
      channel,
      handle,
    });
  };
  push("email", dm.work_email || dm.personal_email);
  push("linkedin_dm", dm.linkedin_url);
  push("instagram_dm", dm.instagram_handle);
  push("whatsapp", dm.whatsapp);
  push("facebook_dm", dm.facebook_url);
  push("twitter_dm", dm.twitter_handle);
  return out;
}

function businessRecipients(bc: BusinessChannels | null): Recipient[] {
  if (!bc) return [];
  const out: Recipient[] = [];
  for (const email of bc.generic_emails || []) {
    if (!email) continue;
    out.push({
      key: `biz:email:${email}`,
      dmContactId: null,
      recipientType: "business_generic",
      recipientName: "Business inbox",
      recipientRole: "Generic",
      channel: "email",
      handle: email,
    });
  }
  if (bc.instagram_url) {
    out.push({
      key: "biz:ig",
      dmContactId: null,
      recipientType: "business_generic",
      recipientName: "Business Instagram",
      recipientRole: "DM",
      channel: "instagram_dm",
      handle: bc.instagram_url,
    });
  }
  if (bc.facebook_url) {
    out.push({
      key: "biz:fb",
      dmContactId: null,
      recipientType: "business_generic",
      recipientName: "Business Facebook",
      recipientRole: "DM",
      channel: "facebook_dm",
      handle: bc.facebook_url,
    });
  }
  if (bc.whatsapp_business) {
    out.push({
      key: "biz:wa",
      dmContactId: null,
      recipientType: "business_generic",
      recipientName: "Business WhatsApp",
      recipientRole: "DM",
      channel: "whatsapp",
      handle: bc.whatsapp_business,
    });
  }
  return out;
}

export function OutreachPlanCard({ leadId }: { leadId: string }) {
  const qc = useQueryClient();

  const dmQuery = useQuery({
    queryKey: ["outreach-dms", leadId],
    queryFn: () => getDmContactsForLead(leadId),
  });
  const bcQuery = useQuery({
    queryKey: ["outreach-bc", leadId],
    queryFn: () => getBusinessChannels(leadId),
  });
  const draftsQuery = useQuery({
    queryKey: ["outreach-drafts", leadId],
    queryFn: () => listDraftsForLead(leadId),
  });

  const recipients = useMemo<Recipient[]>(() => {
    const dmList = dmQuery.data ?? [];
    return [
      ...dmList.flatMap(dmRecipients),
      ...businessRecipients(bcQuery.data ?? null),
    ];
  }, [dmQuery.data, bcQuery.data]);

  const initialDraftByKey = useMemo(() => {
    const map = new Map<string, OutreachDraft>();
    for (const d of draftsQuery.data ?? []) {
      if (d.sequence_step !== 0) continue;
      const key = d.dm_contact_id
        ? `dm:${d.dm_contact_id}:${d.channel}`
        : `biz:${d.channel === "email" ? `email:${d.recipient_handle}` : d.channel === "instagram_dm" ? "ig" : d.channel === "facebook_dm" ? "fb" : "wa"}`;
      map.set(key, d);
    }
    return map;
  }, [draftsQuery.data]);

  const [bulkRunning, setBulkRunning] = useState(false);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["outreach-drafts", leadId] }),
    ]);
  };

  const generateOne = async (r: Recipient, model: "gemini" | "claude" = "gemini") => {
    await generateDraft({
      leadId,
      dmContactId: r.dmContactId,
      channel: r.channel,
      recipientType: r.recipientType,
      recipientHandle: r.handle,
      sequenceStep: 0,
      model,
    });
    await refreshAll();
  };

  const runBulk = async () => {
    if (!recipients.length) {
      toast.info("No recipients yet — add DM contacts or business channels first.");
      return;
    }
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const r of recipients) {
      try {
        await generateOne(r);
        ok++;
      } catch (e) {
        fail++;
        console.error("generate failed", r, e);
      }
    }
    setBulkRunning(false);
    toast.success(`Generated ${ok} draft(s)${fail ? ` · ${fail} failed` : ""}`);
  };

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm backdrop-blur-xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-fuchsia-600" />
          <h2 className="text-sm font-semibold text-slate-900">Outreach Plan</h2>
          <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold uppercase text-fuchsia-700">
            AI Drafter
          </span>
        </div>
        <button
          onClick={runBulk}
          disabled={bulkRunning || recipients.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:shadow-md disabled:opacity-50"
        >
          {bulkRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Generate all drafts for this lead
        </button>
      </div>

      {dmQuery.isLoading || bcQuery.isLoading || draftsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading recipients…
        </div>
      ) : recipients.length === 0 ? (
        <p className="text-xs text-slate-500">
          No recipients yet. Add a decision maker contact (above) or fill in business channels.
        </p>
      ) : (
        <ul className="space-y-3">
          {recipients.map((r) => (
            <DraftRow
              key={r.key}
              leadId={leadId}
              recipient={r}
              draft={initialDraftByKey.get(r.key) ?? null}
              onChanged={refreshAll}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftRow({
  leadId,
  recipient,
  draft,
  onChanged,
}: {
  leadId: string;
  recipient: Recipient;
  draft: OutreachDraft | null;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<null | "gemini" | "claude" | "approve" | "save" | "skip">(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.message_body ?? "");

  useEffect(() => {
    setSubject(draft?.subject ?? "");
    setBody(draft?.message_body ?? "");
  }, [draft?.id]);

  const runGenerate = async (model: "gemini" | "claude") => {
    setBusy(model);
    try {
      await generateDraft({
        leadId,
        dmContactId: recipient.dmContactId,
        channel: recipient.channel,
        recipientType: recipient.recipientType,
        recipientHandle: recipient.handle,
        sequenceStep: 0,
        model,
      });
      await onChanged();
      toast.success(`Generated via ${model === "gemini" ? "Gemini" : "Claude"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!draft) return;
    setBusy("approve");
    try {
      const r = await approveAndScheduleFollowups(draft.id);
      toast.success(`Approved · ${r.scheduled} follow-up(s) scheduled`);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  const skip = async () => {
    if (!draft) return;
    setBusy("skip");
    try {
      await setStatus(draft.id, "skipped");
      await onChanged();
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      await updateDraft(draft.id, {
        subject: recipient.channel === "email" ? subject || null : null,
        message_body: body,
      });
      setEditing(false);
      await onChanged();
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!draft) return;
    if (!confirm("Delete this draft?")) return;
    try {
      await deleteDraft(draft.id);
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const statusBadge = draft
    ? draft.status === "approved"
      ? "bg-emerald-100 text-emerald-700"
      : draft.status === "sent"
        ? "bg-sky-100 text-sky-700"
        : draft.status === "skipped"
          ? "bg-slate-100 text-slate-500"
          : draft.status === "replied"
            ? "bg-indigo-100 text-indigo-700"
            : "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-500";

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-800">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            {channelIcon[recipient.channel]}
          </span>
          <span className="font-semibold">{recipient.recipientName}</span>
          <span className="text-xs text-slate-500">({recipient.recipientRole})</span>
          <span className="text-xs text-slate-400">· {channelLabel[recipient.channel]}</span>
          <span className="truncate text-[11px] text-slate-400">→ {recipient.handle}</span>
        </div>
        <div className="flex items-center gap-2">
          {draft && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge}`}>
              {draft.status}
            </span>
          )}
          {draft?.ai_model && (
            <span className="text-[10px] uppercase tracking-wide text-slate-400">
              {draft.ai_model.includes("claude") ? "Claude" : "Gemini"} · {timeAgo(draft.updated_at)}
            </span>
          )}
        </div>
      </div>

      {!draft ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runGenerate("gemini")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy === "gemini" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate (Gemini)
          </button>
          <button
            onClick={() => runGenerate("claude")}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
          >
            {busy === "claude" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Premium (Claude)
          </button>
        </div>
      ) : editing ? (
        <div className="space-y-2">
          {recipient.channel === "email" && (
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "save" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setSubject(draft.subject ?? ""); setBody(draft.message_body); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {recipient.channel === "email" && draft.subject && (
            <p className="text-xs font-semibold text-slate-700">
              Subject: <span className="font-normal text-slate-800">{draft.subject}</span>
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {draft.message_body || <em className="text-slate-400">Empty draft — regenerate or edit.</em>}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              onClick={() => runGenerate("gemini")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              {busy === "gemini" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Regenerate (Gemini)
            </button>
            <button
              onClick={() => runGenerate("claude")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/70 px-2.5 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
            >
              {busy === "claude" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Premium (Claude)
            </button>
            <button
              onClick={approve}
              disabled={busy !== null || draft.status === "approved"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Approve
            </button>
            <button
              onClick={skip}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <X className="h-3 w-3" /> Skip
            </button>
            <button
              onClick={() => setStatus(draft.id, "sent").then(onChanged).then(() => toast.success("Marked sent"))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-50"
            >
              <Send className="h-3 w-3" /> Mark sent
            </button>
            <button
              onClick={remove}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

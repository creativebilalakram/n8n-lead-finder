import { useEffect, useMemo, useState } from "react";
import { Users, Mail, Phone, Linkedin, Loader2, Sparkles, ExternalLink, RefreshCw, Globe, Crown, Radar, Instagram, Facebook, Youtube, Twitter, Link2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CopyButton } from "@/components/copy-button";
import type { Business, ContactJob, DecisionMaker, WebsiteContacts, LinkedinEmail } from "@/lib/contacts-db";
import { startEnrichment, rerunStep, type RerunStep } from "@/lib/contacts-db";

type Props = {
  leadId: string;
  businessName: string;
  website: string | null;
};

export function ContactIntelPanel({ leadId, businessName, website }: Props) {
  const [business, setBusiness] = useState<Business | null>(null);
  const [job, setJob] = useState<ContactJob | null>(null);
  const [dms, setDms] = useState<DecisionMaker[]>([]);
  const [contacts, setContacts] = useState<WebsiteContacts | null>(null);
  const [emails, setEmails] = useState<LinkedinEmail[]>([]);
  const [leadRow, setLeadRow] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [rerunningStep, setRerunningStep] = useState<RerunStep | "emails_missing" | null>(null);
  const [findingEmailFor, setFindingEmailFor] = useState<string | null>(null);

  const load = async () => {
    const { data: lr } = await supabase
      .from("leads")
      .select("phone,phones,email,emails,instagram_url,instagram_username,website,raw,brand_dna_raw,instagram_raw")
      .eq("id", leadId)
      .maybeSingle();
    setLeadRow((lr as Record<string, unknown> | null) ?? null);
    const { data: bizRows } = await supabase
      .from("businesses")
      .select("*")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1);
    const biz = (bizRows?.[0] as Business | undefined) ?? null;
    setBusiness(biz);
    if (!biz) {
      setLoading(false);
      return;
    }
    const [{ data: jobRows }, { data: dmRows }, { data: wcRows }, { data: emRows }] = await Promise.all([
      supabase.from("contact_jobs").select("*").eq("business_id", biz.id).order("started_at", { ascending: false }).limit(1),
      supabase.from("decision_makers").select("*").eq("business_id", biz.id).order("decision_maker_score", { ascending: false }),
      supabase.from("website_contacts").select("*").eq("business_id", biz.id).order("updated_at", { ascending: false }).limit(1),
      supabase.from("linkedin_emails").select("*").eq("business_id", biz.id).order("created_at", { ascending: false }),
    ]);
    setJob((jobRows?.[0] as ContactJob | undefined) ?? null);
    setDms((dmRows as DecisionMaker[] | null) ?? []);
    setContacts((wcRows?.[0] as WebsiteContacts | undefined) ?? null);
    setEmails((emRows as LinkedinEmail[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  // Poll while running
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, business?.id]);

  const run = async () => {
    setStarting(true);
    try {
      await startEnrichment(businessName, website, leadId);
      toast.success("Contact Intelligence started — running in background");
      // Give backend a beat then load
      setTimeout(() => { void load(); }, 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  const emailsByDm = useMemo(() => {
    const map = new Map<string, LinkedinEmail[]>();
    for (const e of emails) {
      const list = map.get(e.decision_maker_id) ?? [];
      list.push(e);
      map.set(e.decision_maker_id, list);
    }
    return map;
  }, [emails]);

  const steps = job?.steps ?? {};
  const stepBadge = (s?: { status: string }) => {
    const st = s?.status ?? "pending";
    const cls =
      st === "completed"
        ? "bg-emerald-100 text-emerald-700"
        : st === "running"
          ? "bg-amber-100 text-amber-700 animate-pulse"
          : st === "failed"
            ? "bg-rose-100 text-rose-700"
            : st === "skipped"
              ? "bg-slate-100 text-slate-500"
              : "bg-slate-100 text-slate-500";
    return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{st}</span>;
  };

  const running = job?.status === "running";
  const hasData = dms.length > 0 || contacts || emails.length > 0;

  const doRerun = async (step: RerunStep, scope: "all" | "missing" = "all") => {
    if (!business) return;
    setRerunningStep(scope === "missing" && step === "emails" ? "emails_missing" : step);
    try {
      const res = await rerunStep(business.id, step, scope);
      toast.success(res.alreadyRunning ? "Already running — watching progress" : `Re-running ${labelFor(step).toLowerCase()}…`);
      setTimeout(() => { void load(); }, 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-run failed");
    } finally {
      setRerunningStep(null);
    }
  };

  const findEmailForDm = async (dmId: string) => {
    if (!business) return;
    setFindingEmailFor(dmId);
    try {
      const res = await rerunStep(business.id, "emails", "all", [dmId]);
      toast.success(res.alreadyRunning ? "Already running — watching progress" : "Searching email…");
      setTimeout(() => { void load(); }, 1000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Email lookup failed");
    } finally {
      setFindingEmailFor(null);
    }
  };

  const allSignals = useMemo(() => aggregateSignals({ leadRow, contacts, dms, emails }), [leadRow, contacts, dms, emails]);
  const signalsTotal =
    allSignals.emails.length +
    allSignals.phones.length +
    allSignals.linkedins.length +
    Object.values(allSignals.socials).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-sm backdrop-blur-xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">Contact Intelligence</h2>
          {job && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${
                job.status === "completed"
                  ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                  : job.status === "running"
                    ? "bg-amber-100 text-amber-700 ring-amber-200"
                    : job.status === "failed"
                      ? "bg-rose-100 text-rose-700 ring-rose-200"
                      : "bg-slate-100 text-slate-600 ring-slate-200"
              }`}
            >
              {job.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {business && (
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          )}
          <button
            onClick={run}
            disabled={starting || running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 hover:shadow disabled:opacity-60"
          >
            {starting || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? "Running…" : hasData ? "Re-run enrichment" : "Find decision makers"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        Auto-prefilled from this lead: <span className="font-medium text-slate-700">{businessName}</span>
        {website ? <> · {website.replace(/^https?:\/\//, "")}</> : null}
      </p>

      {/* Step progress */}
      {job && (
        <div className="mt-3 space-y-1.5">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <StepCell
              label="Website scraper"
              badge={stepBadge((steps as Record<string, { status: string }>).website)}
              onRerun={business && !running ? () => doRerun("website") : undefined}
              rerunning={rerunningStep === "website"}
            />
            <StepCell
              label="Decision makers"
              badge={stepBadge((steps as Record<string, { status: string }>).decision_makers)}
              onRerun={business && !running ? () => doRerun("decision_makers") : undefined}
              rerunning={rerunningStep === "decision_makers"}
            />
            <StepCell
              label="LinkedIn → email"
              badge={stepBadge((steps as Record<string, { status: string }>).emails)}
              onRerun={business && !running && dms.length > 0 ? () => doRerun("emails") : undefined}
              rerunning={rerunningStep === "emails"}
              extraAction={
                business && !running && dms.length > 0
                  ? {
                      label: "Missing only",
                      onClick: () => doRerun("emails", "missing"),
                      busy: rerunningStep === "emails_missing",
                    }
                  : undefined
              }
            />
          </div>
          {(["website", "decision_makers", "emails"] as const).map((k) => {
            const st = (steps as Record<string, { note?: string | null; reason?: string | null; linkedinSource?: string | null }>)[k];
            const msg = st?.note || st?.reason;
            if (!msg) return null;
            return (
              <div key={k} className="rounded-md border border-indigo-100 bg-indigo-50/60 px-2.5 py-1 text-[10.5px] text-indigo-800">
                <span className="font-semibold">{labelFor(k)}:</span> {msg}
                {st?.linkedinSource && (
                  <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700 ring-1 ring-indigo-200">
                    source: {st.linkedinSource}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : !business ? (
        <p className="mt-3 text-xs text-slate-500">
          No enrichment yet. Click "Find decision makers" — we'll use this lead's business name and website to find LinkedIn profiles, work emails, and site contacts.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {/* All discovered signals — aggregated across every actor */}
          {signalsTotal > 0 && (
            <section className="rounded-xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/70 via-white to-violet-50/40 p-3.5">
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-800">
                <Radar className="h-3.5 w-3.5" /> All discovered signals
                <span className="text-indigo-400">({signalsTotal})</span>
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <SignalGroup
                  icon={<Mail className="h-3 w-3" />}
                  label="Emails"
                  items={allSignals.emails}
                  hrefFor={(v) => `mailto:${v.value}`}
                />
                <SignalGroup
                  icon={<Phone className="h-3 w-3" />}
                  label="Phones"
                  items={allSignals.phones}
                  hrefFor={(v) => `tel:${v.value}`}
                />
                <SignalGroup
                  icon={<Linkedin className="h-3 w-3" />}
                  label="LinkedIn"
                  items={allSignals.linkedins}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Instagram className="h-3 w-3" />}
                  label="Instagram"
                  items={allSignals.socials.instagram}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Facebook className="h-3 w-3" />}
                  label="Facebook"
                  items={allSignals.socials.facebook}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Youtube className="h-3 w-3" />}
                  label="YouTube"
                  items={allSignals.socials.youtube}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Twitter className="h-3 w-3" />}
                  label="X / Twitter"
                  items={allSignals.socials.twitter}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Link2 className="h-3 w-3" />}
                  label="TikTok"
                  items={allSignals.socials.tiktok}
                  hrefFor={(v) => v.value}
                  external
                />
                <SignalGroup
                  icon={<Globe className="h-3 w-3" />}
                  label="Websites"
                  items={allSignals.websites}
                  hrefFor={(v) => v.value}
                  external
                />
              </div>
            </section>
          )}

          {/* Decision makers */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <Crown className="h-3 w-3 text-amber-500" /> Decision makers
              <span className="text-slate-400">({dms.length})</span>
            </h3>
            {dms.length === 0 ? (
              <p className="text-xs text-slate-500">{running ? "Searching LinkedIn…" : "None yet."}</p>
            ) : (
              <ul className="space-y-2">
                {dms.map((dm) => {
                  const score = dm.manual_score_override ?? dm.decision_maker_score;
                  const dmEmails = emailsByDm.get(dm.id) ?? [];
                  const isHigh = (dm.priority || "").toLowerCase() === "high";
                  return (
                    <li
                      key={dm.id}
                      className={`rounded-xl border p-3 ${isHigh ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white/70"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-slate-900">
                              {dm.person_name || "Unknown"}
                            </span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                isHigh ? "bg-amber-200 text-amber-900" : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {dm.priority || "—"} · {score}
                            </span>
                          </div>
                          {dm.person_title && (
                            <p className="truncate text-[11px] text-slate-600">{dm.person_title}</p>
                          )}
                        </div>
                        {dm.person_profile_url && (
                          <a
                            href={dm.person_profile_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100"
                          >
                            <Linkedin className="h-3 w-3" /> Profile
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      {dm.person_profile_url && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            disabled={running || findingEmailFor === dm.id}
                            onClick={() => findEmailForDm(dm.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                            title={dmEmails.length ? "Search again for emails on this profile" : "Find email for this person"}
                          >
                            {findingEmailFor === dm.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Mail className="h-3 w-3" />
                            )}
                            {dmEmails.length ? "Re-find email" : "Find email"}
                          </button>
                        </div>
                      )}
                      {dmEmails.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {dmEmails.map((e) => (
                            <div
                              key={e.id}
                              className="flex items-center justify-between gap-2 rounded-md bg-emerald-50/70 px-2 py-1 text-[11px]"
                            >
                              <a href={`mailto:${e.email}`} className="truncate font-mono text-emerald-800 hover:underline">
                                {e.email}
                              </a>
                              <div className="flex items-center gap-1">
                                {e.confidence && (
                                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                                    {e.confidence}
                                  </span>
                                )}
                                <CopyButton value={e.email} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Website contacts */}
          {contacts && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <Globe className="h-3 w-3 text-slate-500" /> Website contacts
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <ContactList icon={<Mail className="h-3 w-3" />} label="Emails" items={contacts.emails} mailto />
                <ContactList icon={<Phone className="h-3 w-3" />} label="Phones" items={contacts.phones} tel />
                <ContactList icon={<Linkedin className="h-3 w-3" />} label="LinkedIn" items={contacts.linkedins} link />
              </div>
              {Object.entries(contacts.socials || {}).some(([, v]) => Array.isArray(v) && v.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(contacts.socials).flatMap(([net, arr]) =>
                    (arr || []).slice(0, 3).map((u) => (
                      <a
                        key={`${net}-${u}`}
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        {net.replace(/s$/, "")}
                      </a>
                    )),
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function StepCell({
  label,
  badge,
  onRerun,
  rerunning,
  extraAction,
}: {
  label: string;
  badge: React.ReactNode;
  onRerun?: () => void;
  rerunning?: boolean;
  extraAction?: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-slate-600">{label}</span>
        {badge}
      </div>
      {(onRerun || extraAction) && (
        <div className="flex items-center gap-1.5">
          {onRerun && (
            <button
              type="button"
              onClick={onRerun}
              disabled={rerunning}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
              title={`Re-run ${label}`}
            >
              {rerunning ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
              Re-run
            </button>
          )}
          {extraAction && (
            <button
              type="button"
              onClick={extraAction.onClick}
              disabled={extraAction.busy}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60"
              title={`${extraAction.label} — only DMs without emails yet`}
            >
              {extraAction.busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />}
              {extraAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function labelFor(k: "website" | "decision_makers" | "emails") {
  if (k === "website") return "Website scraper";
  if (k === "decision_makers") return "Decision makers";
  return "LinkedIn → email";
}

type Signal = { value: string; sources: string[] };
type Aggregated = {
  emails: Signal[];
  phones: Signal[];
  linkedins: Signal[];
  websites: Signal[];
  socials: {
    instagram: Signal[];
    facebook: Signal[];
    youtube: Signal[];
    twitter: Signal[];
    tiktok: Signal[];
  };
};

const SOCIAL_PATTERNS: Record<keyof Aggregated["socials"], RegExp> = {
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._\-\/?=&%#]+/gi,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._\-\/?=&%#]+/gi,
  youtube: /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[A-Za-z0-9._\-\/?=&%#]+/gi,
  twitter: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9._\-\/?=&%#]+/gi,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._\-\/?=&%#]+/gi,
};
const LINKEDIN_RE = /https?:\/\/(?:[a-z]{2,4}\.)?linkedin\.com\/[A-Za-z0-9._\-\/?=&%#]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const WEBSITE_RE = /https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s"'<>]*)?/gi;

function clean(v: string) {
  return v.replace(/[)\].,'"<>]+$/g, "").trim();
}
function addSignal(map: Map<string, Signal>, value: string, source: string) {
  const key = value.toLowerCase();
  const existing = map.get(key);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  } else {
    map.set(key, { value, sources: [source] });
  }
}
function mineFrom(blob: unknown, source: string, agg: {
  emails: Map<string, Signal>;
  phones: Map<string, Signal>;
  linkedins: Map<string, Signal>;
  socials: Record<keyof Aggregated["socials"], Map<string, Signal>>;
  websites: Map<string, Signal>;
}) {
  if (blob == null) return;
  let txt: string;
  try { txt = typeof blob === "string" ? blob : JSON.stringify(blob); } catch { return; }
  for (const m of txt.matchAll(EMAIL_RE)) addSignal(agg.emails, clean(m[0]), source);
  for (const m of txt.matchAll(LINKEDIN_RE)) addSignal(agg.linkedins, clean(m[0]), source);
  for (const [key, re] of Object.entries(SOCIAL_PATTERNS)) {
    for (const m of txt.matchAll(re)) addSignal(agg.socials[key as keyof Aggregated["socials"]], clean(m[0]), source);
  }
}

function aggregateSignals({
  leadRow,
  contacts,
  dms,
  emails,
}: {
  leadRow: Record<string, unknown> | null;
  contacts: WebsiteContacts | null;
  dms: DecisionMaker[];
  emails: LinkedinEmail[];
}): Aggregated {
  const agg = {
    emails: new Map<string, Signal>(),
    phones: new Map<string, Signal>(),
    linkedins: new Map<string, Signal>(),
    socials: {
      instagram: new Map<string, Signal>(),
      facebook: new Map<string, Signal>(),
      youtube: new Map<string, Signal>(),
      twitter: new Map<string, Signal>(),
      tiktok: new Map<string, Signal>(),
    },
    websites: new Map<string, Signal>(),
  };

  // From the lead row itself (Google Business Profile)
  if (leadRow) {
    const phone = leadRow.phone as string | null | undefined;
    if (phone) addSignal(agg.phones, phone, "GBP");
    if (Array.isArray(leadRow.phones)) for (const p of leadRow.phones) if (typeof p === "string") addSignal(agg.phones, p, "GBP");
    const email = leadRow.email as string | null | undefined;
    if (email) addSignal(agg.emails, email, "GBP");
    if (Array.isArray(leadRow.emails)) for (const e of leadRow.emails) if (typeof e === "string") addSignal(agg.emails, e, "GBP");
    const site = leadRow.website as string | null | undefined;
    if (site) addSignal(agg.websites, site, "GBP");
    const ig = leadRow.instagram_url as string | null | undefined;
    if (ig) addSignal(agg.socials.instagram, ig, "Instagram actor");
    mineFrom(leadRow.raw, "GBP", agg);
    mineFrom(leadRow.brand_dna_raw, "Brand DNA", agg);
    mineFrom(leadRow.instagram_raw, "Instagram actor", agg);
  }

  // From website-contacts (the contact-info-scraper)
  if (contacts) {
    for (const e of contacts.emails || []) addSignal(agg.emails, e, "Website");
    for (const p of contacts.phones || []) addSignal(agg.phones, p, "Website");
    for (const l of contacts.linkedins || []) addSignal(agg.linkedins, l, "Website");
    const s = contacts.socials || {};
    for (const url of (s.instagrams as string[] | undefined) || []) addSignal(agg.socials.instagram, url, "Website");
    for (const url of (s.facebooks as string[] | undefined) || []) addSignal(agg.socials.facebook, url, "Website");
    for (const url of (s.youtubes as string[] | undefined) || []) addSignal(agg.socials.youtube, url, "Website");
    for (const url of (s.twitters as string[] | undefined) || []) addSignal(agg.socials.twitter, url, "Website");
    for (const url of (s.tiktoks as string[] | undefined) || []) addSignal(agg.socials.tiktok, url, "Website");
  }

  // From decision makers + LinkedIn-to-email
  for (const dm of dms) {
    if (dm.person_profile_url) addSignal(agg.linkedins, dm.person_profile_url, `DM: ${dm.person_name || "person"}`);
  }
  for (const e of emails) addSignal(agg.emails, e.email, "LinkedIn→email");

  // Mine phone numbers from raw blobs (more lenient — only via leadRow/brand to avoid noise)
  if (leadRow) {
    const text = `${JSON.stringify(leadRow.raw || "")} ${JSON.stringify(leadRow.brand_dna_raw || "")}`;
    for (const m of text.matchAll(PHONE_RE)) {
      const v = m[0].trim();
      const digits = v.replace(/\D/g, "");
      if (digits.length >= 9 && digits.length <= 15) addSignal(agg.phones, v, "Mined");
    }
  }

  const toArr = (m: Map<string, Signal>) => [...m.values()].slice(0, 25);
  return {
    emails: toArr(agg.emails),
    phones: toArr(agg.phones),
    linkedins: toArr(agg.linkedins),
    websites: toArr(agg.websites),
    socials: {
      instagram: toArr(agg.socials.instagram),
      facebook: toArr(agg.socials.facebook),
      youtube: toArr(agg.socials.youtube),
      twitter: toArr(agg.socials.twitter),
      tiktok: toArr(agg.socials.tiktok),
    },
  };
}

function SignalGroup({
  icon,
  label,
  items,
  hrefFor,
  external,
}: {
  icon: React.ReactNode;
  label: string;
  items: Signal[];
  hrefFor: (s: Signal) => string;
  external?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-white/80 bg-white/80 px-2.5 py-2 shadow-sm">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {icon} {label} <span className="text-slate-400">({items.length})</span>
      </div>
      <ul className="space-y-0.5 text-[11px]">
        {items.slice(0, 8).map((s) => (
          <li key={s.value} className="flex items-center justify-between gap-1">
            <a
              href={hrefFor(s)}
              target={external ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="truncate text-slate-800 hover:text-indigo-600 hover:underline"
              title={`${s.value} · from ${s.sources.join(", ")}`}
            >
              {s.value}
            </a>
            <div className="flex shrink-0 items-center gap-1">
              <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-medium text-indigo-700 ring-1 ring-indigo-100">
                {s.sources[0]}
                {s.sources.length > 1 ? ` +${s.sources.length - 1}` : ""}
              </span>
              <CopyButton value={s.value} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactList({
  icon,
  label,
  items,
  mailto,
  tel,
  link,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  mailto?: boolean;
  tel?: boolean;
  link?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/70 px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {icon} {label} <span className="text-slate-400">({items?.length || 0})</span>
      </div>
      <ul className="space-y-0.5 text-[11px]">
        {(items || []).slice(0, 6).map((v) => {
          const href = mailto ? `mailto:${v}` : tel ? `tel:${v}` : link ? v : undefined;
          return (
            <li key={v} className="flex items-center justify-between gap-1">
              {href ? (
                <a href={href} target={link ? "_blank" : undefined} rel="noopener noreferrer" className="truncate text-slate-800 hover:text-indigo-600 hover:underline">
                  {v}
                </a>
              ) : (
                <span className="truncate text-slate-800">{v}</span>
              )}
              <CopyButton value={v} />
            </li>
          );
        })}
        {(items?.length || 0) === 0 && <li className="text-slate-400">—</li>}
      </ul>
    </div>
  );
}
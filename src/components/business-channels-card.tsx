import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Phone, Mail, Instagram, Facebook, Globe, Youtube, Music2, Linkedin, MessageCircle, RefreshCw, ShieldCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import {
  getBusinessChannels,
  upsertBusinessChannels,
  type BusinessChannels,
} from "@/lib/contact-hub-db";
import {
  mergeChannelsFromSources,
  mergedToRow,
  sourceShort,
  type ChannelSource,
} from "@/lib/channel-merge";

type Props = {
  leadId: string;
  businessId?: string | null;
  raw?: unknown;
};

type Sources = Record<string, ChannelSource[]>;

async function loadAllSources(leadId: string, businessId: string | null, raw: unknown) {
  let websiteContacts: unknown = null;
  let instagramRaw: unknown = null;
  let brandDnaRaw: unknown = null;

  const { data: leadRow } = await supabase
    .from("leads")
    .select("instagram_raw,brand_dna_raw")
    .eq("id", leadId)
    .maybeSingle();
  if (leadRow) {
    instagramRaw = (leadRow as Record<string, unknown>).instagram_raw ?? null;
    brandDnaRaw = (leadRow as Record<string, unknown>).brand_dna_raw ?? null;
  }

  if (businessId) {
    const { data: wc } = await supabase
      .from("website_contacts")
      .select("*")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(1);
    websiteContacts = (wc ?? [])[0] ?? null;
  }
  return { gbpRaw: raw, websiteContacts, instagramRaw, brandDnaRaw };
}

function SourceChips({ sources }: { sources: ChannelSource[] | undefined }) {
  if (!sources || !sources.length) return null;
  const colorOf = (s: ChannelSource) =>
    s === "Google Business Profile"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : s === "Website scrape"
        ? "bg-indigo-50 text-indigo-700 border-indigo-200"
        : s === "Brand DNA"
          ? "bg-violet-50 text-violet-700 border-violet-200"
          : "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200";
  return (
    <span className="ml-1 inline-flex gap-1 align-middle">
      {sources.map((s) => (
        <span
          key={s}
          title={s}
          className={`inline-block rounded-sm border px-1 text-[9px] font-semibold leading-tight ${colorOf(s)}`}
        >
          {sourceShort(s)}
        </span>
      ))}
    </span>
  );
}

function ListEditor({
  label,
  icon: Icon,
  values,
  onChange,
  placeholder,
  sources,
  fieldKeyFor,
}: {
  label: string;
  icon: typeof Mail;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  sources?: Sources;
  fieldKeyFor?: (v: string) => string;
}) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v) return;
    if (values.includes(v)) return setText("");
    onChange([...values, v]);
    setText("");
  };
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-slate-600">
        <Icon className="h-3.5 w-3.5" /> {label}
      </Label>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => {
          const key = fieldKeyFor ? fieldKeyFor(v) : "";
          const src = key && sources ? sources[key] : undefined;
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] text-slate-700"
            >
              {v}
              <SourceChips sources={src} />
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-slate-400 hover:text-rose-500"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="h-8 text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={add} className="h-8 text-xs">
          Add
        </Button>
      </div>
    </div>
  );
}

export function BusinessChannelsCard({ leadId, businessId, raw }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [state, setState] = useState<Partial<BusinessChannels>>({});
  const [existingId, setExistingId] = useState<string | null>(null);
  const [sources, setSources] = useState<Sources>({});
  const [meta, setMeta] = useState<{ dropped: number; autoSyncedAt: string | null }>({ dropped: 0, autoSyncedAt: null });

  const loadAndMerge = async () => {
    setLoading(true);
    try {
      const existing = await getBusinessChannels(leadId).catch(() => null);
      const bizId = businessId ?? existing?.business_id ?? null;
      const allSources = await loadAllSources(leadId, bizId, raw);
      const merged = mergeChannelsFromSources(allSources);
      const mergedRow = mergedToRow(merged);

      if (existing) {
        setExistingId(existing.id);
        // Existing saved values win, but fill any blanks from the freshly
        // merged sources so newly available data (e.g. phone from GBP) shows up.
        const filled: Partial<BusinessChannels> = { ...existing };
        const ex = existing as unknown as Record<string, unknown>;
        const isBlank = (v: unknown) =>
          v == null || v === "" || (Array.isArray(v) && v.length === 0);
        if (isBlank(ex.generic_emails)) filled.generic_emails = mergedRow.generic_emails;
        if (isBlank(ex.generic_phones)) filled.generic_phones = mergedRow.generic_phones;
        for (const k of [
          "instagram_url","facebook_url","tiktok_url","linkedin_company_url","twitter_url","youtube_url",
        ] as const) {
          if (isBlank(ex[k])) (filled as Record<string, unknown>)[k] = (mergedRow as Record<string, unknown>)[k];
        }
        setState(filled);
        // Merge sources map from existing row + freshly computed for any
        // values that match. This lets chips appear even on previously saved
        // rows that didn't store sources.
        const existingSources = (existing as unknown as { sources?: Sources }).sources ?? {};
        const synced = (existing as unknown as { auto_synced_at?: string | null }).auto_synced_at ?? null;
        const combined: Sources = { ...mergedRow.sources, ...existingSources };
        setSources(combined);
        setMeta({ dropped: merged.droppedNonProfile, autoSyncedAt: synced });
      } else {
        // No saved row yet — pre-populate from merged sources.
        setState({
          generic_emails: mergedRow.generic_emails,
          generic_phones: mergedRow.generic_phones,
          instagram_url: mergedRow.instagram_url,
          facebook_url: mergedRow.facebook_url,
          tiktok_url: mergedRow.tiktok_url,
          linkedin_company_url: mergedRow.linkedin_company_url,
          twitter_url: mergedRow.twitter_url,
          youtube_url: mergedRow.youtube_url,
        });
        setSources(mergedRow.sources);
        setMeta({ dropped: merged.droppedNonProfile, autoSyncedAt: null });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAndMerge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, raw, businessId]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await upsertBusinessChannels({
        ...state,
        lead_id: leadId,
        business_id: businessId ?? state.business_id ?? null,
        // Persist current source map so chips survive reload.
        ...({ sources } as object),
      } as Partial<BusinessChannels> & { lead_id: string });
      setExistingId(saved.id);
      setState(saved);
      toast.success("Business channels saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runWebsiteScraper = async () => {
    setSyncing(true);
    const t = toast.loading("Running website contact scraper + merging all sources…");
    try {
      const res = await fetch("/api/public/channels/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; counts?: { emails: number; phones: number; socials: number; dropped: number }; scraped?: boolean };
      toast.dismiss(t);
      if (json.error) {
        toast.error(json.error);
      } else {
        toast.success(
          `Synced: ${json.counts?.emails ?? 0} emails · ${json.counts?.phones ?? 0} phones · ${json.counts?.socials ?? 0} socials${json.counts?.dropped ? ` · dropped ${json.counts.dropped} post/reel URLs` : ""}`,
        );
      }
      await loadAndMerge();
    } catch (e) {
      toast.dismiss(t);
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const mergeNow = () => {
    // Re-merge current sources without calling the scraper.
    void loadAndMerge();
    toast("Re-merged from all known sources");
  };

  return (
    <section className="rounded-2xl border border-white/60 bg-white/70 p-5 backdrop-blur-xl shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Globe className="h-4 w-4 text-indigo-500" /> Business Channels
            {meta.autoSyncedAt && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <ShieldCheck className="h-2.5 w-2.5" /> Auto-synced
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Smart-merged from Google Business Profile, website scrape, Instagram, and Brand DNA. Post/reel URLs are filtered out automatically.
            {meta.dropped > 0 && <span className="ml-1 text-amber-600">({meta.dropped} non-profile URL{meta.dropped === 1 ? "" : "s"} dropped)</span>}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={mergeNow} disabled={loading || syncing} className="h-8 text-xs">
            <Sparkles className="mr-1 h-3 w-3" /> Re-merge
          </Button>
          <Button size="sm" variant="outline" onClick={runWebsiteScraper} disabled={syncing} className="h-8 text-xs">
            {syncing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}
            Run website scraper
          </Button>
          <Button size="sm" onClick={save} disabled={loading || saving} className="h-8 text-xs">
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            {existingId ? "Save" : "Create"}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <ListEditor
            label="Emails (info@, contact@, …)"
            icon={Mail}
            values={state.generic_emails ?? []}
            onChange={(v) => setState({ ...state, generic_emails: v })}
            placeholder="info@business.com"
            sources={sources}
            fieldKeyFor={(v) => `email:${v}`}
          />
          <ListEditor
            label="Phones"
            icon={Phone}
            values={state.generic_phones ?? []}
            onChange={(v) => setState({ ...state, generic_phones: v })}
            placeholder="+1 555 555 5555"
            sources={sources}
            fieldKeyFor={(v) => `phone:${v}`}
          />
          {[
            { key: "instagram_url" as const, label: "Instagram URL", icon: Instagram },
            { key: "facebook_url" as const, label: "Facebook URL", icon: Facebook },
            { key: "tiktok_url" as const, label: "TikTok URL", icon: Music2 },
            { key: "linkedin_company_url" as const, label: "LinkedIn Company URL", icon: Linkedin },
            { key: "twitter_url" as const, label: "Twitter / X URL", icon: Globe },
            { key: "youtube_url" as const, label: "YouTube URL", icon: Youtube },
            { key: "whatsapp_business" as const, label: "WhatsApp Business", icon: MessageCircle },
          ].map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-slate-600">
                <f.icon className="h-3.5 w-3.5" /> {f.label}
                <SourceChips sources={sources[f.key]} />
              </Label>
              <Input
                value={(state[f.key] as string | null | undefined) ?? ""}
                onChange={(e) => setState({ ...state, [f.key]: e.target.value || null })}
                className="h-8 text-xs"
                placeholder=""
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
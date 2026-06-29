import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Save, Sparkles, Phone, Mail, Instagram, Facebook, Globe, Youtube, Music2, Linkedin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getBusinessChannels,
  upsertBusinessChannels,
  type BusinessChannels,
} from "@/lib/contact-hub-db";

type Props = {
  leadId: string;
  businessId?: string | null;
  raw?: unknown;
};

function seedFromRaw(raw: unknown): Partial<BusinessChannels> {
  if (!raw || typeof raw !== "object") return {};
  const j = raw as Record<string, unknown>;
  const emails = Array.isArray(j.emails) ? (j.emails as string[]).filter(Boolean) : [];
  const phones = Array.isArray(j.phones)
    ? (j.phones as string[]).filter(Boolean)
    : typeof j.phone === "string" && j.phone
      ? [j.phone as string]
      : [];
  const firstOf = (arr: unknown): string | null =>
    Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string" ? (arr[0] as string) : null;
  return {
    generic_emails: emails,
    generic_phones: phones,
    instagram_url: firstOf(j.instagrams) ?? null,
    facebook_url: firstOf(j.facebooks) ?? null,
    tiktok_url: firstOf(j.tiktoks) ?? null,
    twitter_url: firstOf(j.twitters) ?? null,
    youtube_url: firstOf(j.youtubes) ?? null,
    linkedin_company_url: firstOf(j.linkedIns) ?? null,
  };
}

function ListEditor({
  label,
  icon: Icon,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  icon: typeof Mail;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
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
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] text-slate-700"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-slate-400 hover:text-rose-500"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
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
  const [state, setState] = useState<Partial<BusinessChannels>>({});
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getBusinessChannels(leadId)
      .then((row) => {
        if (!alive) return;
        if (row) {
          setExistingId(row.id);
          setState(row);
        } else {
          setState(seedFromRaw(raw));
        }
      })
      .catch(() => alive && setState(seedFromRaw(raw)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [leadId, raw]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await upsertBusinessChannels({
        ...state,
        lead_id: leadId,
        business_id: businessId ?? state.business_id ?? null,
      });
      setExistingId(saved.id);
      setState(saved);
      toast.success("Business channels saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const seed = () => {
    setState({ ...state, ...seedFromRaw(raw) });
    toast("Seeded from Google Maps data — review and Save");
  };

  return (
    <section className="rounded-2xl border border-white/60 bg-white/70 p-5 backdrop-blur-xl shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Globe className="h-4 w-4 text-indigo-500" /> Business Channels
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Generic info@/contact@ emails, main phones, and brand socials.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={seed} disabled={loading} className="h-8 text-xs">
            <Sparkles className="mr-1 h-3 w-3" /> Reseed from Maps
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
          />
          <ListEditor
            label="Phones"
            icon={Phone}
            values={state.generic_phones ?? []}
            onChange={(v) => setState({ ...state, generic_phones: v })}
            placeholder="+1 555 555 5555"
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
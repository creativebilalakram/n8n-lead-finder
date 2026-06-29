import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertDmContact, type DmContact } from "@/lib/contact-hub-db";
import { parseContactBlob, linkedinSlugToName } from "@/lib/contact-parse";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  decisionMakerId: string;
  defaults: Partial<DmContact>;
  existing: DmContact | null;
  onSaved: (c: DmContact) => void;
};

const FIELDS: Array<{ key: keyof DmContact; label: string; placeholder?: string }> = [
  { key: "full_name", label: "Full name" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "role", label: "Role / Title" },
  { key: "work_email", label: "Work email", placeholder: "name@business.com" },
  { key: "personal_email", label: "Personal email" },
  { key: "phone", label: "Phone", placeholder: "+1…" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "instagram_handle", label: "Instagram handle" },
  { key: "facebook_url", label: "Facebook URL" },
  { key: "twitter_handle", label: "Twitter / X handle" },
];

export function DmContactModal({
  open,
  onOpenChange,
  leadId,
  decisionMakerId,
  defaults,
  existing,
  onSaved,
}: Props) {
  const [state, setState] = useState<Partial<DmContact>>({});
  const [blob, setBlob] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setState({
        source: "contactout-manual",
        confidence: "verified",
        ...defaults,
        ...(existing ?? {}),
      });
      setBlob("");
    }
  }, [open, existing, defaults]);

  const setField = <K extends keyof DmContact>(k: K, v: DmContact[K] | null) =>
    setState((s) => ({ ...s, [k]: v }));

  const parseLinkedInOnBlur = (url: string) => {
    const m = url.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
    if (!m) return;
    const parsed = linkedinSlugToName(m[1]);
    setState((s) => ({
      ...s,
      first_name: s.first_name || parsed.first || s.first_name,
      last_name: s.last_name || parsed.last || s.last_name,
      full_name: s.full_name || parsed.full || s.full_name,
    }));
  };

  const parseBlob = () => {
    const p = parseContactBlob(blob);
    setState((s) => ({
      ...s,
      work_email: s.work_email || p.emails[0] || null,
      personal_email: s.personal_email || p.emails[1] || null,
      phone: s.phone || p.phones[0] || null,
      whatsapp: s.whatsapp || p.phones[1] || null,
      linkedin_url: s.linkedin_url || p.linkedin_url || null,
      instagram_handle: s.instagram_handle || p.instagram_handle || null,
      facebook_url: s.facebook_url || p.facebook_url || null,
      twitter_handle: s.twitter_handle || p.twitter_handle || null,
      first_name: s.first_name || p.derived_first || s.first_name,
      last_name: s.last_name || p.derived_last || s.last_name,
      full_name: s.full_name || p.derived_full || s.full_name,
    }));
    const got = [
      p.emails.length && `${p.emails.length} email${p.emails.length > 1 ? "s" : ""}`,
      p.phones.length && `${p.phones.length} phone${p.phones.length > 1 ? "s" : ""}`,
      p.linkedin_url && "LinkedIn",
      p.instagram_handle && "Instagram",
      p.facebook_url && "Facebook",
      p.twitter_handle && "Twitter",
    ].filter(Boolean);
    toast(got.length ? `Parsed: ${got.join(", ")}` : "Nothing matched — paste again");
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await upsertDmContact({
        ...state,
        decision_maker_id: decisionMakerId,
        lead_id: leadId,
      });
      toast.success("Contact saved");
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit" : "Add"} contact details</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Manual fields</TabsTrigger>
            <TabsTrigger value="paste">Quick paste</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-2">
            <Label className="text-xs text-slate-600">
              Paste ContactOut export (or anything with emails / phones / links)
            </Label>
            <Textarea
              value={blob}
              onChange={(e) => setBlob(e.target.value)}
              rows={8}
              placeholder="John Smith • Owner • johnsmith@clinic.com • +1 415 555 0123 • linkedin.com/in/john-smith-1a2b"
              className="text-xs"
            />
            <Button type="button" onClick={parseBlob} disabled={!blob.trim()} variant="outline">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Parse into fields
            </Button>
            <p className="text-[11px] text-slate-500">
              Parsed values populate empty fields below. Switch to the Manual tab to review before saving.
            </p>
          </TabsContent>

          <TabsContent value="manual" className="space-y-3">
            <div className="grid max-h-[55vh] gap-3 overflow-y-auto pr-1 md:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={String(f.key)} className="space-y-1">
                  <Label className="text-xs text-slate-600">{f.label}</Label>
                  <Input
                    value={(state[f.key] as string | null | undefined) ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setField(f.key, (e.target.value || null) as never)}
                    onBlur={
                      f.key === "linkedin_url"
                        ? (e) => parseLinkedInOnBlur(e.target.value)
                        : undefined
                    }
                    className="h-8 text-xs"
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Source</Label>
                <Select
                  value={(state.source as string) ?? "contactout-manual"}
                  onValueChange={(v) => setField("source", v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contactout-manual">ContactOut (manual)</SelectItem>
                    <SelectItem value="apify">Apify</SelectItem>
                    <SelectItem value="pdl">PDL</SelectItem>
                    <SelectItem value="manual-research">Manual research</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-slate-600">Confidence</Label>
                <Select
                  value={(state.confidence as string) ?? "verified"}
                  onValueChange={(v) => setField("confidence", v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="likely">Likely</SelectItem>
                    <SelectItem value="guessed">Guessed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs text-slate-600">Notes</Label>
                <Textarea
                  value={(state.notes as string | null | undefined) ?? ""}
                  onChange={(e) => setField("notes", e.target.value || null)}
                  rows={2}
                  className="text-xs"
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
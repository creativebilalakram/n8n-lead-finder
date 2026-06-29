import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Mail,
  Phone,
  Linkedin,
  Instagram,
  Facebook,
  MessageCircle,
  Pencil,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DmContactModal } from "./dm-contact-modal";
import { getDmContactsForLead, type DmContact } from "@/lib/contact-hub-db";

type DM = {
  id: string;
  business_id: string;
  person_name: string | null;
  person_title: string | null;
  person_profile_url: string | null;
};

type Props = { leadId: string };

function ChannelChip({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-[11px] text-slate-700">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ContactPreview({ c }: { c: DmContact }) {
  const chips: React.ReactNode[] = [];
  if (c.work_email) chips.push(<ChannelChip key="w" icon={Mail} label={c.work_email} />);
  if (c.personal_email && c.personal_email !== c.work_email)
    chips.push(<ChannelChip key="p" icon={Mail} label={c.personal_email} />);
  if (c.phone) chips.push(<ChannelChip key="ph" icon={Phone} label={c.phone} />);
  if (c.whatsapp && c.whatsapp !== c.phone)
    chips.push(<ChannelChip key="wa" icon={MessageCircle} label={c.whatsapp} />);
  if (c.linkedin_url) chips.push(<ChannelChip key="li" icon={Linkedin} label="LinkedIn" />);
  if (c.instagram_handle) chips.push(<ChannelChip key="ig" icon={Instagram} label={`@${c.instagram_handle}`} />);
  if (c.facebook_url) chips.push(<ChannelChip key="fb" icon={Facebook} label="Facebook" />);
  if (!chips.length)
    return <p className="text-[11px] italic text-slate-500">No channels saved yet.</p>;
  return <div className="flex flex-wrap gap-1.5">{chips}</div>;
}

export function DmContactHubCard({ leadId }: Props) {
  const [loading, setLoading] = useState(true);
  const [dms, setDms] = useState<DM[]>([]);
  const [contacts, setContacts] = useState<DmContact[]>([]);
  const [editing, setEditing] = useState<{ dm: DM; existing: DmContact | null } | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const { data: biz } = await supabase
        .from("businesses")
        .select("id")
        .eq("lead_id", leadId)
        .order("updated_at", { ascending: false })
        .limit(1);
      const businessId = biz?.[0]?.id as string | undefined;
      let dmRows: DM[] = [];
      if (businessId) {
        const { data } = await supabase
          .from("decision_makers")
          .select("id, business_id, person_name, person_title, person_profile_url")
          .eq("business_id", businessId)
          .order("decision_maker_score", { ascending: false });
        dmRows = (data ?? []) as DM[];
      }
      const all = await getDmContactsForLead(leadId);
      setDms(dmRows);
      setContacts(all);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [leadId]);

  const byDm = useMemo(() => {
    const m = new Map<string, DmContact>();
    for (const c of contacts) if (c.decision_maker_id) m.set(c.decision_maker_id, c);
    return m;
  }, [contacts]);

  return (
    <section className="rounded-2xl border border-white/60 bg-white/70 p-5 backdrop-blur-xl shadow-sm">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <Users className="h-4 w-4 text-indigo-500" /> Contact Hub — Decision Makers
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Manually-curated channels per person. Pastes from ContactOut, LinkedIn, etc.
          </p>
        </div>
        <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          {contacts.length} saved
        </span>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading decision makers…
        </div>
      ) : dms.length === 0 ? (
        <p className="text-xs text-slate-500">
          No decision makers yet — run the Contact Intelligence panel above first.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {dms.map((dm) => {
            const existing = byDm.get(dm.id) ?? null;
            return (
              <li
                key={dm.id}
                className="rounded-xl border border-slate-200 bg-white/80 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                      {dm.person_name ?? "Unknown"}
                      {existing?.confidence === "verified" && (
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                    </div>
                    {dm.person_title && (
                      <div className="text-[11px] text-slate-500">{dm.person_title}</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing({ dm, existing })}
                    className="h-7 text-[11px]"
                  >
                    {existing ? (
                      <>
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </>
                    ) : (
                      <>
                        <Plus className="mr-1 h-3 w-3" /> Add
                      </>
                    )}
                  </Button>
                </div>
                <div className="mt-2">
                  {existing ? (
                    <ContactPreview c={existing} />
                  ) : (
                    <p className="text-[11px] italic text-slate-400">No contact details saved.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <DmContactModal
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
          leadId={leadId}
          decisionMakerId={editing.dm.id}
          defaults={{
            full_name: editing.dm.person_name,
            role: editing.dm.person_title,
            linkedin_url: editing.dm.person_profile_url,
          }}
          existing={editing.existing}
          onSaved={(saved) => {
            setContacts((prev) => {
              const others = prev.filter((c) => c.id !== saved.id && c.decision_maker_id !== saved.decision_maker_id);
              return [...others, saved];
            });
          }}
        />
      )}
    </section>
  );
}
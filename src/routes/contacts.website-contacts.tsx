import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Globe, Instagram, Facebook, Twitter, Youtube } from "lucide-react";
import { listBusinesses, listWebsiteContacts } from "@/lib/contacts-db";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";

export const Route = createFileRoute("/contacts/website-contacts")({ component: Page });

function Page() {
  const wc = useQuery({ queryKey: ["website-contacts"], queryFn: listWebsiteContacts, refetchInterval: 8000 });
  const businesses = useQuery({ queryKey: ["contacts-businesses"], queryFn: listBusinesses });
  const bizMap = useMemo(() => Object.fromEntries((businesses.data || []).map((b) => [b.id, b])), [businesses.data]);

  return (
    <div className="space-y-3">
      {(wc.data || []).map((w) => {
        const b = bizMap[w.business_id];
        return (
          <Card key={w.id} className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
            <div className="mb-3 flex items-center gap-2">
              <Globe className="h-4 w-4 text-indigo-500" />
              <div>
                <div className="font-semibold text-slate-900">{b?.name || w.business_id}</div>
                <div className="text-xs text-slate-500">{b?.website || ""}</div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Block title="Emails" items={w.emails} />
              <Block title="Phones" items={w.phones} />
              <Block title="LinkedIn" items={w.linkedins} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-5">
              <SocialBlock icon={Instagram} label="Instagram" items={w.socials?.instagrams || []} />
              <SocialBlock icon={Facebook} label="Facebook" items={w.socials?.facebooks || []} />
              <SocialBlock icon={Twitter} label="Twitter" items={w.socials?.twitters || []} />
              <SocialBlock icon={Youtube} label="YouTube" items={w.socials?.youtubes || []} />
              <SocialBlock icon={Globe} label="TikTok" items={w.socials?.tiktoks || []} />
            </div>
          </Card>
        );
      })}
      {!wc.data?.length && <p className="py-8 text-center text-sm text-slate-500">No website contacts yet.</p>}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{title} ({items.length})</div>
      <div className="space-y-1">
        {items.length ? items.map((v) => (
          <div key={v} className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white/80 px-2.5 py-1 text-xs text-slate-700">
            <span className="truncate">{v}</span>
            <CopyButton value={v} />
          </div>
        )) : <span className="text-xs text-slate-400">—</span>}
      </div>
    </div>
  );
}

function SocialBlock({ icon: Icon, label, items }: { icon: typeof Globe; label: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/70 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Icon className="h-3.5 w-3.5" /> {label}</div>
      <div className="text-xs text-slate-700">{items.length ? items.length : "—"}</div>
    </div>
  );
}
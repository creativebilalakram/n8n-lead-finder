import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Briefcase, UserSearch, Mail, Activity } from "lucide-react";
import { listBusinesses, listJobs, listDecisionMakers, listEmails, startEnrichment } from "@/lib/contacts-db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/contacts/")({
  component: OverviewPage,
});

function OverviewPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const businesses = useQuery({ queryKey: ["contacts-businesses"], queryFn: listBusinesses, refetchInterval: 6000 });
  const jobs = useQuery({ queryKey: ["contacts-jobs"], queryFn: () => listJobs(10), refetchInterval: 6000 });
  const dms = useQuery({ queryKey: ["contacts-dms-all"], queryFn: () => listDecisionMakers() });
  const emails = useQuery({ queryKey: ["contacts-emails-all"], queryFn: listEmails });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Business name required");
    setSubmitting(true);
    try {
      const res = await startEnrichment(name.trim(), website.trim() || null);
      if (res.alreadyRunning) toast.info("Enrichment already running for this business");
      else toast.success("Full enrichment started");
      setName(""); setWebsite("");
      qc.invalidateQueries({ queryKey: ["contacts-jobs"] });
      qc.invalidateQueries({ queryKey: ["contacts-businesses"] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally { setSubmitting(false); }
  }

  const running = (jobs.data || []).filter((j) => j.status === "running").length;

  return (
    <div className="space-y-6">
      <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-900">Run Full Enrichment</h2>
        </div>
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="Business name *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Website (optional)" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <Button type="submit" disabled={submitting} className="bg-gradient-to-br from-indigo-500 to-fuchsia-500">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run pipeline"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Runs Website Enrichment → Decision Maker Finder → LinkedIn → Email in sequence.</p>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat icon={Briefcase} label="Businesses" value={businesses.data?.length ?? 0} tone="indigo" />
        <Stat icon={UserSearch} label="Decision makers" value={dms.data?.length ?? 0} tone="fuchsia" />
        <Stat icon={Mail} label="Emails found" value={emails.data?.length ?? 0} tone="emerald" />
        <Stat icon={Activity} label="Running pipelines" value={running} tone="amber" />
      </div>

      <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent runs</h2>
        <div className="space-y-2">
          {(jobs.data || []).map((j) => {
            const biz = (businesses.data || []).find((b) => b.id === j.business_id);
            return (
              <div key={j.id} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{biz?.name || j.business_id}</div>
                  <div className="truncate text-xs text-slate-500">{biz?.website || ""}</div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  j.status === "running" ? "bg-amber-100 text-amber-700"
                  : j.status === "completed" ? "bg-emerald-100 text-emerald-700"
                  : "bg-rose-100 text-rose-700"
                }`}>{j.status}</span>
              </div>
            );
          })}
          {!jobs.data?.length && <p className="text-sm text-slate-500">No runs yet. Start one above.</p>}
        </div>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Sparkles; label: string; value: number; tone: string }) {
  const toneMap: Record<string, string> = {
    indigo: "from-indigo-500 to-blue-500",
    fuchsia: "from-fuchsia-500 to-pink-500",
    emerald: "from-emerald-500 to-teal-500",
    amber: "from-amber-500 to-orange-500",
  };
  return (
    <Card className="border-white/60 bg-white/70 p-4 backdrop-blur-md">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${toneMap[tone]} text-white`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </Card>
  );
}
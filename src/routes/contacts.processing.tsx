import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import { listBusinesses, listJobs } from "@/lib/contacts-db";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/contacts/processing")({ component: Page });

const STEPS = [
  { key: "website", label: "Website" },
  { key: "decision_makers", label: "Decision Makers" },
  { key: "emails", label: "LinkedIn → Email" },
];

function Page() {
  const jobs = useQuery({ queryKey: ["contacts-jobs-all"], queryFn: () => listJobs(50), refetchInterval: 4000 });
  const businesses = useQuery({ queryKey: ["contacts-businesses"], queryFn: listBusinesses });
  const bizMap = useMemo(() => Object.fromEntries((businesses.data || []).map((b) => [b.id, b])), [businesses.data]);

  return (
    <div className="space-y-3">
      {(jobs.data || []).map((j) => {
        const b = bizMap[j.business_id];
        return (
          <Card key={j.id} className="border-white/60 bg-white/70 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-900">{b?.name || j.business_id}</div>
                <div className="text-xs text-slate-500">{b?.website || ""}</div>
              </div>
              <span className="text-xs text-slate-500">{new Date(j.started_at).toLocaleString()}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {STEPS.map((s) => {
                const st = j.steps?.[s.key];
                const status = st?.status || "pending";
                return (
                  <div key={s.key} className="flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm">
                    {status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                      : status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      : status === "failed" ? <XCircle className="h-4 w-4 text-rose-500" />
                      : <Circle className="h-4 w-4 text-slate-300" />}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{s.label}</div>
                      <div className="truncate text-xs text-slate-500">
                        {st?.error ? st.error
                          : st?.counts ? Object.entries(st.counts).map(([k, v]) => `${k}: ${v}`).join(" · ")
                          : status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {j.error && <div className="mt-2 text-xs text-rose-600">{j.error}</div>}
          </Card>
        );
      })}
      {!jobs.data?.length && <p className="py-8 text-center text-sm text-slate-500">No jobs yet.</p>}
    </div>
  );
}
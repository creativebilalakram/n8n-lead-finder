import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ExternalLink, Mail, Star, StarOff } from "lucide-react";
import { listBusinesses, listDecisionMakers, listEmails, updateDecisionMaker } from "@/lib/contacts-db";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";

export const Route = createFileRoute("/contacts/decision-makers")({ component: DMPage });

function DMPage() {
  const qc = useQueryClient();
  const dms = useQuery({ queryKey: ["contacts-dms-all"], queryFn: () => listDecisionMakers(), refetchInterval: 8000 });
  const businesses = useQuery({ queryKey: ["contacts-businesses"], queryFn: listBusinesses });
  const emails = useQuery({ queryKey: ["contacts-emails-all"], queryFn: listEmails });
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<string>("all");

  const bizMap = useMemo(() => Object.fromEntries((businesses.data || []).map((b) => [b.id, b])), [businesses.data]);
  const emailMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const e of emails.data || []) (m[e.decision_maker_id] ||= []).push(e.email);
    return m;
  }, [emails.data]);

  const rows = useMemo(() => {
    let r = dms.data || [];
    if (priority !== "all") r = r.filter((d) => d.priority === priority);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((d) =>
        (d.person_name || "").toLowerCase().includes(s) ||
        (d.person_title || "").toLowerCase().includes(s) ||
        (bizMap[d.business_id]?.name || "").toLowerCase().includes(s),
      );
    }
    return [...r].sort((a, b) => (b.manual_score_override ?? b.decision_maker_score) - (a.manual_score_override ?? a.decision_maker_score));
  }, [dms.data, q, priority, bizMap]);

  async function toggleOutreach(id: string, current: boolean) {
    await updateDecisionMaker(id, { added_to_outreach: !current });
    qc.invalidateQueries({ queryKey: ["contacts-dms-all"] });
  }
  async function bump(id: string, delta: number, base: number) {
    await updateDecisionMaker(id, { manual_score_override: base + delta });
    qc.invalidateQueries({ queryKey: ["contacts-dms-all"] });
  }

  return (
    <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search name, title, company…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        {(["all", "High", "Medium", "Low"] as const).map((p) => (
          <Button key={p} size="sm" variant={priority === p ? "default" : "outline"} onClick={() => setPriority(p)}>{p}</Button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{rows.length} people</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">LinkedIn</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const e = emailMap[d.id] || [];
              const score = d.manual_score_override ?? d.decision_maker_score;
              return (
                <tr key={d.id} className="border-t border-slate-200/60 hover:bg-white/60">
                  <td className="px-3 py-2 font-medium text-slate-900">{d.person_name || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{d.person_title || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{bizMap[d.business_id]?.name || "—"}</td>
                  <td className="px-3 py-2"><span className="font-semibold text-slate-900">{score}</span></td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.priority === "High" ? "bg-rose-100 text-rose-700"
                      : d.priority === "Medium" ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-700"
                    }`}>{d.priority}</span>
                  </td>
                  <td className="px-3 py-2">
                    {d.person_profile_url ? (
                      <div className="flex items-center gap-1">
                        <a href={d.person_profile_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline"><ExternalLink className="h-3.5 w-3.5" /></a>
                        <CopyButton value={d.person_profile_url} />
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {e.length ? (
                      <div className="flex flex-col gap-1">
                        {e.map((em) => (
                          <div key={em} className="flex items-center gap-1">
                            <span className="text-xs text-slate-700">{em}</span>
                            <CopyButton value={em} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => bump(d.id, 10, score)}><Star className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => bump(d.id, -10, score)}><StarOff className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant={d.added_to_outreach ? "default" : "outline"} className="h-7 gap-1 px-2 text-xs" onClick={() => toggleOutreach(d.id, d.added_to_outreach)}>
                        <Mail className="h-3 w-3" /> {d.added_to_outreach ? "In outreach" : "Add"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="py-8 text-center text-sm text-slate-500">No decision makers yet — run enrichment from the Overview tab.</p>}
      </div>
    </Card>
  );
}
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { listBusinesses, listDecisionMakers, listEmails } from "@/lib/contacts-db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";

export const Route = createFileRoute("/contacts/emails")({ component: Page });

function Page() {
  const emails = useQuery({ queryKey: ["contacts-emails-all"], queryFn: listEmails, refetchInterval: 8000 });
  const dms = useQuery({ queryKey: ["contacts-dms-all"], queryFn: () => listDecisionMakers() });
  const businesses = useQuery({ queryKey: ["contacts-businesses"], queryFn: listBusinesses });

  const dmMap = useMemo(() => Object.fromEntries((dms.data || []).map((d) => [d.id, d])), [dms.data]);
  const bizMap = useMemo(() => Object.fromEntries((businesses.data || []).map((b) => [b.id, b])), [businesses.data]);

  function exportCsv() {
    const rows = ["email,person,title,company,confidence"];
    for (const e of emails.data || []) {
      const d = dmMap[e.decision_maker_id];
      const b = bizMap[e.business_id];
      rows.push([e.email, d?.person_name || "", d?.person_title || "", b?.name || "", e.confidence || ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "emails.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Emails resolved ({emails.data?.length ?? 0})</h2>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-3.5 w-3.5" /> Export CSV</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(emails.data || []).map((e) => {
              const d = dmMap[e.decision_maker_id];
              const b = bizMap[e.business_id];
              return (
                <tr key={e.id} className="border-t border-slate-200/60 hover:bg-white/60">
                  <td className="px-3 py-2 font-medium text-slate-900">{e.email}</td>
                  <td className="px-3 py-2 text-slate-600">{d?.person_name || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{b?.name || "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{e.confidence || "—"}</td>
                  <td className="px-3 py-2"><CopyButton value={e.email} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!emails.data?.length && <p className="py-8 text-center text-sm text-slate-500">No emails resolved yet.</p>}
      </div>
    </Card>
  );
}
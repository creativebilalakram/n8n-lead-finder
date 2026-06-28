import { createFileRoute } from "@tanstack/react-router";
import { RELEVANT_KEYWORDS, BLACKLIST_KEYWORDS } from "@/lib/decision-maker-score";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/contacts/rules")({ component: Page });

const WEIGHTS: Array<[string, number]> = [
  ["Alecia Hardy (clinic owner) — name match", 100],
  ["owner", 90], ["founder", 85], ["ceo", 80], ["president", 80],
  ["director", 60], ["practice manager", 55], ["office manager", 50],
  ["operations", 50], ["marketing", 45], ["creative", 40], ["content", 35],
  ["dentist", 30], ["implant", 20], ["cosmetic", 20],
];

function Page() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Relevant title keywords</h3>
        <p className="mb-3 text-xs text-slate-500">A person passes if their title contains one of these AND confidence is High or Medium.</p>
        <div className="flex flex-wrap gap-1.5">
          {RELEVANT_KEYWORDS.map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}
        </div>
      </Card>
      <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Blacklist</h3>
        <p className="mb-3 text-xs text-slate-500">Titles containing any of these are removed.</p>
        <div className="flex flex-wrap gap-1.5">
          {BLACKLIST_KEYWORDS.map((k) => <Badge key={k} variant="destructive">{k}</Badge>)}
        </div>
      </Card>
      <Card className="border-white/60 bg-white/70 p-5 backdrop-blur-md md:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Score weights</h3>
        <p className="mb-3 text-xs text-slate-500">Priority: High ≥ 70, Medium ≥ 40, Low &lt; 40. You can manually promote/demote on the Decision Makers tab.</p>
        <div className="grid gap-1.5 md:grid-cols-3">
          {WEIGHTS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-sm">
              <span className="text-slate-700">{k}</span>
              <span className="font-semibold text-indigo-600">+{v}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
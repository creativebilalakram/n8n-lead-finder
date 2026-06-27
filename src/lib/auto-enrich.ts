import { supabase } from "@/integrations/supabase/client";

// Client-side trigger: finds the qualified "Hot" leads (lead_score >= 85)
// in a freshly saved search run and fires the background auto-enrich
// orchestrator for each. Concurrency is capped so we don't slam the
// edge runtime; failures per lead are swallowed.
export async function triggerAutoEnrichForRun(
  searchRunId: string,
  opts: { minScore?: number; concurrency?: number } = {},
) {
  const minScore = opts.minScore ?? 85;
  const concurrency = opts.concurrency ?? 2;

  const { data, error } = await supabase
    .from("leads")
    .select("id, website, lead_score, lead_tier, auto_enrich_status")
    .eq("search_run_id", searchRunId)
    .eq("passed", true)
    .gte("lead_score", minScore);
  if (error || !data?.length) return { triggered: 0 };

  const queue = data.filter((l) => !l.auto_enrich_status).map((l) => l.id);
  let i = 0;
  let triggered = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const leadId = queue[idx];
      try {
        await fetch("/api/public/auto-enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        });
        triggered++;
      } catch {
        /* swallow */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { triggered };
}

// Single-lead trigger (used by manual "Re-run automation" buttons).
export async function triggerAutoEnrichLead(leadId: string, force = false) {
  const res = await fetch("/api/public/auto-enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId, force }),
  });
  return res.json().catch(() => ({}));
}
import { applyFiltersToLead, loadFilterSettings } from "./filter-settings";
import { leadIdentityKey } from "./lead-identity";
import { fetchCompactLeads, getLiveLeadSets } from "./leads-query";
import type { Lead } from "./lead-types";

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
  const [settings, rawLeads] = await Promise.all([
    loadFilterSettings(),
    fetchCompactLeads(searchRunId),
  ]);
  const { qualified } = getLiveLeadSets(rawLeads, settings);
  const queue = qualified
    .filter((l) => (l.leadScore ?? 0) >= minScore)
    .filter((l) => !(l as Record<string, unknown>).autoEnrichStatus)
    .map((l) => l.id as string)
    .filter(Boolean);
  if (!queue.length) return { triggered: 0 };
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

function isFailedStatus(status: string | null): boolean {
  return status === "error" || status === "failed";
}

function autoStatus(lead: Lead): string | null {
  return ((lead as Record<string, unknown>).autoEnrichStatus as string | null) ?? null;
}

function leadTime(lead: Lead): number {
  const raw = (lead as Record<string, unknown>).createdAtIso;
  return typeof raw === "string" ? new Date(raw).getTime() || 0 : 0;
}

function preferQueueLead(candidate: Lead, existing: Lead): boolean {
  const scoreDiff = (candidate.leadScore ?? 0) - (existing.leadScore ?? 0);
  if (scoreDiff !== 0) return scoreDiff > 0;
  return leadTime(candidate) > leadTime(existing);
}

// Backfill trigger: finds every currently qualified lead across ALL runs that
// hasn't been auto-enriched yet. Failed leads are skipped by default so the
// system doesn't burn credits retrying known-bad sites/handles.
export async function triggerAutoEnrichBacklog(
  opts: {
    minScore?: number;
    concurrency?: number;
    includeFailed?: boolean;
    onlyFailed?: boolean;
    force?: boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
) {
  const minScore = opts.minScore ?? 85;
  const concurrency = opts.concurrency ?? 2;
  const includeFailed = opts.includeFailed ?? false;
  const onlyFailed = opts.onlyFailed ?? false;
  const force = opts.force ?? false;

  const [settings, rawLeads] = await Promise.all([loadFilterSettings(), fetchCompactLeads()]);
  const qualified = rawLeads
    .map((lead) => applyFiltersToLead(lead, settings))
    .filter((lead) => lead.passed);

  const queueMap = new Map<string, Lead>();
  for (const lead of qualified
    .filter((l) => (l.leadScore ?? 0) >= minScore)
    .filter((l) => {
      const s = autoStatus(l);
      if (force) return true;
      if (onlyFailed) return isFailedStatus(s);
      if (!s) return true;
      if (includeFailed && isFailedStatus(s)) return true;
      return false;
    })) {
    const key = leadIdentityKey(lead);
    const existing = queueMap.get(key);
    if (!existing || preferQueueLead(lead, existing)) queueMap.set(key, lead);
  }

  const queue = [...queueMap.values()].map((l) => l.id as string).filter(Boolean);

  const total = queue.length;
  let i = 0;
  let triggered = 0;
  let skipped = 0;
  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const leadId = queue[idx];
      try {
        const res = await fetch("/api/public/auto-enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, force, retryFailed: includeFailed || onlyFailed }),
        });
        const data = (await res.json().catch(() => ({}))) as { skipped?: string };
        if (data?.skipped) skipped++;
        else triggered++;
      } catch {
        /* swallow */
      }
      opts.onProgress?.(triggered + skipped, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return { triggered, skipped, total };
}

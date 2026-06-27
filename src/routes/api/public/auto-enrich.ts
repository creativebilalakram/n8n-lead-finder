import { createFileRoute } from "@tanstack/react-router";

// Background-style orchestrator: given a qualified leadId, automatically
// runs website screenshot+modernity scoring; if score < 7, additionally
// fires Brand DNA + Instagram analysis in parallel. Each step is wrapped
// in its own try/catch so one failure doesn't abort the rest.
//
// Designed to be called fire-and-forget from the client right after a
// search/import saves qualified leads. Idempotent: skips leads that are
// already running or already finished within the last 24h.

type StepLog = {
  step: string;
  status: "ok" | "error" | "skipped";
  detail?: string;
  at: string;
};

async function patchLead(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
  body: Record<string, unknown>,
) {
  await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const Route = createFileRoute("/api/public/auto-enrich")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: "Supabase not configured" }, { status: 500 });
        }

        let body: { leadId?: string; force?: boolean } = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const { leadId, force } = body;
        if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        // 1) Load lead
        const getRes = await fetch(
          `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=id,website,lead_score,lead_tier,passed,auto_enrich_status,auto_enrich_finished_at,website_modern_score`,
          { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
        );
        if (!getRes.ok) return Response.json({ error: "Lead fetch failed" }, { status: 502 });
        const rows = (await getRes.json()) as Array<Record<string, unknown>>;
        const lead = rows[0];
        if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

        // 2) Idempotency gate
        const status = lead.auto_enrich_status as string | null;
        const finishedAt = lead.auto_enrich_finished_at as string | null;
        if (!force) {
          if (status === "running") {
            return Response.json({ leadId, skipped: "already_running" });
          }
          if (status === "error") {
            return Response.json({ leadId, skipped: "previously_failed" });
          }
          if (status === "done" && finishedAt) {
            const ageMs = Date.now() - new Date(finishedAt).getTime();
            if (ageMs < 24 * 60 * 60 * 1000) {
              return Response.json({ leadId, skipped: "recently_done" });
            }
          }
        }

        // 3) Mark running
        const steps: StepLog[] = [];
        await patchLead(supabaseUrl, serviceKey, leadId, {
          auto_enrich_status: "running",
          auto_enrich_started_at: new Date().toISOString(),
          auto_enrich_error: null,
          auto_enrich_steps: steps,
        });

        const website = (lead.website as string | null)?.trim() || null;

        // No website → record and exit cleanly.
        if (!website) {
          steps.push({
            step: "website",
            status: "skipped",
            detail: "No website found",
            at: new Date().toISOString(),
          });
          await patchLead(supabaseUrl, serviceKey, leadId, {
            auto_enrich_status: "done",
            auto_enrich_finished_at: new Date().toISOString(),
            auto_enrich_steps: steps,
          });
          return Response.json({ leadId, status: "done", note: "no_website", steps });
        }

        // Resolve base URL for sibling internal API calls
        const origin = new URL(request.url).origin;

        // 4) Website analysis (screenshot + AI modernity score)
        let websiteScore: number | null = (lead.website_modern_score as number | null) ?? null;
        let websiteFailure: string | null = null;
        try {
          const r = await fetch(`${origin}/api/public/website/analyze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId, url: website }),
          });
          const j = (await r.json().catch(() => ({}))) as { score?: number; error?: string };
          if (!r.ok) {
            websiteFailure = j.error || `HTTP ${r.status}`;
            steps.push({
              step: "website.analyze",
              status: "error",
              detail: websiteFailure,
              at: new Date().toISOString(),
            });
          } else {
            websiteScore = typeof j.score === "number" ? j.score : websiteScore;
            steps.push({
              step: "website.analyze",
              status: "ok",
              detail: `score=${websiteScore ?? "?"}`,
              at: new Date().toISOString(),
            });
          }
        } catch (e) {
          websiteFailure = e instanceof Error ? e.message : String(e);
          steps.push({
            step: "website.analyze",
            status: "error",
            detail: websiteFailure,
            at: new Date().toISOString(),
          });
        }

        if (websiteScore === null) {
          await patchLead(supabaseUrl, serviceKey, leadId, {
            auto_enrich_status: "error",
            auto_enrich_finished_at: new Date().toISOString(),
            auto_enrich_error: websiteFailure || "Website analysis failed",
            auto_enrich_steps: steps,
          });
          return Response.json({ leadId, status: "error", error: websiteFailure || "Website analysis failed", steps });
        }

        // 5) Conditional deep enrichment when site looks weak (< 7)
        const needsDeep = typeof websiteScore === "number" && websiteScore < 7;
        if (needsDeep) {
          const tasks: Array<Promise<void>> = [
            // Brand DNA
            (async () => {
              try {
                const r = await fetch(`${origin}/api/public/brand/analyze`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ leadId, url: website }),
                });
                const j = (await r.json().catch(() => ({}))) as { error?: string; score?: number };
                steps.push({
                  step: "brand.analyze",
                  status: r.ok ? "ok" : "error",
                  detail: r.ok ? `score=${j.score ?? "?"}` : j.error || `HTTP ${r.status}`,
                  at: new Date().toISOString(),
                });
              } catch (e) {
                steps.push({
                  step: "brand.analyze",
                  status: "error",
                  detail: e instanceof Error ? e.message : String(e),
                  at: new Date().toISOString(),
                });
              }
            })(),
            // Instagram
            (async () => {
              try {
                const r = await fetch(`${origin}/api/public/instagram/analyze`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ leadId }),
                });
                const j = (await r.json().catch(() => ({}))) as { error?: string; score?: number };
                steps.push({
                  step: "instagram.analyze",
                  status: r.ok ? "ok" : "error",
                  detail: r.ok ? `score=${j.score ?? "?"}` : j.error || `HTTP ${r.status}`,
                  at: new Date().toISOString(),
                });
              } catch (e) {
                steps.push({
                  step: "instagram.analyze",
                  status: "error",
                  detail: e instanceof Error ? e.message : String(e),
                  at: new Date().toISOString(),
                });
              }
            })(),
          ];
          await Promise.all(tasks);
        } else {
          steps.push({
            step: "deep-enrich",
            status: "skipped",
            detail: `website score ${websiteScore ?? "?"} >= 7, brand+ig not needed`,
            at: new Date().toISOString(),
          });
        }

        const firstError = steps.find((step) => step.status === "error");
        if (firstError) {
          const message = `${firstError.step}: ${firstError.detail || "failed"}`;
          await patchLead(supabaseUrl, serviceKey, leadId, {
            auto_enrich_status: "error",
            auto_enrich_finished_at: new Date().toISOString(),
            auto_enrich_error: message,
            auto_enrich_steps: steps,
          });
          return Response.json({ leadId, status: "error", error: message, steps });
        }

        await patchLead(supabaseUrl, serviceKey, leadId, {
          auto_enrich_status: "done",
          auto_enrich_finished_at: new Date().toISOString(),
          auto_enrich_steps: steps,
        });

        return Response.json({ leadId, status: "done", websiteScore, deepEnriched: needsDeep, steps });
      },
    },
  },
});
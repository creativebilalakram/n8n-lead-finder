import { createFileRoute } from "@tanstack/react-router";
import { buildWebsitePackage, WDP_VERSION, mergeOverrides } from "@/lib/website-package";
import {
  runWebsiteAnalysis,
  runBrandAnalysis,
  runInstagramAnalysis,
} from "@/lib/enrichment-runner.server";
import {
  extractInstagramFromPayload,
  extractInstagramTarget,
} from "@/lib/brand-dna";

// Rebuild the Website Data Package (WDP) for a single lead from its raw
// Apify payloads + stored overrides. Idempotent. Called after each
// enrichment finishes and from the "Rebuild package" button in the UI.
export const Route = createFileRoute("/api/public/website-package/rebuild")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ error: "Supabase not configured" }, { status: 500 });
        }

        let body: { leadId?: string; ensureEnriched?: boolean } = {};
        try { body = await request.json(); } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (!body.leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        const headers = {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        };

        const selectCols =
          "raw,website,website_raw,brand_dna_raw,instagram_raw,instagram_url,instagram_username," +
          "website_screenshot_url,website_modern_score,website_label,website_analysis," +
          "website_package_overrides,lead_score,lead_tier,red_flags,rejection_reasons,passed,owner_update_age_days";

        const loadLead = async () => {
          const r = await fetch(
            `${supabaseUrl}/rest/v1/leads?id=eq.${body.leadId}&select=${selectCols}`,
            { headers },
          );
          if (!r.ok) return null;
          const rows = (await r.json()) as Array<Record<string, unknown>>;
          return rows[0] ?? null;
        };

        let lead = await loadLead();
        if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

        // Ensure all enrichment payloads exist before building so the
        // Lovable prompt is never missing a section. Runs missing actors in
        // parallel; each failure is non-fatal — the package is still built.
        const enrichmentReport: Record<string, string> = {};
        if (body.ensureEnriched) {
          const website = (lead.website as string | null)?.trim() || null;
          const tasks: Array<Promise<void>> = [];
          if (website && !lead.website_screenshot_url) {
            tasks.push(
              runWebsiteAnalysis(body.leadId, website)
                .then((r) => { enrichmentReport.website = r.ok ? "ok" : `error: ${r.error}`; })
                .catch((e) => { enrichmentReport.website = `error: ${e instanceof Error ? e.message : String(e)}`; }),
            );
          }
          if (website && !lead.brand_dna_raw) {
            tasks.push(
              runBrandAnalysis(body.leadId, website)
                .then((r) => { enrichmentReport.brand = r.ok ? "ok" : `error: ${r.error}`; })
                .catch((e) => { enrichmentReport.brand = `error: ${e instanceof Error ? e.message : String(e)}`; }),
            );
          }
          if (!lead.instagram_raw) {
            const igTarget =
              extractInstagramTarget(lead.instagram_url) ||
              extractInstagramTarget(lead.instagram_username) ||
              extractInstagramFromPayload(lead.brand_dna_raw) ||
              extractInstagramFromPayload(lead.raw) ||
              extractInstagramFromPayload(lead.website_raw);
            if (igTarget) {
              tasks.push(
                runInstagramAnalysis(body.leadId, { url: igTarget.url, username: igTarget.username })
                  .then((r) => { enrichmentReport.instagram = r.ok ? "ok" : `error: ${r.error}`; })
                  .catch((e) => { enrichmentReport.instagram = `error: ${e instanceof Error ? e.message : String(e)}`; }),
              );
            } else {
              enrichmentReport.instagram = "skipped: no handle";
            }
          }
          if (tasks.length) {
            await Promise.all(tasks);
            // Reload with fresh enrichment data before building the package.
            const reloaded = await loadLead();
            if (reloaded) lead = reloaded;
          }
        }

        const base = buildWebsitePackage(lead.raw as Record<string, unknown> ?? {}, {
          brandDnaRaw: lead.brand_dna_raw,
          instagramRaw: lead.instagram_raw,
          websiteScreenshot: (lead.website_screenshot_url as string | null) ?? null,
          websiteScore: (lead.website_modern_score as number | null) ?? null,
          websiteLabel: (lead.website_label as string | null) ?? null,
          websiteAnalysis: (lead.website_analysis as string | null) ?? null,
          leadIntel: {
            score: (lead.lead_score as number | null) ?? null,
            tier: (lead.lead_tier as string | null) ?? null,
            redFlags: lead.red_flags,
            rejectionReasons: lead.rejection_reasons,
            passed: (lead.passed as boolean | null) ?? null,
            ownerUpdateAgeDays: (lead.owner_update_age_days as number | null) ?? null,
          },
        });
        const overrides = lead.website_package_overrides as Record<string, unknown> | null;
        const pkg = overrides ? mergeOverrides(base, overrides as never) : base;

        // Persist is best-effort — never block the caller from getting
        // the freshly-built package, even if Supabase's PATCH flakes on
        // very large jsonb payloads.
        let persisted = true;
        let persistDetail: string | undefined;
        try {
          const patchRes = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${body.leadId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              website_package: pkg,
              website_package_version: WDP_VERSION,
              website_package_built_at: new Date().toISOString(),
            }),
          });
          if (!patchRes.ok) {
            persisted = false;
            persistDetail = await patchRes.text();
            console.error("[website-package.rebuild] persist failed", patchRes.status, persistDetail);
          }
        } catch (e) {
          persisted = false;
          persistDetail = e instanceof Error ? e.message : String(e);
          console.error("[website-package.rebuild] persist threw", persistDetail);
        }
        return Response.json({
          ok: true,
          version: WDP_VERSION,
          package: pkg,
          persisted,
          persistDetail,
          enrichment: body.ensureEnriched ? enrichmentReport : undefined,
        });
      },
    },
  },
});
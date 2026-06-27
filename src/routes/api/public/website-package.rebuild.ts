import { createFileRoute } from "@tanstack/react-router";
import { buildWebsitePackage, WDP_VERSION, mergeOverrides } from "@/lib/website-package";

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

        let body: { leadId?: string } = {};
        try { body = await request.json(); } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        if (!body.leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        const headers = {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        };

        const getRes = await fetch(
          `${supabaseUrl}/rest/v1/leads?id=eq.${body.leadId}&select=raw,brand_dna_raw,instagram_raw,website_screenshot_url,website_modern_score,website_label,website_analysis,website_package_overrides,lead_score,lead_tier,red_flags,rejection_reasons,passed,owner_update_age_days`,
          { headers },
        );
        if (!getRes.ok) {
          return Response.json({ error: "Lead fetch failed", detail: await getRes.text() }, { status: 502 });
        }
        const rows = (await getRes.json()) as Array<Record<string, unknown>>;
        const lead = rows[0];
        if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });

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
        return Response.json({ ok: true, version: WDP_VERSION, package: pkg, persisted, persistDetail });
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";
import { extractBrandDnaInsights } from "@/lib/brand-dna";

// Run the solutionssmart/brand-dna Apify actor on a lead's website, then score
// the returned brand system deterministically. AI is only used by website analysis.
export const Route = createFileRoute("/api/public/brand/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apifyToken = process.env.APIFY_TOKEN;
        if (!apifyToken) return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });

        let body: { leadId?: string; url?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const { leadId, url } = body;
        if (!leadId || !url) return Response.json({ error: "leadId and url required" }, { status: 400 });

        let startUrl = url.trim();
        if (!/^https?:\/\//i.test(startUrl)) startUrl = "https://" + startUrl;

        // 1) Apify brand-dna actor (sync — can take a while; long sites may time out at the edge)
        const apifyRes = await fetch(
          `https://api.apify.com/v2/acts/solutionssmart~brand-dna/run-sync-get-dataset-items?token=${apifyToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adaptiveConcurrency: true,
              captureScreenshot: true,
              debug: false,
              extractImageColors: true,
              forceRefresh: false,
              includeBlog: true,
              outputComparison: false,
              outputDiff: false,
              outputPages: true,
              respectRobotsTxt: true,
              startUrl,
              translationBatchMode: true,
              useLanguageDetector: true,
              useProxy: true,
              useRenderingFallback: true,
              useTranslation: false,
            }),
          },
        );
        if (!apifyRes.ok) {
          const t = await apifyRes.text();
          return Response.json({ error: `Brand DNA scrape failed: ${apifyRes.status}`, detail: t.slice(0, 400) }, { status: 502 });
        }
        const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
        const item = items?.[0];
        if (!item) return Response.json({ error: "Brand DNA returned no data" }, { status: 502 });

        // 2) Deterministic brand strength scoring (no AI). The actor nests the
        // real values under brandKit.assetFingerprint + brandKit.brandSummary.
        const insights = extractBrandDnaInsights(item);
        if (!insights) return Response.json({ error: "Brand DNA data could not be parsed" }, { status: 502 });
        const { score, label, summary, screenshotUrl } = insights;

        // 3) Persist
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              brand_dna_score: score,
              brand_dna_label: label,
              brand_dna_summary: summary,
              brand_dna_screenshot_url: screenshotUrl,
              brand_dna_raw: item,
              brand_dna_analyzed_at: new Date().toISOString(),
            }),
          });
        }

        try {
          const { rebuildWebsitePackageServer } = await import("@/lib/website-package.server");
          await rebuildWebsitePackageServer(leadId);
        } catch { /* non-fatal */ }

        return Response.json({ leadId, score, label, summary, screenshotUrl, insights });
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";

// Run the solutionssmart/brand-dna Apify actor on a lead's website, then ask
// Lovable AI to score brand strength 1-10 with a one-line summary.
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
              extractImageColors: false,
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

        const screenshotUrl =
          (item.screenshotUrl as string | undefined) ||
          (item.screenshot as string | undefined) ||
          null;

        // 2) Deterministic brand strength scoring (no AI)
        const palette = Array.isArray((item as { palette?: unknown[] }).palette)
          ? ((item as { palette: unknown[] }).palette).length
          : 0;
        const fonts = Array.isArray((item as { fonts?: unknown[] }).fonts)
          ? ((item as { fonts: unknown[] }).fonts).length
          : 0;
        const pages = Array.isArray((item as { pages?: unknown[] }).pages)
          ? ((item as { pages: unknown[] }).pages).length
          : 0;
        const hasLogo = Boolean(
          (item as { logo?: unknown }).logo ||
            (item as { logoUrl?: unknown }).logoUrl,
        );
        const hasDescription = Boolean(
          (item as { description?: string }).description &&
            String((item as { description: string }).description).length > 40,
        );
        let score = 1;
        if (hasLogo) score += 2;
        if (hasDescription) score += 1;
        if (palette >= 3) score += 2; else if (palette >= 1) score += 1;
        if (fonts >= 2) score += 2; else if (fonts >= 1) score += 1;
        if (pages >= 8) score += 2; else if (pages >= 3) score += 1;
        score = Math.max(1, Math.min(10, score));
        const label = score <= 3 ? "WEAK" : score <= 5 ? "GENERIC" : score <= 7 ? "SOLID" : "STRONG";
        const summary = `${pages} pages · ${palette}-color palette · ${fonts} font${fonts === 1 ? "" : "s"}${hasLogo ? " · logo" : " · no logo"}${hasDescription ? "" : " · missing description"}`;

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

        return Response.json({ leadId, score, label, summary, screenshotUrl });
      },
    },
  },
});
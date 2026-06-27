import { createFileRoute } from "@tanstack/react-router";

// Run the solutionssmart/brand-dna Apify actor on a lead's website, then ask
// Lovable AI to score brand strength 1-10 with a one-line summary.
export const Route = createFileRoute("/api/public/brand/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apifyToken = process.env.APIFY_TOKEN;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!apifyToken) return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });
        if (!lovableKey) return Response.json({ error: "LOVABLE_API_KEY not configured" }, { status: 500 });

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

        // Trim the payload for the AI prompt — brand-dna output can be huge.
        const slim = JSON.stringify(item).slice(0, 12000);

        // 2) AI summarize & score brand strength
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": lovableKey,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content:
                  "You are a brand strategist. Given Brand DNA scrape output (positioning, tone, palette, typography, messaging, content pages) for a local business website, score overall brand strength 1-10 (10 = distinctive, premium, cohesive brand; 1 = generic, weak, inconsistent). Label: 1-3 'WEAK', 4-5 'GENERIC', 6-7 'SOLID', 8-10 'STRONG'. Respond ONLY as compact JSON: {\"score\":<int 1-10>,\"label\":\"WEAK|GENERIC|SOLID|STRONG\",\"summary\":\"<one tight sentence describing the brand's personality + biggest gap>\"}",
              },
              { role: "user", content: `Brand DNA payload (truncated):\n${slim}` },
            ],
          }),
        });
        if (!aiRes.ok) {
          const t = await aiRes.text();
          return Response.json({ error: `AI scoring failed: ${aiRes.status}`, detail: t.slice(0, 400) }, { status: 502 });
        }
        const aiJson = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const raw = aiJson.choices?.[0]?.message?.content ?? "";
        let score = 0;
        let label = "UNKNOWN";
        let summary = "";
        try {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]) as { score?: number; label?: string; summary?: string };
            score = Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 0)));
            label = (parsed.label || "").toUpperCase() ||
              (score <= 3 ? "WEAK" : score <= 5 ? "GENERIC" : score <= 7 ? "SOLID" : "STRONG");
            summary = parsed.summary || "";
          }
        } catch { /* ignore */ }
        if (!score) return Response.json({ error: "AI returned no parseable score", raw }, { status: 502 });

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
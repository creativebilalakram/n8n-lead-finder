import { createFileRoute } from "@tanstack/react-router";

// Screenshot a lead's website via Apify, then ask Lovable AI to score modernity 1-10.
// Persists result to the leads row.
export const Route = createFileRoute("/api/public/website/analyze")({
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

        let normalized = url.trim();
        if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

        // 1) Apify screenshot-url (run-sync, returns dataset items)
        const apifyRes = await fetch(
          `https://api.apify.com/v2/acts/apify~screenshot-url/run-sync-get-dataset-items?token=${apifyToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              delay: 0,
              proxy: { useApifyProxy: true },
              scrollToBottom: true,
              urls: [{ url: normalized }],
              waitUntil: "load",
              waitUntilNetworkIdleAfterScroll: false,
            }),
          },
        );
        if (!apifyRes.ok) {
          const t = await apifyRes.text();
          return Response.json({ error: `Screenshot failed: ${apifyRes.status}`, detail: t.slice(0, 400) }, { status: 502 });
        }
        const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
        const item = items?.[0] ?? {};
        const screenshotUrl =
          (item.screenshotUrl as string | undefined) ||
          (item.screenshot as string | undefined) ||
          (item.imageUrl as string | undefined);
        if (!screenshotUrl) {
          return Response.json({ error: "Apify returned no screenshot URL", item }, { status: 502 });
        }

        // 2) Lovable AI vision scoring
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
                  "You are a senior web design auditor. Look at the website screenshot. Score its modern design from 1-10 (10 = world-class modern premium, 1 = extremely outdated 90s/early 2000s look). If below 6, label it 'OUTDATED'; 6-7 'DATED'; 8-9 'MODERN'; 10 'PREMIUM'. Respond ONLY as compact JSON: {\"score\": <int 1-10>, \"label\": \"OUTDATED|DATED|MODERN|PREMIUM\", \"reason\": \"<one short sentence>\"}",
              },
              {
                role: "user",
                content: [
                  { type: "text", text: `Analyze this website: ${normalized}` },
                  { type: "image_url", image_url: { url: screenshotUrl } },
                ],
              },
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
        let reason = "";
        try {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            const parsed = JSON.parse(m[0]) as { score?: number; label?: string; reason?: string };
            score = Math.max(1, Math.min(10, Math.round(Number(parsed.score) || 0)));
            label = (parsed.label || "").toUpperCase() || (score < 6 ? "OUTDATED" : score < 8 ? "DATED" : score < 10 ? "MODERN" : "PREMIUM");
            reason = parsed.reason || "";
          }
        } catch {
          /* fall through */
        }
        if (!score) {
          return Response.json({ error: "AI returned no parseable score", raw }, { status: 502 });
        }

        // 3) Persist via Supabase service role
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
              website_screenshot_url: screenshotUrl,
              website_modern_score: score,
              website_label: label,
              website_analysis: reason,
              website_analyzed_at: new Date().toISOString(),
              website_raw: item,
            }),
          });
        }

        try {
          const { rebuildWebsitePackageServer } = await import("@/lib/website-package.server");
          await rebuildWebsitePackageServer(leadId);
        } catch { /* non-fatal */ }

        return Response.json({ leadId, screenshotUrl, score, label, reason });
      },
    },
  },
});
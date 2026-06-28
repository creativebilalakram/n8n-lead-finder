import { createFileRoute } from "@tanstack/react-router";
import { runWebsiteAnalysis } from "@/lib/enrichment-runner.server";

// Screenshot a lead's website via Apify, then ask Lovable AI to score modernity 1-10.
// Persists result to the leads row.
export const Route = createFileRoute("/api/public/website/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { leadId?: string; url?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const { leadId, url } = body;
        if (!leadId || !url) return Response.json({ error: "leadId and url required" }, { status: 400 });
        try {
          const result = await runWebsiteAnalysis(leadId, url);
          if (!result.ok) {
            // Return 200 with structured fallback so the client doesn't crash on 502.
            return Response.json(
              { error: result.error, fallback: true, leadId },
              { status: 200 },
            );
          }
          return Response.json(result.data);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json(
            { error: `Website analysis crashed: ${msg}`, fallback: true, leadId },
            { status: 200 },
          );
        }
      },
    },
  },
});
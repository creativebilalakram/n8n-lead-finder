import { createFileRoute } from "@tanstack/react-router";
import { runBrandAnalysis } from "@/lib/enrichment-runner.server";

// Manual trigger for Brand DNA. Delegates to the shared async runner so it uses
// the same start → poll → fetch-items pattern as auto-enrich (Worker-safe).
export const Route = createFileRoute("/api/public/brand/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { leadId?: string; url?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const { leadId, url } = body;
        if (!leadId || !url) return Response.json({ error: "leadId and url required" }, { status: 400 });

        const res = await runBrandAnalysis(leadId, url);
        if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
        return Response.json(res.data);
      },
    },
  },
});

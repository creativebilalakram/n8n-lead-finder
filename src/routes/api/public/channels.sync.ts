import { createFileRoute } from "@tanstack/react-router";
import { runContactScraperAndMerge } from "@/lib/business-channels.server";

// POST { leadId } — runs vdrmota/contact-info-scraper for the lead's website
// (when present), merges with GBP + Instagram + Brand DNA signals using the
// smart filter (drops post/reel URLs, dedupes phones/emails, tracks sources),
// and upserts the business_channels row. Safe to call repeatedly.
export const Route = createFileRoute("/api/public/channels/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { leadId?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        if (!body.leadId) return Response.json({ error: "leadId required" }, { status: 400 });
        try {
          const res = await runContactScraperAndMerge(body.leadId);
          if (!res.ok) return Response.json({ error: res.error }, { status: 200 });
          return Response.json(res);
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }
      },
    },
  },
});
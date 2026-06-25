import { createFileRoute } from "@tanstack/react-router";
import { scoreLeads, type ScoreConfig } from "@/lib/lead-scoring";

// Poll the Apify run; when SUCCEEDED, fetch dataset, score, and return leads.
export const Route = createFileRoute("/api/public/leads/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = process.env.APIFY_TOKEN;
        if (!token) {
          return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });
        }

        const url = new URL(request.url);
        const runId = url.searchParams.get("runId");
        if (!runId) {
          return Response.json({ error: "runId required" }, { status: 400 });
        }

        const cfg: ScoreConfig = {
          reviewsMin: Number(url.searchParams.get("reviewsMin") ?? 20),
          reviewsMax: Number(url.searchParams.get("reviewsMax") ?? 150),
          ratingMin: Number(url.searchParams.get("ratingMin") ?? 4.2),
          ratingMax: Number(url.searchParams.get("ratingMax") ?? 4.8),
          activeOwnerDays: Number(url.searchParams.get("activeOwnerDays") ?? 60),
          scoreThreshold: 70,
          topOnly: false,
        };

        const runRes = await fetch(
          `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`,
        );
        if (!runRes.ok) {
          const t = await runRes.text();
          return Response.json(
            { error: `Apify status failed: ${runRes.status}`, detail: t.slice(0, 500) },
            { status: 502 },
          );
        }
        const runJson = (await runRes.json()) as {
          data?: { status?: string; defaultDatasetId?: string; stats?: unknown };
        };
        const status = runJson.data?.status ?? "UNKNOWN";
        const datasetId = runJson.data?.defaultDatasetId;

        if (status === "SUCCEEDED" && datasetId) {
          const dsRes = await fetch(
            `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json`,
          );
          if (!dsRes.ok) {
            const t = await dsRes.text();
            return Response.json(
              { error: `Apify dataset fetch failed: ${dsRes.status}`, detail: t.slice(0, 500) },
              { status: 502 },
            );
          }
          const items = (await dsRes.json()) as Record<string, unknown>[];
          const scored = scoreLeads(items, cfg);
          const leads = scored.filter((l) => l.passed);
          const filteredOut = scored.filter((l) => !l.passed);
          return Response.json({
            status,
            leads,
            filteredOut,
            total: items.length,
          });
        }

        if (
          status === "FAILED" ||
          status === "ABORTED" ||
          status === "TIMED-OUT"
        ) {
          return Response.json({ status, leads: [], error: `Apify run ${status}` });
        }

        // RUNNING / READY — client should keep polling
        return Response.json({ status });
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";
import { scoreLeads, type ScoreConfig } from "@/lib/lead-scoring";

// Fetch a past Apify run's dataset, score it, return leads + filteredOut.
export const Route = createFileRoute("/api/public/apify/import")({
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
            { error: `Apify run fetch failed: ${runRes.status}`, detail: t.slice(0, 500) },
            { status: 502 },
          );
        }
        const runJson = (await runRes.json()) as {
          data?: {
            status?: string;
            defaultDatasetId?: string;
            startedAt?: string;
            finishedAt?: string;
            options?: Record<string, unknown>;
          };
        };
        const data = runJson.data ?? {};
        const datasetId = data.defaultDatasetId;
        if (!datasetId) {
          return Response.json({ error: "Run has no dataset" }, { status: 400 });
        }
        if (data.status !== "SUCCEEDED") {
          return Response.json(
            { error: `Run status is ${data.status}, only SUCCEEDED can be imported` },
            { status: 400 },
          );
        }

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
          runId,
          startedAt: data.startedAt,
          finishedAt: data.finishedAt,
          leads,
          filteredOut,
          total: items.length,
        });
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";

// List recent Apify runs for the Google Places actor.
export const Route = createFileRoute("/api/public/apify/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = process.env.APIFY_TOKEN;
        if (!token) {
          return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });
        }
        const url = new URL(request.url);
        const limit = url.searchParams.get("limit") ?? "50";

        const res = await fetch(
          `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${token}&limit=${limit}&desc=true`,
        );
        if (!res.ok) {
          const t = await res.text();
          return Response.json(
            { error: `Apify list runs failed: ${res.status}`, detail: t.slice(0, 500) },
            { status: 502 },
          );
        }
        const json = (await res.json()) as {
          data?: { items?: Array<Record<string, unknown>> };
        };
        const items = json.data?.items ?? [];
        const runs = items.map((r) => ({
          id: r.id as string,
          status: r.status as string,
          startedAt: r.startedAt as string | undefined,
          finishedAt: r.finishedAt as string | undefined,
          defaultDatasetId: r.defaultDatasetId as string | undefined,
          stats: r.stats as Record<string, unknown> | undefined,
          usageTotalUsd: r.usageTotalUsd as number | undefined,
          buildNumber: r.buildNumber as string | undefined,
        }));
        return Response.json({ runs });
      },
    },
  },
});
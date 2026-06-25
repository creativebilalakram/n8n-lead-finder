import { createFileRoute } from "@tanstack/react-router";

// Start an Apify run asynchronously and return the runId.
// Returns fast (a few seconds) so we never hit the Worker timeout.
export const Route = createFileRoute("/api/public/leads/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.APIFY_TOKEN;
        if (!token) {
          return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const searchStringsArray = Array.isArray(body.searchStringsArray)
          ? (body.searchStringsArray as string[])
          : [];
        if (!searchStringsArray.length) {
          return Response.json({ error: "searchStringsArray is required" }, { status: 400 });
        }

        const apifyInput = {
          coordinates: { lat: null, lng: null },
          countryCode: body.countryCode ?? "us",
          enrichSocialProfiles: false,
          excludeCategorizedPlaces: false,
          exportPlaceUrls: false,
          extractEmailAndContacts: true,
          includeWebResults: true,
          language: "en",
          maxCrawledPlacesPerSearch: Number(body.maxCrawledPlacesPerSearch ?? 10),
          maxImages: 20,
          maxReviews: 10,
          maximumLeadsEnrichmentRecords: 0,
          personalData: true,
          polygon: { type: "Polygon", coordinates: [] },
          reviewsSort: "newest",
          reviewsTranslation: "originalAndTranslated",
          scrapeContacts: true,
          scrapeDirectories: false,
          scrapeImageAuthors: true,
          scrapeOrderOnline: false,
          scrapePlaceDetailPage: true,
          scrapeResponseFromOwnerText: true,
          scrapeReviewId: true,
          scrapeReviewUrl: true,
          scrapeReviewerId: true,
          scrapeReviewerName: true,
          scrapeReviewerUrl: true,
          scrapeReviewsPersonalData: true,
          scrapeTableReservationProvider: false,
          searchPagePaginationUrl: "",
          searchStringsArray,
          skipClosedPlaces: false,
          verifyLeadsEnrichmentEmails: true,
          zoom: 10,
        };

        const res = await fetch(
          `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(apifyInput),
          },
        );

        const text = await res.text();
        if (!res.ok) {
          return Response.json(
            { error: `Apify start failed: ${res.status}`, detail: text.slice(0, 500) },
            { status: 502 },
          );
        }

        const json = JSON.parse(text) as { data?: { id?: string; defaultDatasetId?: string } };
        const runId = json.data?.id;
        const datasetId = json.data?.defaultDatasetId;
        if (!runId) {
          return Response.json({ error: "No runId returned from Apify" }, { status: 502 });
        }

        return Response.json({ runId, datasetId });
      },
    },
  },
});
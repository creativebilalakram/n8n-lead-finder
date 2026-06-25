import { createFileRoute } from "@tanstack/react-router";

const WEBHOOK_URL =
  "https://creativebilalakram2.app.n8n.cloud/webhook/3aacc2c2-521b-4406-af35-4784f02ab2cd";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),
      POST: async ({ request }) => {
        try {
          const body = await request.text();
          const upstream = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body,
          });
          const text = await upstream.text();
          return new Response(text, {
            status: upstream.status,
            headers: {
              "Content-Type":
                upstream.headers.get("content-type") ?? "application/json",
              ...corsHeaders,
            },
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Upstream request failed";
          return new Response(
            JSON.stringify({ error: message }),
            {
              status: 502,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const N8N_WEBHOOK_URL =
  "https://creativebilalakram2.app.n8n.cloud/webhook/3aacc2c2-521b-4406-af35-4784f02ab2cd";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Origin, X-Requested-With",
  "Access-Control-Max-Age": "86400",
} as const;

const leadRequestSchema = z
  .object({
    searchStringsArray: z.array(z.string().trim().min(1)).min(1).max(50),
    countryCode: z.string().trim().min(2).max(2).transform((v) => v.toLowerCase()),
    maxCrawledPlacesPerSearch: z.coerce.number().int().min(1).max(100),
    reviewsMin: z.coerce.number().min(0).max(100000),
    reviewsMax: z.coerce.number().min(0).max(100000),
    ratingMin: z.coerce.number().min(0).max(5),
    ratingMax: z.coerce.number().min(0).max(5),
    activeOwnerDays: z.coerce.number().int().min(1).max(3650),
  })
  .superRefine((data, ctx) => {
    if (data.reviewsMax < data.reviewsMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewsMax"],
        message: "Max reviews must be greater than or equal to min reviews.",
      });
    }

    if (data.ratingMax < data.ratingMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ratingMax"],
        message: "Max rating must be greater than or equal to min rating.",
      });
    }
  });

export const Route = createFileRoute("/api/leads")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        }),

      POST: async ({ request }) => {
        const rawBody = await request.json().catch(() => null);
        const parsed = leadRequestSchema.safeParse(rawBody);

        if (!parsed.success) {
          return jsonResponse(
            {
              error: "Invalid search request.",
              details: parsed.error.issues.map((issue) => issue.message),
            },
            400,
          );
        }

        return createLeadStream(parsed.data);
      },
    },
  },
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function createLeadStream(payload: z.infer<typeof leadRequestSchema>) {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      heartbeat = setInterval(() => {
        send("progress", {
          message: "n8n is still processing the Apify scrape…",
          at: Date.now(),
        });
      }, 15_000);

      try {
        send("progress", { message: "Request received. Starting n8n workflow…" });

        const upstream = await fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const text = await upstream.text();

        if (!upstream.ok) {
          send("error", {
            message: `n8n webhook failed: ${upstream.status} ${upstream.statusText}`,
            details: text.slice(0, 600),
          });
          return;
        }

        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : [];
        } catch {
          send("error", {
            message: "n8n returned a non-JSON response.",
            details: text.slice(0, 600),
          });
          return;
        }

        send("result", { data });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : "Could not reach n8n webhook.",
        });
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        controller.close();
      }
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS,
    },
  });
}
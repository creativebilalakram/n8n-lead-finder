import { createFileRoute } from "@tanstack/react-router";

// Scrape a lead's Instagram profile via Apify, then ask Lovable AI to score it.
// Persists structured profile + AI verdict to the leads row.
export const Route = createFileRoute("/api/public/instagram/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apifyToken = process.env.APIFY_TOKEN;
        const lovableKey = process.env.LOVABLE_API_KEY;
        if (!apifyToken) return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });
        if (!lovableKey) return Response.json({ error: "LOVABLE_API_KEY not configured" }, { status: 500 });

        let body: { leadId?: string; url?: string; username?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const { leadId } = body;
        if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        // Normalize to a full instagram profile URL the actor accepts.
        const handleFromInput = (() => {
          const raw = (body.url || body.username || "").trim();
          if (!raw) return null;
          if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
          const u = raw.replace(/^@/, "");
          return `https://instagram.com/${u}`;
        })();
        if (!handleFromInput) return Response.json({ error: "Instagram url or username required" }, { status: 400 });

        // 1) Apify instagram-profile-scraper (sync)
        const apifyRes = await fetch(
          `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeAboutSection: false,
              usernames: [handleFromInput],
            }),
          },
        );
        if (!apifyRes.ok) {
          const t = await apifyRes.text();
          return Response.json({ error: `Instagram scrape failed: ${apifyRes.status}`, detail: t.slice(0, 400) }, { status: 502 });
        }
        const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
        const item = items?.[0];
        if (!item || (item as { error?: unknown }).error) {
          return Response.json({ error: "Profile not found or private", item }, { status: 404 });
        }

        const profile = {
          username: (item.username as string) ?? null,
          fullName: (item.fullName as string) ?? null,
          biography: (item.biography as string) ?? null,
          followers: typeof item.followersCount === "number" ? (item.followersCount as number) : null,
          following: typeof item.followsCount === "number" ? (item.followsCount as number) : null,
          postsCount: typeof item.postsCount === "number" ? (item.postsCount as number) : null,
          verified: Boolean(item.verified),
          isBusinessAccount: Boolean(item.isBusinessAccount),
          profilePicUrl: (item.profilePicUrl as string) ?? (item.profilePicUrlHD as string) ?? null,
          url: (item.url as string) ?? handleFromInput,
        };

        // 2) Lovable AI scoring (signal of opportunity: weak/low-activity = high score)
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
                  "You audit a local business's Instagram presence. Given followers, post count, verified/business status and bio, judge presence strength on 1-10 (10 = strong, polished, very active presence; 1 = barely-there or abandoned account). Label: 1-3 'WEAK', 4-5 'BASIC', 6-7 'DECENT', 8-10 'STRONG'. Respond ONLY as compact JSON: {\"score\":<int 1-10>,\"label\":\"WEAK|BASIC|DECENT|STRONG\",\"reason\":\"<one short sentence>\"}",
              },
              {
                role: "user",
                content: `Profile data:\n${JSON.stringify(profile)}`,
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
            label = (parsed.label || "").toUpperCase() ||
              (score <= 3 ? "WEAK" : score <= 5 ? "BASIC" : score <= 7 ? "DECENT" : "STRONG");
            reason = parsed.reason || "";
          }
        } catch { /* fall through */ }
        if (!score) return Response.json({ error: "AI returned no parseable score", raw }, { status: 502 });

        // 3) Persist
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
              instagram_url: profile.url,
              instagram_username: profile.username,
              instagram_full_name: profile.fullName,
              instagram_bio: profile.biography,
              instagram_followers: profile.followers,
              instagram_following: profile.following,
              instagram_posts_count: profile.postsCount,
              instagram_verified: profile.verified,
              instagram_is_business: profile.isBusinessAccount,
              instagram_profile_pic_url: profile.profilePicUrl,
              instagram_score: score,
              instagram_label: label,
              instagram_analysis: reason,
              instagram_raw: item,
              instagram_analyzed_at: new Date().toISOString(),
            }),
          });
        }

        return Response.json({ leadId, profile, score, label, reason });
      },
    },
  },
});
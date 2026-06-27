import { createFileRoute } from "@tanstack/react-router";
import { extractInstagramFromPayload, extractInstagramTarget } from "@/lib/brand-dna";

// Scrape a lead's Instagram profile via Apify, then score it deterministically.
// Persists structured profile + verdict to the leads row.
export const Route = createFileRoute("/api/public/instagram/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apifyToken = process.env.APIFY_TOKEN;
        if (!apifyToken) return Response.json({ error: "APIFY_TOKEN not configured" }, { status: 500 });

        let body: { leadId?: string; url?: string; username?: string } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const { leadId } = body;
        if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        let target = extractInstagramTarget(body.url || body.username || "");

        // If the card did not pass a handle, recover it from stored Google Maps,
        // Website, or Brand DNA raw payloads. Brand DNA commonly stores it as
        // { platform: "instagram", handle, url } inside pages/socialProfiles.
        if (!target && supabaseUrl && serviceKey) {
          const dbRes = await fetch(
            `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=instagram_url,instagram_username,brand_dna_raw,raw,website_raw`,
            {
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
              },
            },
          );
          const rows = dbRes.ok ? ((await dbRes.json()) as Array<Record<string, unknown>>) : [];
          const row = rows[0];
          if (row) {
            target =
              extractInstagramTarget(row.instagram_url) ||
              extractInstagramTarget(row.instagram_username) ||
              extractInstagramFromPayload(row.brand_dna_raw) ||
              extractInstagramFromPayload(row.raw) ||
              extractInstagramFromPayload(row.website_raw);
          }
        }

        if (!target) return Response.json({ error: "Instagram profile not found in lead or Brand DNA data" }, { status: 400 });

        // 1) Apify instagram-profile-scraper (sync)
        const apifyRes = await fetch(
          `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeAboutSection: false,
              usernames: [target.username],
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
          url: (item.url as string) ?? target.url,
        };

        // 2) Deterministic presence scoring (no AI)
        const f = profile.followers ?? 0;
        const p = profile.postsCount ?? 0;
        let score = 1;
        if (f >= 10000) score = 10;
        else if (f >= 5000) score = 9;
        else if (f >= 2000) score = 8;
        else if (f >= 1000) score = 7;
        else if (f >= 500) score = 6;
        else if (f >= 200) score = 5;
        else if (f >= 50) score = 4;
        else if (f > 0) score = 3;
        if (p >= 100) score = Math.min(10, score + 1);
        else if (p < 10) score = Math.max(1, score - 1);
        if (profile.verified) score = Math.min(10, score + 1);
        const label = score <= 3 ? "WEAK" : score <= 5 ? "BASIC" : score <= 7 ? "DECENT" : "STRONG";
        const reason = `${f.toLocaleString()} followers · ${p} posts${profile.verified ? " · verified" : ""}`;

        // 3) Persist
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
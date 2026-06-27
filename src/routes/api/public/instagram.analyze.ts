import { createFileRoute } from "@tanstack/react-router";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { extractInstagramCandidatesFromPayload, extractInstagramFromPayload, extractInstagramTarget, type InstagramTarget } from "@/lib/brand-dna";

function parseCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase().replace(/,/g, "");
  const match = compact.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  if (match[2] === "k") return Math.round(base * 1_000);
  if (match[2] === "m") return Math.round(base * 1_000_000);
  if (match[2] === "b") return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function actorSaysMissing(item: Record<string, unknown> | undefined): boolean {
  if (!item) return true;
  const text = JSON.stringify({
    error: item.error,
    errorDescription: item.errorDescription,
    warning: item.warning,
    message: item.message,
  }).toLowerCase();
  return text.includes("not_found") || text.includes("not found") || text.includes("post does not exist") || text.includes("private");
}

function parseInstagramHtml(html: string, username: string): Record<string, unknown> | null {
  const title = decodeHtml(
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)/i)?.[1] ||
      "",
  ).trim();
  const description = decodeHtml(
    html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1] ||
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ||
      "",
  ).trim();
  const profilePicUrl = decodeHtml(
    html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1] || "",
  ).trim();

  const followers = parseCount(description.match(/([0-9.,]+\s*[kmb]?)\s+followers/i)?.[1]);
  const following = parseCount(description.match(/([0-9.,]+\s*[kmb]?)\s+following/i)?.[1]);
  const postsCount = parseCount(description.match(/([0-9.,]+\s*[kmb]?)\s+posts/i)?.[1]);
  const fullName = title
    .replace(/\(@[^)]+\)\s*•\s*Instagram.*$/i, "")
    .replace(/•\s*Instagram.*$/i, "")
    .trim();
  const biography = description.replace(/^.*?Followers,\s*[^,]+Following,\s*[^-–]+[-–]\s*/i, "").trim();

  if (!title && !description && !profilePicUrl) return null;
  return {
    username,
    fullName: fullName || username,
    biography: biography || description || null,
    followersCount: followers,
    followsCount: following,
    postsCount,
    verified: false,
    isBusinessAccount: false,
    profilePicUrl: profilePicUrl || null,
    url: `https://www.instagram.com/${username}/`,
    source: "instagram_public_html_fallback",
    publicHtmlMeta: { title, description, profilePicUrl },
  };
}

async function fetchInstagramHtmlFallback(username: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
  });
  const html = await res.text();
  return parseInstagramHtml(html, username);
}

function uniqTargets(values: Array<InstagramTarget | null | undefined>): InstagramTarget[] {
  const seen = new Set<string>();
  const out: InstagramTarget[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function findInstagramViaGoogle(row: Record<string, unknown> | undefined): Promise<InstagramTarget[]> {
  const title = typeof row?.title === "string" ? row.title : "";
  const website = typeof row?.website === "string" ? row.website.replace(/^https?:\/\//, "") : "";
  if (!title && !website) return [];
  const q = encodeURIComponent(`"${title || website}" Instagram`);
  try {
    const res = await fetch(`https://www.google.com/search?q=${q}`, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36" },
    });
    const html = await res.text();
    return extractInstagramCandidatesFromPayload(html).slice(0, 5);
  } catch {
    return [];
  }
}

async function scrapeInstagramCandidate(apifyToken: string, target: InstagramTarget): Promise<Record<string, unknown> | null> {
  let apifyRes: Response;
  try {
    apifyRes = await fetchWithRetry(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 75_000,
        retries: 1,
        backoffMs: 1500,
        body: JSON.stringify({ includeAboutSection: false, usernames: [target.username] }),
      },
    );
  } catch {
    return null;
  }
  if (!apifyRes.ok) return null;
  const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
  let item = items?.find((candidate) => !actorSaysMissing(candidate)) || items?.[0];
  if (actorSaysMissing(item)) item = (await fetchInstagramHtmlFallback(target.username).catch(() => null)) || item;
  return item && !actorSaysMissing(item) ? item : null;
}

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
        let row: Record<string, unknown> | undefined;

        // If the card did not pass a handle, recover it from stored Google Maps,
        // Website, or Brand DNA raw payloads. Brand DNA commonly stores it as
        // { platform: "instagram", handle, url } inside pages/socialProfiles.
        if (!target && supabaseUrl && serviceKey) {
          const dbRes = await fetch(
            `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=title,website,instagram_url,instagram_username,brand_dna_raw,raw,website_raw`,
            {
              headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
              },
            },
          );
          const rows = dbRes.ok ? ((await dbRes.json()) as Array<Record<string, unknown>>) : [];
          row = rows[0];
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

        // Try every possible handle. Brand DNA/social links are sometimes stale
        // (example: website links @elisummedspa, but live public IG is @elisum_medspa),
        // so if a candidate fails, recover alternatives from the stored payloads and Google.
        const candidates = uniqTargets([
          target,
          ...(row ? extractInstagramCandidatesFromPayload(row.brand_dna_raw) : []),
          ...(row ? extractInstagramCandidatesFromPayload(row.raw) : []),
          ...(row ? extractInstagramCandidatesFromPayload(row.website_raw) : []),
          ...(await findInstagramViaGoogle(row)),
        ]);
        let item: Record<string, unknown> | null = null;
        for (const candidate of candidates) {
          item = await scrapeInstagramCandidate(apifyToken, candidate);
          if (item) {
            target = candidate;
            break;
          }
        }
        if (!item) return Response.json({ error: "Profile not found after checking stored handles and public search", tried: candidates }, { status: 404 });

        const profile = {
          username: (item.username as string) ?? null,
          fullName: (item.fullName as string) ?? null,
          biography: (item.biography as string) ?? null,
          followers: parseCount(item.followersCount) ?? parseCount(item.followers) ?? null,
          following: parseCount(item.followsCount) ?? parseCount(item.following) ?? null,
          postsCount: parseCount(item.postsCount) ?? parseCount(item.posts) ?? null,
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

        try {
          const { rebuildWebsitePackageServer } = await import("@/lib/website-package.server");
          await rebuildWebsitePackageServer(leadId);
        } catch { /* non-fatal */ }

        return Response.json({ leadId, profile, score, label, reason });
      },
    },
  },
});
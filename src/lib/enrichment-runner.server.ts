// Server-only runners that contain the full enrichment logic. The HTTP route
// handlers under src/routes/api/public/{website,brand,instagram}.analyze.ts
// delegate to these, and the orchestrator (auto-enrich) calls them DIRECTLY
// (no self-fetch). This eliminates Cloudflare Worker self-subrequest drops
// that were silently killing the workflow before Apify ever saw a request.

import { fetchWithRetry, extractJson } from "@/lib/fetch-retry";
import {
  extractBrandDnaInsights,
  extractInstagramCandidatesFromPayload,
  extractInstagramFromPayload,
  extractInstagramTarget,
  type InstagramTarget,
} from "@/lib/brand-dna";

type RunResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
};

function ok<T extends Record<string, unknown>>(data: T): RunResult<T> {
  return { ok: true, status: 200, data };
}
function fail(status: number, error: string): RunResult {
  return { ok: false, status, error };
}

async function patchLead(leadId: string, body: Record<string, unknown>) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;
  await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function rebuildPackage(leadId: string) {
  try {
    const { rebuildWebsitePackageServer } = await import("@/lib/website-package.server");
    await rebuildWebsitePackageServer(leadId);
  } catch { /* non-fatal */ }
}

// ---------- Website ----------
export async function runWebsiteAnalysis(leadId: string, url: string): Promise<RunResult> {
  const apifyToken = process.env.APIFY_TOKEN;
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!apifyToken) return fail(500, "APIFY_TOKEN not configured");
  if (!lovableKey) return fail(500, "LOVABLE_API_KEY not configured");
  if (!leadId || !url) return fail(400, "leadId and url required");

  let normalized = url.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

  let apifyRes: Response;
  try {
    apifyRes = await fetchWithRetry(
      `https://api.apify.com/v2/acts/apify~screenshot-url/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 90_000,
        retries: 1,
        backoffMs: 2000,
        body: JSON.stringify({
          delay: 0,
          proxy: { useApifyProxy: true },
          scrollToBottom: true,
          urls: [{ url: normalized }],
          waitUntil: "load",
          waitUntilNetworkIdleAfterScroll: false,
        }),
      },
    );
  } catch (err) {
    return fail(502, `Screenshot fetch failed: ${err instanceof Error ? err.message : "fetch failed"}`);
  }
  if (!apifyRes.ok) {
    const t = await apifyRes.text().catch(() => "");
    return fail(502, `Screenshot failed: ${apifyRes.status} ${t.slice(0, 200)}`);
  }
  const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
  const item = items?.[0] ?? {};
  const screenshotUrl =
    (item.screenshotUrl as string | undefined) ||
    (item.screenshot as string | undefined) ||
    (item.imageUrl as string | undefined);
  if (!screenshotUrl) return fail(502, "Apify returned no screenshot URL");

  const systemPrompt =
    'You are a senior web design auditor. Look at the website screenshot. Score its modern design from 1-10 (10 = world-class modern premium, 1 = extremely outdated 90s/early 2000s look). Below 6 = OUTDATED; 6-7 = DATED; 8-9 = MODERN; 10 = PREMIUM. If the screenshot is blank, blocked, or a bot wall, still pick the closest score (default 5/DATED) and say so in reason. NEVER refuse. Respond ONLY as JSON: {"score": <int 1-10>, "label": "OUTDATED|DATED|MODERN|PREMIUM", "reason": "<one short sentence>"}';

  let score = 0;
  let label = "UNKNOWN";
  let reason = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let aiRes: Response;
    try {
      aiRes = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
        timeoutMs: 60_000,
        retries: 1,
        backoffMs: 1500,
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: `Analyze this website: ${normalized}. Return JSON only.` },
                { type: "image_url", image_url: { url: screenshotUrl } },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      if (attempt === 1) return fail(502, `AI fetch failed: ${err instanceof Error ? err.message : "fetch failed"}`);
      continue;
    }
    if (!aiRes.ok) {
      if (attempt === 1) return fail(502, `AI scoring failed: ${aiRes.status}`);
      continue;
    }
    const aiJson = (await aiRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = aiJson.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson<{ score?: number; label?: string; reason?: string }>(raw);
    if (parsed && Number(parsed.score)) {
      score = Math.max(1, Math.min(10, Math.round(Number(parsed.score))));
      label = (parsed.label || "").toUpperCase() || (score < 6 ? "OUTDATED" : score < 8 ? "DATED" : score < 10 ? "MODERN" : "PREMIUM");
      reason = parsed.reason || "";
      break;
    }
  }
  if (!score) {
    score = 5;
    label = "DATED";
    reason = "AI could not parse screenshot; defaulted to 5.";
  }

  await patchLead(leadId, {
    website_screenshot_url: screenshotUrl,
    website_modern_score: score,
    website_label: label,
    website_analysis: reason,
    website_analyzed_at: new Date().toISOString(),
    website_raw: item,
  });
  await rebuildPackage(leadId);

  return ok({ leadId, screenshotUrl, score, label, reason });
}

// ---------- Brand DNA ----------
export async function runBrandAnalysis(leadId: string, url: string): Promise<RunResult> {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) return fail(500, "APIFY_TOKEN not configured");
  if (!leadId || !url) return fail(400, "leadId and url required");

  let startUrl = url.trim();
  if (!/^https?:\/\//i.test(startUrl)) startUrl = "https://" + startUrl;

  let apifyRes: Response;
  try {
    apifyRes = await fetchWithRetry(
      `https://api.apify.com/v2/acts/solutionssmart~brand-dna/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 120_000,
        retries: 1,
        backoffMs: 2000,
        body: JSON.stringify({
          adaptiveConcurrency: true,
          captureScreenshot: true,
          debug: false,
          extractImageColors: true,
          forceRefresh: false,
          includeBlog: true,
          outputComparison: false,
          outputDiff: false,
          outputPages: true,
          respectRobotsTxt: true,
          startUrl,
          translationBatchMode: true,
          useLanguageDetector: true,
          useProxy: true,
          useRenderingFallback: true,
          useTranslation: false,
        }),
      },
    );
  } catch (err) {
    return fail(502, `Brand DNA fetch failed: ${err instanceof Error ? err.message : "fetch failed"}`);
  }
  if (!apifyRes.ok) return fail(502, `Brand DNA scrape failed: ${apifyRes.status}`);
  const items = (await apifyRes.json()) as Array<Record<string, unknown>>;
  const item = items?.[0];
  if (!item) return fail(502, "Brand DNA returned no data");

  const insights = extractBrandDnaInsights(item);
  if (!insights) return fail(502, "Brand DNA data could not be parsed");
  const { score, label, summary, screenshotUrl } = insights;

  await patchLead(leadId, {
    brand_dna_score: score,
    brand_dna_label: label,
    brand_dna_summary: summary,
    brand_dna_screenshot_url: screenshotUrl,
    brand_dna_raw: item,
    brand_dna_analyzed_at: new Date().toISOString(),
  });
  await rebuildPackage(leadId);

  return ok({ leadId, score, label, summary, screenshotUrl });
}

// ---------- Instagram ----------
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
async function scrapeCandidate(apifyToken: string, target: InstagramTarget): Promise<Record<string, unknown> | null> {
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
  const item = items?.find((c) => !actorSaysMissing(c)) || items?.[0];
  return item && !actorSaysMissing(item) ? item : null;
}

export async function runInstagramAnalysis(
  leadId: string,
  hint?: { url?: string; username?: string },
): Promise<RunResult> {
  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) return fail(500, "APIFY_TOKEN not configured");
  if (!leadId) return fail(400, "leadId required");

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let target = extractInstagramTarget(hint?.url || hint?.username || "");
  let row: Record<string, unknown> | undefined;

  if (supabaseUrl && serviceKey) {
    const dbRes = await fetch(
      `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=title,website,instagram_url,instagram_username,brand_dna_raw,raw,website_raw`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const rows = dbRes.ok ? ((await dbRes.json()) as Array<Record<string, unknown>>) : [];
    row = rows[0];
    if (!target && row) {
      target =
        extractInstagramTarget(row.instagram_url) ||
        extractInstagramTarget(row.instagram_username) ||
        extractInstagramFromPayload(row.brand_dna_raw) ||
        extractInstagramFromPayload(row.raw) ||
        extractInstagramFromPayload(row.website_raw);
    }
  }

  if (!target) return fail(400, "Instagram profile not found in lead or Brand DNA data");

  const candidates = uniqTargets([
    target,
    ...(row ? extractInstagramCandidatesFromPayload(row.brand_dna_raw) : []),
    ...(row ? extractInstagramCandidatesFromPayload(row.raw) : []),
    ...(row ? extractInstagramCandidatesFromPayload(row.website_raw) : []),
  ]);
  let item: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    item = await scrapeCandidate(apifyToken, candidate);
    if (item) { target = candidate; break; }
  }
  if (!item) return fail(404, "Profile not found after checking stored handles");

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

  await patchLead(leadId, {
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
  });
  await rebuildPackage(leadId);

  return ok({ leadId, profile, score, label, reason });
}
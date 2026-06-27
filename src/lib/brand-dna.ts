type JsonRecord = Record<string, unknown>;

export type InstagramTarget = {
  username: string;
  url: string;
};

export type BrandDnaInsights = {
  name?: string;
  score: number;
  label: string;
  summary: string;
  screenshotUrl?: string;
  faviconUrl?: string;
  logoUrl?: string;
  colors: string[];
  fonts: string[];
  pagesCount: number;
  instagramUrl?: string;
  instagramUsername?: string;
  description?: string;
  industry?: string;
  audience?: string;
  attributes: string[];
  taglines: string[];
  emails: string[];
  phones: string[];
};

const INSTAGRAM_RESERVED = new Set([
  "accounts",
  "explore",
  "p",
  "reel",
  "reels",
  "stories",
  "direct",
  "about",
  "developer",
  "privacy",
  "terms",
  "share",
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getPath(raw: unknown, path: string[]): unknown {
  let current = raw;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function isUsefulText(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (["—", "-", "n/a", "none", "null", "undefined"].includes(trimmed.toLowerCase())) return false;
  return true;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (isRecord(value)) {
    return [
      ...collectStringValues(value.value),
      ...collectStringValues(value.url),
      ...collectStringValues(value.hex),
      ...collectStringValues(value.name),
    ];
  }
  return [];
}

function collectDeepStrings(value: unknown, depth = 0): string[] {
  if (value == null || depth > 8) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => collectDeepStrings(item, depth + 1));
  if (isRecord(value)) return Object.values(value).flatMap((item) => collectDeepStrings(item, depth + 1));
  return [];
}

function normalizeCssColor(value: string): string | null {
  const trimmed = value.trim();
  const hex = trimmed.match(/#[0-9a-f]{3,8}\b/i)?.[0];
  if (hex) return hex;
  const fn = trimmed.match(/\b(?:rgb|rgba|hsl|hsla)\([^)]{5,80}\)/i)?.[0];
  if (fn) return fn;
  return null;
}

function extractStructuredColors(value: unknown, depth = 0): string[] {
  if (value == null || depth > 8) return [];
  if (Array.isArray(value)) {
    if (
      value.length >= 3 &&
      value.slice(0, 3).every((item) => typeof item === "number" && item >= 0 && item <= 255)
    ) {
      return [`rgb(${value[0]}, ${value[1]}, ${value[2]})`];
    }
    return value.flatMap((item) => extractStructuredColors(item, depth + 1));
  }
  if (!isRecord(value)) return [];

  const r = value.r ?? value.red;
  const g = value.g ?? value.green;
  const b = value.b ?? value.blue;
  if (
    typeof r === "number" &&
    typeof g === "number" &&
    typeof b === "number" &&
    [r, g, b].every((item) => item >= 0 && item <= 255)
  ) {
    return [`rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`];
  }

  return Object.values(value).flatMap((item) => extractStructuredColors(item, depth + 1));
}

function extractHexColors(values: unknown[]): string[] {
  return uniq([
    ...values
      .flatMap(collectDeepStrings)
      .flatMap((value) => value.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\([^)]{5,80}\)/gi) ?? [])
      .map((value) => normalizeCssColor(value))
      .filter((value): value is string => Boolean(value)),
    ...values.flatMap(extractStructuredColors),
  ]).slice(0, 8);
}

function markdownValue(markdown: string | undefined, label: string): string | undefined {
  if (!markdown) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, "i"));
  const value = match?.[1]?.replace(/^[-–—\s]+/, "").trim();
  return isUsefulText(value) ? value : undefined;
}

function markdownList(markdown: string | undefined, label: string): string[] {
  const value = markdownValue(markdown, label);
  if (!value) return [];
  return uniq(value.split(/,|·|\/|\band\b/i).map((item) => item.trim())).slice(0, 6);
}

function markdownBulletValues(markdown: string | undefined, heading: string): string[] {
  if (!markdown) return [];
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section = markdown.match(new RegExp(`##\\s+${escaped}([\\s\\S]*?)(?:\\n##\\s+|$)`, "i"))?.[1];
  if (!section) return [];
  return uniq(
    section
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(isUsefulText),
  ).slice(0, 6);
}

function extractEmails(values: unknown[]): string[] {
  return uniq(
    values
      .flatMap(collectDeepStrings)
      .flatMap((value) => value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
  ).slice(0, 5);
}

function extractPhones(values: unknown[]): string[] {
  return uniq(
    values
      .flatMap(collectDeepStrings)
      .flatMap((value) => value.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? [])
      .map((value) => value.replace(/\s+/g, " ").trim()),
  ).slice(0, 5);
}

export function extractInstagramTarget(input: unknown): InstagramTarget | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/[),.]+$/, "");
  if (!raw) return null;

  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:@)?([A-Za-z0-9._]{1,30})(?:[/?#][^\s]*)?/i);
  let username = urlMatch?.[1] ?? raw;
  username = username.replace(/^@/, "").replace(/^\/+|\/+$/g, "").split(/[/?#]/)[0];

  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  if (INSTAGRAM_RESERVED.has(username.toLowerCase())) return null;

  return {
    username,
    url: `https://www.instagram.com/${username}`,
  };
}

export function extractInstagramCandidatesFromPayload(raw: unknown, depth = 0): InstagramTarget[] {
  if (raw == null || depth > 10) return [];

  if (typeof raw === "string") {
    // In arbitrary text, only trust explicit instagram.com URLs. Bare @handles
    // are accepted only from Instagram-specific fields below; otherwise emails
    // like info@brand.com can be misread as handles.
    const matches = raw.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._/?#=&%-]+/gi) ?? [];
    return matches.map((value) => extractInstagramTarget(value)).filter((value): value is InstagramTarget => Boolean(value));
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((value) => extractInstagramCandidatesFromPayload(value, depth + 1));
  }

  if (isRecord(raw)) {
    const platform = String(raw.platform ?? raw.type ?? raw.name ?? "").toLowerCase();
    const directValues: unknown[] = [];
    if (platform.includes("instagram")) {
      directValues.push(raw.url, raw.href, raw.link, raw.handle, raw.username, raw.value);
    }
    for (const [key, value] of Object.entries(raw)) {
      if (key.toLowerCase().includes("instagram")) directValues.push(value);
    }

    return uniq([
      ...directValues
        .flatMap(collectDeepStrings)
        .map((value) => extractInstagramTarget(value)?.username)
        .filter((value): value is string => Boolean(value)),
      ...Object.values(raw)
        .flatMap((value) => extractInstagramCandidatesFromPayload(value, depth + 1))
        .map((value) => value.username),
    ]).map((username) => ({ username, url: `https://www.instagram.com/${username}` }));
  }

  return [];
}

export function extractInstagramFromPayload(raw: unknown): InstagramTarget | null {
  return extractInstagramCandidatesFromPayload(raw)[0] ?? null;
}

export function extractBrandDnaInsights(raw: unknown): BrandDnaInsights | null {
  const root = asRecord(raw);
  if (!root) return null;

  const brandKit = asRecord(root.brandKit) ?? {};
  const fingerprint = asRecord(brandKit.assetFingerprint) ?? {};
  const pages = asArray(root.pages);
  const brandSummary = firstString(brandKit.brandSummary, root.brandSummary, root.summary);
  const signals = asRecord(brandKit.signals) ?? {};
  const meta = asRecord(signals.meta) ?? {};
  const socialMeta = asRecord(signals.socialMeta) ?? {};

  const name = firstString(
    brandKit.name,
    brandKit.title,
    root.name,
    root.title,
    meta["og:site_name"],
    socialMeta.ogSiteName,
  );

  const fonts = uniq([
    ...collectStringValues(getPath(fingerprint, ["fonts", "values"])),
    ...collectDeepStrings(getPath(brandKit, ["style", "fonts"])),
    ...collectStringValues(brandKit.fonts),
    ...collectStringValues(root.fonts),
    ...markdownList(brandSummary, "Fonts"),
  ]).slice(0, 6);

  const colors = extractHexColors([
    getPath(fingerprint, ["palette", "values"]),
    getPath(brandKit, ["style", "colors"]),
    getPath(brandKit, ["style", "colorSemantics"]),
    getPath(brandKit, ["style", "cssVariables"]),
    getPath(brandKit, ["signals", "metaColors"]),
    getPath(brandKit, ["signals", "palette"]),
    brandKit.palette,
    root.palette,
    root.colors,
    brandSummary,
    raw,
  ]);

  const logoUrl = firstString(
    getPath(brandKit, ["style", "logo", "url"]),
    getPath(brandKit, ["style", "logo", "candidates", "0"]),
    getPath(fingerprint, ["logo", "value"]),
    getPath(brandKit, ["logo", "value"]),
    brandKit.logo,
    brandKit.logoUrl,
    root.logoUrl,
    root.logo,
    markdownValue(brandSummary, "Logo"),
    brandSummary?.match(/https?:\/\/[^\s)]+(?:logo|brand)[^\s)]*/i)?.[0],
  );

  const firstPage = asRecord(pages[0]) ?? {};
  const description = firstString(
    root.description,
    brandKit.description,
    brandKit.positioning,
    meta.description,
    meta["og:description"],
    meta["twitter:description"],
    socialMeta.ogDescription,
    socialMeta.twitterDescription,
    getPath(brandKit, ["signals", "socialMeta", "ogDescription"]),
    getPath(brandKit, ["signals", "socialMeta", "twitterDescription"]),
    firstPage.metaDescription,
    markdownValue(brandSummary, "Positioning"),
  );
  const industry = markdownValue(brandSummary, "Industry");
  const audience = markdownValue(brandSummary, "Audience");
  const attributes = markdownList(brandSummary, "Attributes");
  const instagram = extractInstagramFromPayload(raw);
  const screenshotUrl = firstString(
    root.screenshotUrl,
    root.screenshot,
    brandKit.screenshotUrl,
    socialMeta.ogImage,
    socialMeta.twitterImage,
    meta["og:image"],
    meta["twitter:image"],
    getPath(brandKit, ["signals", "socialMeta", "ogImage"]),
    getPath(brandKit, ["signals", "socialMeta", "twitterImage"]),
  );
  const faviconUrl = firstString(brandKit.favicon, root.favicon, getPath(signals, ["favicon", "url"]));
  const taglines = markdownBulletValues(brandSummary, "Hero / tagline candidates");
  const emails = extractEmails([getPath(signals, ["contacts", "emails"]), brandSummary, raw]);
  const phones = extractPhones([getPath(signals, ["contacts", "phones"]), brandSummary]);

  const hasLogo = Boolean(logoUrl);
  const hasDescription = Boolean(description && description.length > 35);
  let score = 1;
  if (hasLogo) score += 2;
  if (hasDescription) score += 1;
  if (colors.length >= 3) score += 2;
  else if (colors.length >= 1) score += 1;
  if (fonts.length >= 2) score += 2;
  else if (fonts.length >= 1) score += 1;
  if (pages.length >= 6) score += 2;
  else if (pages.length >= 2) score += 1;
  if (instagram) score += 1;
  score = Math.max(1, Math.min(10, score));

  const label = score <= 3 ? "WEAK" : score <= 5 ? "GENERIC" : score <= 7 ? "SOLID" : "STRONG";
  const parts = [
    name,
    `${pages.length || 1} page${pages.length === 1 ? "" : "s"} scanned`,
    hasLogo ? "logo found" : "no logo found",
    colors.length ? `${colors.length} color${colors.length === 1 ? "" : "s"}` : "no clear palette",
    fonts.length ? `${fonts.slice(0, 2).join(", ")} font${fonts.length === 1 ? "" : "s"}` : "fonts unclear",
    instagram ? `Instagram @${instagram.username}` : null,
    industry ? industry : null,
  ].filter(Boolean);

  return {
    name,
    score,
    label,
    summary: parts.join(" · "),
    screenshotUrl,
    faviconUrl,
    logoUrl,
    colors,
    fonts,
    pagesCount: pages.length,
    instagramUrl: instagram?.url,
    instagramUsername: instagram?.username,
    description,
    industry,
    audience,
    attributes,
    taglines,
    emails,
    phones,
  };
}

type JsonRecord = Record<string, unknown>;

export type InstagramTarget = {
  username: string;
  url: string;
};

export type BrandDnaInsights = {
  score: number;
  label: string;
  summary: string;
  screenshotUrl?: string;
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

function extractHexColors(values: unknown[]): string[] {
  return uniq(
    values
      .flatMap(collectStringValues)
      .flatMap((value) => value.match(/#[0-9a-f]{3,8}\b/gi) ?? []),
  ).slice(0, 8);
}

function markdownValue(markdown: string | undefined, label: string): string | undefined {
  if (!markdown) return undefined;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`\\*\\*${escaped}:\\*\\*\\s*([^\\n]+)`, "i"));
  return match?.[1]?.replace(/^[-–—\s]+/, "").trim() || undefined;
}

function markdownList(markdown: string | undefined, label: string): string[] {
  const value = markdownValue(markdown, label);
  if (!value) return [];
  return uniq(value.split(/,|·|\/|\band\b/i).map((item) => item.trim())).slice(0, 6);
}

export function extractInstagramTarget(input: unknown): InstagramTarget | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/[),.]+$/, "");
  if (!raw) return null;

  const urlMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(@?[A-Za-z0-9._]{1,30})(?:[/?#][^\s]*)?/i);
  let username = urlMatch?.[1] ?? raw;
  username = username.replace(/^@/, "").replace(/^\/+|\/+$/g, "").split(/[/?#]/)[0];

  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  if (INSTAGRAM_RESERVED.has(username.toLowerCase())) return null;

  return {
    username,
    url: `https://www.instagram.com/${username}`,
  };
}

export function extractInstagramFromPayload(raw: unknown, depth = 0): InstagramTarget | null {
  if (raw == null || depth > 10) return null;

  if (typeof raw === "string") {
    const url = raw.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[A-Za-z0-9._/?#=&%-]+/i)?.[0];
    return extractInstagramTarget(url ?? raw);
  }

  if (Array.isArray(raw)) {
    for (const value of raw) {
      const found = extractInstagramFromPayload(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (isRecord(raw)) {
    const platform = String(raw.platform ?? raw.type ?? raw.name ?? "").toLowerCase();
    if (platform.includes("instagram")) {
      const direct = extractInstagramTarget(
        firstString(raw.url, raw.href, raw.link, raw.handle, raw.username, raw.value),
      );
      if (direct) return direct;
    }

    for (const [key, value] of Object.entries(raw)) {
      if (key.toLowerCase().includes("instagram")) {
        const direct = extractInstagramTarget(firstString(value));
        if (direct) return direct;
      }
      const found = extractInstagramFromPayload(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

export function extractBrandDnaInsights(raw: unknown): BrandDnaInsights | null {
  const root = asRecord(raw);
  if (!root) return null;

  const brandKit = asRecord(root.brandKit) ?? {};
  const fingerprint = asRecord(brandKit.assetFingerprint) ?? {};
  const pages = asArray(root.pages);
  const brandSummary = firstString(brandKit.brandSummary, root.brandSummary, root.summary);

  const fonts = uniq([
    ...collectStringValues(getPath(fingerprint, ["fonts", "values"])),
    ...collectStringValues(brandKit.fonts),
    ...collectStringValues(root.fonts),
  ]).slice(0, 6);

  const colors = extractHexColors([
    getPath(fingerprint, ["palette", "values"]),
    brandKit.palette,
    root.palette,
    root.colors,
  ]);

  const logoUrl = firstString(
    getPath(fingerprint, ["logo", "value"]),
    getPath(brandKit, ["logo", "value"]),
    brandKit.logoUrl,
    root.logoUrl,
    root.logo,
    brandSummary?.match(/https?:\/\/[^\s)]+(?:logo|brand)[^\s)]*/i)?.[0],
  );

  const firstPage = asRecord(pages[0]) ?? {};
  const description = firstString(
    root.description,
    brandKit.description,
    firstPage.metaDescription,
    markdownValue(brandSummary, "Positioning"),
  );
  const industry = markdownValue(brandSummary, "Industry");
  const audience = markdownValue(brandSummary, "Audience");
  const attributes = markdownList(brandSummary, "Attributes");
  const instagram = extractInstagramFromPayload(raw);
  const screenshotUrl = firstString(root.screenshotUrl, root.screenshot, brandKit.screenshotUrl);

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
    `${pages.length || 1} page${pages.length === 1 ? "" : "s"} scanned`,
    hasLogo ? "logo found" : "no logo found",
    colors.length ? `${colors.length} color${colors.length === 1 ? "" : "s"}` : "no clear palette",
    fonts.length ? `${fonts.slice(0, 2).join(", ")} font${fonts.length === 1 ? "" : "s"}` : "fonts unclear",
    instagram ? `Instagram @${instagram.username}` : null,
    industry ? industry : null,
  ].filter(Boolean);

  return {
    score,
    label,
    summary: parts.join(" · "),
    screenshotUrl,
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
  };
}
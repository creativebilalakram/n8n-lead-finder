// Smart channel merge: takes contact signals from every available source
// (Google Business Profile raw, website contact scraper, brand DNA, Instagram
// raw) and produces a single deduplicated, normalized BusinessChannels payload
// with per-value source provenance.
//
// Key rules:
// 1. Phones are normalized to digits-only for dedupe; the most "human" copy
//    of the original string is kept for display.
// 2. Emails are lowercased / trimmed for dedupe.
// 3. Social URLs are classified — only main *profile* URLs are kept. Posts,
//    reels, stories, status updates, videos, etc. are dropped entirely.
// 4. For each social platform, the highest-confidence profile URL wins
//    (preference order: website scrape ≫ GBP ≫ brand DNA ≫ Instagram bio).

export type ChannelSource =
  | "Google Business Profile"
  | "Website scrape"
  | "Brand DNA"
  | "Instagram bio";

type Json = Record<string, unknown>;

const SOURCE_RANK: Record<ChannelSource, number> = {
  "Website scrape": 4,
  "Google Business Profile": 3,
  "Brand DNA": 2,
  "Instagram bio": 1,
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v.includes("@") || v.length < 5) return null;
  return v;
}

export function normalizePhone(raw: string): { display: string; key: string } | null {
  const display = raw.trim();
  if (!display) return null;
  const digits = display.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  // Last 10 digits are a strong dedupe key (handles +1 vs no prefix, formatting).
  const key = digits.length > 10 ? digits.slice(-11) : digits;
  return { display, key };
}

// ─────────────────────────── Social URL classifier ───────────────────────────

export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "twitter"
  | "youtube";

const PLATFORM_HOSTS: Array<{ re: RegExp; platform: SocialPlatform }> = [
  { re: /(?:^|\.)instagram\.com$/i, platform: "instagram" },
  { re: /(?:^|\.)facebook\.com$/i, platform: "facebook" },
  { re: /(?:^|\.)fb\.com$/i, platform: "facebook" },
  { re: /(?:^|\.)tiktok\.com$/i, platform: "tiktok" },
  { re: /(?:^|\.)linkedin\.com$/i, platform: "linkedin" },
  { re: /(?:^|\.)twitter\.com$/i, platform: "twitter" },
  { re: /(?:^|\.)x\.com$/i, platform: "twitter" },
  { re: /(?:^|\.)youtube\.com$/i, platform: "youtube" },
  { re: /(?:^|\.)youtu\.be$/i, platform: "youtube" },
];

// Paths that mean "specific content" rather than the main account.
const POST_PATH_RE: Record<SocialPlatform, RegExp> = {
  instagram: /\/(p|reel|reels|tv|stories|s)\//i,
  facebook: /\/(posts|videos|watch|photo|photos|story\.php|events|groups|reel)\b/i,
  tiktok: /\/video\/|\/t\//i,
  linkedin: /\/(posts|pulse|feed|activity|events|jobs|learning)\//i,
  twitter: /\/status\/|\/i\/web\//i,
  youtube: /\/(watch|shorts|embed|playlist|live)\b/i,
};

export function classifySocialUrl(
  raw: string,
): { platform: SocialPlatform; isProfile: boolean; profileUrl: string } | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const match = PLATFORM_HOSTS.find((p) => p.re.test(host));
  if (!match) return null;
  const path = u.pathname || "/";
  const isPost = POST_PATH_RE[match.platform].test(path);
  if (isPost) return { platform: match.platform, isProfile: false, profileUrl: "" };

  // Build a clean profile URL (strip query, fragment, trailing slash, www).
  const cleanHost = host;
  let cleanPath = path.replace(/\/+$/, "");
  // For YouTube, /channel/{id}, /@handle, /c/, /user/ are all valid profile shapes.
  // For LinkedIn, /in/{slug}, /company/{slug}, /school/{slug} are valid.
  // For Instagram/TikTok/Twitter, /{handle} is canonical.
  if (match.platform === "instagram" || match.platform === "twitter" || match.platform === "tiktok") {
    const seg = cleanPath.split("/").filter(Boolean)[0] || "";
    if (!seg) return { platform: match.platform, isProfile: false, profileUrl: "" };
    cleanPath = `/${seg}`;
  }
  const profileUrl = `https://${cleanHost}${cleanPath}`;
  return { platform: match.platform, isProfile: true, profileUrl };
}

// ─────────────────────────── Per-source extractors ───────────────────────────

type RawSignals = {
  emails: string[];
  phones: string[];
  socials: Partial<Record<SocialPlatform, string[]>>;
};

function extractFromGbp(raw: unknown): RawSignals {
  if (!raw || typeof raw !== "object") return { emails: [], phones: [], socials: {} };
  const j = raw as Json;
  const phones = asStringArray(j.phones);
  if (!phones.length && typeof j.phone === "string") phones.push(j.phone);
  return {
    emails: asStringArray(j.emails),
    phones,
    socials: {
      instagram: asStringArray(j.instagrams),
      facebook: asStringArray(j.facebooks),
      tiktok: asStringArray(j.tiktoks),
      twitter: asStringArray(j.twitters),
      youtube: asStringArray(j.youtubes),
      linkedin: asStringArray(j.linkedIns),
    },
  };
}

function extractFromWebsiteContacts(wc: unknown): RawSignals {
  if (!wc || typeof wc !== "object") return { emails: [], phones: [], socials: {} };
  const w = wc as Json;
  const socials = (w.socials as Json | undefined) ?? {};
  return {
    emails: asStringArray(w.emails),
    phones: asStringArray(w.phones),
    socials: {
      instagram: asStringArray((socials as Json).instagrams),
      facebook: asStringArray((socials as Json).facebooks),
      tiktok: asStringArray((socials as Json).tiktoks),
      twitter: asStringArray((socials as Json).twitters),
      youtube: asStringArray((socials as Json).youtubes),
      linkedin: asStringArray(w.linkedins),
    },
  };
}

function extractFromInstagramRaw(raw: unknown): RawSignals {
  if (!raw || typeof raw !== "object") return { emails: [], phones: [], socials: {} };
  const j = raw as Json;
  const emails: string[] = [];
  if (typeof j.businessEmail === "string") emails.push(j.businessEmail);
  if (typeof j.email === "string") emails.push(j.email);
  const phones: string[] = [];
  if (typeof j.businessPhoneNumber === "string") phones.push(j.businessPhoneNumber);
  const externalUrl = typeof j.externalUrl === "string" ? j.externalUrl : "";
  const handle = typeof j.username === "string" ? j.username : "";
  return {
    emails,
    phones,
    socials: {
      instagram: handle ? [`https://www.instagram.com/${handle}`] : [],
      ...(externalUrl ? scanFreeTextForSocials(externalUrl) : {}),
    },
  };
}

function extractFromBrandDna(raw: unknown): RawSignals {
  if (!raw) return { emails: [], phones: [], socials: {} };
  // Brand DNA payloads vary wildly — scan stringified blob for URLs.
  try {
    const txt = typeof raw === "string" ? raw : JSON.stringify(raw);
    return { emails: [], phones: [], socials: scanFreeTextForSocials(txt) };
  } catch {
    return { emails: [], phones: [], socials: {} };
  }
}

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;
function scanFreeTextForSocials(text: string): Partial<Record<SocialPlatform, string[]>> {
  const out: Partial<Record<SocialPlatform, string[]>> = {};
  for (const m of text.matchAll(URL_RE)) {
    const c = classifySocialUrl(m[0]);
    if (!c || !c.isProfile) continue;
    (out[c.platform] ??= []).push(c.profileUrl);
  }
  return out;
}

// ───────────────────────────────── Merge ─────────────────────────────────────

export type MergedValue = { value: string; sources: ChannelSource[] };
export type MergedSocial = { url: string; sources: ChannelSource[] } | null;

export type MergedChannels = {
  generic_emails: MergedValue[];
  generic_phones: MergedValue[];
  instagram: MergedSocial;
  facebook: MergedSocial;
  tiktok: MergedSocial;
  linkedin: MergedSocial;
  twitter: MergedSocial;
  youtube: MergedSocial;
  // Counts of items the smart filter dropped (mostly post/reel URLs).
  droppedNonProfile: number;
};

type SourceBlob = {
  source: ChannelSource;
  signals: RawSignals;
};

export type MergeInput = {
  gbpRaw?: unknown;
  websiteContacts?: unknown;
  instagramRaw?: unknown;
  brandDnaRaw?: unknown;
};

export function mergeChannelsFromSources(input: MergeInput): MergedChannels {
  const blobs: SourceBlob[] = [];
  if (input.gbpRaw) blobs.push({ source: "Google Business Profile", signals: extractFromGbp(input.gbpRaw) });
  if (input.websiteContacts) blobs.push({ source: "Website scrape", signals: extractFromWebsiteContacts(input.websiteContacts) });
  if (input.instagramRaw) blobs.push({ source: "Instagram bio", signals: extractFromInstagramRaw(input.instagramRaw) });
  if (input.brandDnaRaw) blobs.push({ source: "Brand DNA", signals: extractFromBrandDna(input.brandDnaRaw) });

  // Emails
  const emailMap = new Map<string, MergedValue>();
  for (const b of blobs) {
    for (const raw of b.signals.emails) {
      const norm = normalizeEmail(raw);
      if (!norm) continue;
      const existing = emailMap.get(norm);
      if (existing) {
        if (!existing.sources.includes(b.source)) existing.sources.push(b.source);
      } else {
        emailMap.set(norm, { value: norm, sources: [b.source] });
      }
    }
  }

  // Phones
  const phoneMap = new Map<string, MergedValue>();
  for (const b of blobs) {
    for (const raw of b.signals.phones) {
      const n = normalizePhone(raw);
      if (!n) continue;
      const existing = phoneMap.get(n.key);
      if (existing) {
        if (!existing.sources.includes(b.source)) existing.sources.push(b.source);
        // Prefer a longer / formatted display if existing is just digits.
        if (n.display.length > existing.value.length && /\D/.test(n.display)) existing.value = n.display;
      } else {
        phoneMap.set(n.key, { value: n.display, sources: [b.source] });
      }
    }
  }

  // Socials — keep only profile URLs, dedupe per platform.
  const platforms: SocialPlatform[] = ["instagram", "facebook", "tiktok", "linkedin", "twitter", "youtube"];
  let dropped = 0;
  const socialsByPlatform = new Map<SocialPlatform, Map<string, MergedValue>>();
  for (const p of platforms) socialsByPlatform.set(p, new Map());

  for (const b of blobs) {
    for (const p of platforms) {
      const list = b.signals.socials[p] ?? [];
      for (const raw of list) {
        const c = classifySocialUrl(raw);
        if (!c) continue;
        if (!c.isProfile) {
          dropped += 1;
          continue;
        }
        const m = socialsByPlatform.get(c.platform)!;
        const key = c.profileUrl.toLowerCase();
        const existing = m.get(key);
        if (existing) {
          if (!existing.sources.includes(b.source)) existing.sources.push(b.source);
        } else {
          m.set(key, { value: c.profileUrl, sources: [b.source] });
        }
      }
    }
  }

  const pickBest = (p: SocialPlatform): MergedSocial => {
    const m = socialsByPlatform.get(p)!;
    if (!m.size) return null;
    const arr = [...m.values()];
    arr.sort((a, b) => {
      const rankA = Math.max(...a.sources.map((s) => SOURCE_RANK[s] ?? 0));
      const rankB = Math.max(...b.sources.map((s) => SOURCE_RANK[s] ?? 0));
      if (rankB !== rankA) return rankB - rankA;
      return b.sources.length - a.sources.length;
    });
    const best = arr[0];
    return { url: best.value, sources: best.sources };
  };

  return {
    generic_emails: [...emailMap.values()],
    generic_phones: [...phoneMap.values()],
    instagram: pickBest("instagram"),
    facebook: pickBest("facebook"),
    tiktok: pickBest("tiktok"),
    linkedin: pickBest("linkedin"),
    twitter: pickBest("twitter"),
    youtube: pickBest("youtube"),
    droppedNonProfile: dropped,
  };
}

// Flatten the merged result into the shape the BusinessChannels row stores.
export function mergedToRow(m: MergedChannels): {
  generic_emails: string[];
  generic_phones: string[];
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  linkedin_company_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  sources: Record<string, ChannelSource[]>;
} {
  const sources: Record<string, ChannelSource[]> = {};
  for (const e of m.generic_emails) sources[`email:${e.value}`] = e.sources;
  for (const p of m.generic_phones) sources[`phone:${p.value}`] = p.sources;
  const setSocial = (key: string, v: MergedSocial) => {
    if (v) sources[key] = v.sources;
  };
  setSocial("instagram_url", m.instagram);
  setSocial("facebook_url", m.facebook);
  setSocial("tiktok_url", m.tiktok);
  setSocial("linkedin_company_url", m.linkedin);
  setSocial("twitter_url", m.twitter);
  setSocial("youtube_url", m.youtube);
  return {
    generic_emails: m.generic_emails.map((x) => x.value),
    generic_phones: m.generic_phones.map((x) => x.value),
    instagram_url: m.instagram?.url ?? null,
    facebook_url: m.facebook?.url ?? null,
    tiktok_url: m.tiktok?.url ?? null,
    linkedin_company_url: m.linkedin?.url ?? null,
    twitter_url: m.twitter?.url ?? null,
    youtube_url: m.youtube?.url ?? null,
    sources,
  };
}

// Short label used by source chips.
export function sourceShort(s: ChannelSource): string {
  return s === "Google Business Profile"
    ? "GBP"
    : s === "Website scrape"
      ? "Web"
      : s === "Brand DNA"
        ? "Brand"
        : "IG";
}
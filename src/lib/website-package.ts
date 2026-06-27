// Website Data Package (WDP): a clean, stable, high-signal subset of a lead's
// enriched data, used exclusively by the Website Builder flow. The raw Apify
// payloads stay untouched on the row; the WDP is a derived, versioned view.
//
// Bump WDP_VERSION whenever the filter rules below change so the UI can flag
// stale packages and offer a rebuild.
import { extractBrandDnaInsights, extractInstagramFromPayload } from "./brand-dna";

export const WDP_VERSION = 1;

export type WebsiteDataPackage = {
  version: number;
  business: {
    name?: string;
    owner?: string;
    tagline?: string;
    description?: string;
    categories: string[];
    services: string[];
    attributes: string[];
  };
  contact: {
    phone?: string;
    emails: string[];
    address?: { full?: string; city?: string; state?: string; country?: string };
    hours: Array<{ day: string; hours: string }>;
    socials: Record<string, string>;
  };
  brand: {
    logoUrl?: string;
    colors: string[];
    fonts: string[];
    tone?: string;
  };
  media: {
    heroImage?: string;
    gallery: string[];
    websiteScreenshot?: string;
  };
  reviews: Array<{ author?: string; rating?: number; text: string; date?: string }>;
  updates: Array<{ text: string; date?: string; image?: string }>;
  instagram?: {
    handle?: string;
    url?: string;
    followers?: number;
    bio?: string;
    verified?: boolean;
  };
};

/** Source row — keys are loose because we accept both the snake_case DB row
 * and the camelCase pre-save lead shape. */
type AnyRow = Record<string, unknown>;

function s(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function rec(v: unknown): AnyRow | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRow) : null;
}
function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
function pick<T = unknown>(row: AnyRow, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

// ---- field extractors ---------------------------------------------------

function extractCategories(raw: AnyRow): string[] {
  return uniq([
    s(pick<string>(raw, "categoryName", "category")) ?? "",
    ...arr(pick(raw, "categories")).map((c) => (typeof c === "string" ? c : "")),
  ]).slice(0, 8);
}

function extractServices(raw: AnyRow): string[] {
  const out: string[] = [];
  const ai = arr(pick(raw, "additionalInfo"));
  for (const block of ai) {
    const r = rec(block);
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) {
      if (/service|offerings|amenities|highlights/i.test(k)) {
        for (const item of arr(v)) {
          const ir = rec(item);
          if (!ir) continue;
          for (const [name, on] of Object.entries(ir)) {
            if (on === true) out.push(name);
          }
        }
      }
    }
  }
  for (const item of arr(pick(raw, "services"))) {
    if (typeof item === "string") out.push(item);
    else if (rec(item)) {
      const r = rec(item)!;
      const name = s(r.name) ?? s(r.title);
      if (name) out.push(name);
    }
  }
  return uniq(out).slice(0, 20);
}

function extractAttributes(raw: AnyRow): string[] {
  const out: string[] = [];
  for (const block of arr(pick(raw, "additionalInfo"))) {
    const r = rec(block);
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) {
      if (/identifies|accessibility|crowd|payments|planning|amenities/i.test(k)) {
        for (const item of arr(v)) {
          const ir = rec(item);
          if (!ir) continue;
          for (const [name, on] of Object.entries(ir)) {
            if (on === true) out.push(name);
          }
        }
      }
    }
  }
  return uniq(out).slice(0, 15);
}

function extractHours(raw: AnyRow): Array<{ day: string; hours: string }> {
  const oh = arr(pick(raw, "openingHours"));
  const out: Array<{ day: string; hours: string }> = [];
  for (const item of oh) {
    const r = rec(item);
    if (!r) continue;
    const day = s(r.day);
    const hours = s(r.hours);
    if (day && hours) out.push({ day, hours });
  }
  return out;
}

function extractSocials(raw: AnyRow): Record<string, string> {
  const out: Record<string, string> = {};
  const patterns: Record<string, RegExp> = {
    instagram: /instagram\.com\/[^\s"'<>]+/i,
    facebook: /facebook\.com\/[^\s"'<>]+/i,
    tiktok: /tiktok\.com\/@[^\s"'<>]+/i,
    youtube: /(?:youtube\.com|youtu\.be)\/[^\s"'<>]+/i,
    linkedin: /linkedin\.com\/[^\s"'<>]+/i,
    twitter: /(?:twitter\.com|x\.com)\/[^\s"'<>]+/i,
  };
  const json = JSON.stringify(raw);
  for (const [name, re] of Object.entries(patterns)) {
    const m = json.match(re);
    if (m) out[name] = m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
  }
  return out;
}

function extractGallery(raw: AnyRow): { hero?: string; gallery: string[] } {
  const candidates: Array<{ url: string; isOwner: boolean }> = [];
  const seen = new Set<string>();
  const add = (url: unknown, isOwner: boolean) => {
    if (typeof url !== "string" || !url) return;
    if (seen.has(url)) return;
    if (/menu|pricing|price-list/i.test(url)) return;
    seen.add(url);
    candidates.push({ url, isOwner });
  };
  add(pick(raw, "imageUrl"), false);
  for (const u of arr(pick(raw, "imageUrls"))) add(u, false);
  for (const item of arr(pick(raw, "images"))) {
    if (typeof item === "string") add(item, false);
    else if (rec(item)) {
      const r = rec(item)!;
      const isOwner = String(r.authorName ?? r.uploader ?? "").toLowerCase() === "owner" || r.isOwner === true;
      add(r.imageUrl ?? r.url ?? r.src, isOwner);
    }
  }
  for (const u of arr(pick(raw, "imageCategories"))) {
    const r = rec(u);
    if (!r) continue;
    for (const img of arr(r.images)) {
      const ir = rec(img);
      if (ir) add(ir.imageUrl ?? ir.url, false);
    }
  }
  // owner-uploaded first
  candidates.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  const urls = candidates.map((c) => c.url).slice(0, 12);
  return { hero: urls[0], gallery: urls };
}

function extractReviews(raw: AnyRow): WebsiteDataPackage["reviews"] {
  const all = arr(pick(raw, "reviews"));
  const cleaned: WebsiteDataPackage["reviews"] = [];
  const seen = new Set<string>();
  for (const item of all) {
    const r = rec(item);
    if (!r) continue;
    const text = s(r.text) ?? s(r.reviewText) ?? s(r.translatedText);
    const rating = n(r.stars) ?? n(r.rating);
    if (!text) continue;
    if (rating !== undefined && rating < 4) continue;
    if (text.length < 60 || text.length > 500) continue;
    const key = text.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      author: s(r.name) ?? s(r.reviewerName),
      rating,
      text,
      date: s(r.publishedAtDate) ?? s(r.publishAt),
    });
    if (cleaned.length >= 15) break;
  }
  return cleaned;
}

function extractUpdates(raw: AnyRow): WebsiteDataPackage["updates"] {
  const posts = arr(pick(raw, "updatesFromCustomers", "ownerUpdates", "posts"));
  const out: WebsiteDataPackage["updates"] = [];
  for (const p of posts) {
    const r = rec(p);
    if (!r) continue;
    const text = s(r.text) ?? s(r.title) ?? s(r.snippet);
    if (!text) continue;
    out.push({ text, date: s(r.date) ?? s(r.publishedAt), image: s(r.image) ?? s(r.imageUrl) });
  }
  return out.slice(0, 5);
}

// ---- public builder -----------------------------------------------------

export function buildWebsitePackage(
  rawLead: AnyRow,
  enrichment?: { brandDnaRaw?: unknown; instagramRaw?: unknown; websiteScreenshot?: string | null },
  overrides?: Partial<WebsiteDataPackage> | null,
): WebsiteDataPackage {
  const raw = rec(rawLead) ?? {};
  const brand = extractBrandDnaInsights(enrichment?.brandDnaRaw) ?? null;

  const { hero, gallery } = extractGallery(raw);
  const socials = extractSocials(raw);
  if (brand?.instagramUrl && !socials.instagram) socials.instagram = brand.instagramUrl;

  const igRaw = rec(enrichment?.instagramRaw);
  const ig = extractInstagramFromPayload(enrichment?.instagramRaw) ?? extractInstagramFromPayload(raw);

  const pkg: WebsiteDataPackage = {
    version: WDP_VERSION,
    business: {
      name: s(pick(raw, "title", "name")),
      owner: s(pick(raw, "ownerName")),
      tagline: brand?.taglines?.[0],
      description: brand?.description ?? s(pick(raw, "description")),
      categories: extractCategories(raw),
      services: extractServices(raw),
      attributes: extractAttributes(raw),
    },
    contact: {
      phone: s(pick(raw, "phone", "phoneUnformatted")),
      emails: uniq([
        ...(brand?.emails ?? []),
        ...arr(pick(raw, "emails")).map((e) => (typeof e === "string" ? e : "")),
      ]).slice(0, 5),
      address: {
        full: s(pick(raw, "address")),
        city: s(pick(raw, "city")),
        state: s(pick(raw, "state")),
        country: s(pick(raw, "countryCode", "country")),
      },
      hours: extractHours(raw),
      socials,
    },
    brand: {
      logoUrl: brand?.logoUrl,
      colors: (brand?.colors ?? []).slice(0, 6),
      fonts: (brand?.fonts ?? []).slice(0, 4),
      tone: brand?.attributes?.join(", ") || brand?.industry,
    },
    media: {
      heroImage: hero,
      gallery,
      websiteScreenshot: enrichment?.websiteScreenshot ?? brand?.screenshotUrl ?? undefined,
    },
    reviews: extractReviews(raw),
    updates: extractUpdates(raw),
    instagram: ig
      ? {
          handle: ig.username,
          url: ig.url,
          followers: n(igRaw?.followersCount) ?? n(igRaw?.followers),
          bio: s(igRaw?.biography) ?? s(igRaw?.bio),
          verified: typeof igRaw?.verified === "boolean" ? (igRaw.verified as boolean) : undefined,
        }
      : undefined,
  };

  if (overrides) return mergeOverrides(pkg, overrides);
  return pkg;
}

/** Deep-merge user overrides on top of auto-built fields. Arrays are replaced
 * wholesale (so an edited reviews list wins entirely), objects are merged. */
export function mergeOverrides(base: WebsiteDataPackage, overrides: Partial<WebsiteDataPackage>): WebsiteDataPackage {
  const out: WebsiteDataPackage = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = v;
    } else if (typeof v === "object") {
      (out as Record<string, unknown>)[k] = { ...((out as Record<string, unknown>)[k] as object), ...v };
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function isPackageStale(version: number | null | undefined): boolean {
  return (version ?? 0) < WDP_VERSION;
}
// Website Data Package (WDP): a clean, stable, high-signal subset of a lead's
// enriched data, used exclusively by the Website Builder flow. The raw Apify
// payloads stay untouched on the row; the WDP is a derived, versioned view.
//
// Bump WDP_VERSION whenever the filter rules below change so the UI can flag
// stale packages and offer a rebuild.
import { extractBrandDnaInsights, extractInstagramFromPayload } from "./brand-dna";

export const WDP_VERSION = 2;

export type WebsiteDataPackage = {
  version: number;
  business: {
    name?: string;
    owner?: string;
    tagline?: string;
    taglineCandidates: string[];
    valueProps: string[];
    description?: string;
    shortDescription?: string;
    categories: string[];
    services: string[];
    attributes: string[];
    priceRange?: string;
    languages: string[];
    claimed?: boolean;
    permanentlyClosed?: boolean;
    yearEstablished?: number;
    serviceArea: string[];
  };
  contact: {
    phone?: string;
    emails: string[];
    address?: {
      full?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      country?: string;
      postalCode?: string;
      street?: string;
      lat?: number;
      lng?: number;
      plusCode?: string;
      googleMapsUrl?: string;
    };
    hours: Array<{ day: string; hours: string }>;
    socials: Record<string, string>;
    bookingLinks: string[];
    menuLinks: string[];
    reservationLinks: string[];
  };
  brand: {
    logoUrl?: string;
    colors: string[];
    colorRoles?: { primary?: string; secondary?: string; accent?: string; background?: string; text?: string };
    fonts: string[];
    tone?: string;
    personality: string[];
    faviconUrl?: string;
  };
  media: {
    heroImage?: string;
    gallery: string[];
    websiteScreenshot?: string;
    galleryByCategory: Array<{ category: string; count: number; sample?: string }>;
  };
  reviews: Array<{ author?: string; rating?: number; text: string; date?: string }>;
  reviewStats: {
    averageRating?: number;
    total?: number;
    distribution?: Record<string, number>;
    sampleHighlights: string[];
  };
  updates: Array<{ text: string; date?: string; image?: string }>;
  recentActivity?: {
    lastUpdateDate?: string;
    lastReviewDate?: string;
    daysSinceLastUpdate?: number;
    daysSinceLastReview?: number;
    isActive: boolean;
    signal: string;
  };
  amenities: {
    serviceOptions: string[];
    highlights: string[];
    accessibility: string[];
    amenities: string[];
    payments: string[];
    parking: string[];
    crowd: string[];
    planning: string[];
    children: string[];
    pets: string[];
    fromTheBusiness: string[];
  };
  faq: Array<{ question: string; answer?: string }>;
  popularTimes?: { summary: string; busiest?: string[] };
  competitors: string[];
  websiteAnalysis?: {
    score?: number;
    label?: string;
    summary?: string;
    weaknesses: string[];
    strengths: string[];
    screenshotUrl?: string;
  };
  seo: { metaTitle?: string; metaDescription?: string; keywords: string[] };
  instagram?: {
    handle?: string;
    url?: string;
    followers?: number;
    following?: number;
    postsCount?: number;
    bio?: string;
    fullName?: string;
    profilePicUrl?: string;
    verified?: boolean;
    isBusiness?: boolean;
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

function b(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
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
      if (/service options|offerings|highlights|popular for/i.test(k)) {
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
  // Mine the description for common service keywords (dental/medical/beauty)
  const desc = `${s(pick(raw, "description")) ?? ""} ${s(pick(raw, "subTitle")) ?? ""}`.toLowerCase();
  const SERVICE_KEYWORDS = [
    "implants", "invisalign", "veneers", "whitening", "crowns", "bridges", "root canal",
    "orthodontics", "braces", "cosmetic dentistry", "pediatric", "sleep apnea", "tmj",
    "botox", "fillers", "lip filler", "laser hair removal", "microneedling", "facials",
    "chemical peel", "coolsculpting", "prp", "hydrafacial", "massage", "manicure", "pedicure",
    "hair color", "balayage", "extensions", "haircut", "lash extensions", "brow lamination",
    "waxing", "ipl", "skincare", "consultation", "checkup", "cleaning", "extraction",
  ];
  for (const kw of SERVICE_KEYWORDS) if (desc.includes(kw)) out.push(kw.replace(/\b\w/g, (c) => c.toUpperCase()));
  return uniq(out).slice(0, 20);
}

/** Pull grouped amenity-style attributes from GBP's `additionalInfo`. */
function extractAmenityGroups(raw: AnyRow) {
  const groups: Record<string, string[]> = {
    serviceOptions: [], highlights: [], accessibility: [], amenities: [], payments: [],
    parking: [], crowd: [], planning: [], children: [], pets: [], fromTheBusiness: [],
  };
  const map: Array<[RegExp, keyof typeof groups]> = [
    [/service options/i, "serviceOptions"],
    [/highlights/i, "highlights"],
    [/accessibility/i, "accessibility"],
    [/amenities/i, "amenities"],
    [/payments/i, "payments"],
    [/parking/i, "parking"],
    [/crowd/i, "crowd"],
    [/planning/i, "planning"],
    [/children/i, "children"],
    [/pets/i, "pets"],
    [/from the business|identifies as/i, "fromTheBusiness"],
  ];
  for (const block of arr(pick(raw, "additionalInfo"))) {
    const r = rec(block);
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) {
      const target = map.find(([re]) => re.test(k))?.[1];
      if (!target) continue;
      for (const item of arr(v)) {
        const ir = rec(item);
        if (!ir) continue;
        for (const [name, on] of Object.entries(ir)) {
          if (on === true) groups[target].push(name);
        }
      }
    }
  }
  for (const k of Object.keys(groups)) groups[k] = uniq(groups[k]).slice(0, 12);
  return groups as WebsiteDataPackage["amenities"];
}

function extractAttributes(raw: AnyRow): string[] {
  // Trust-signal subset (women/black/veteran/family-owned, LGBTQ+ friendly, accessibility)
  const groups = extractAmenityGroups(raw);
  const trust = [
    ...groups.fromTheBusiness,
    ...groups.accessibility.filter((v) => /entrance|parking|restroom|seating/i.test(v)),
  ];
  return uniq(trust).slice(0, 15);
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

function extractBookingLinks(raw: AnyRow): { booking: string[]; menu: string[]; reservation: string[] } {
  const booking: string[] = [];
  const menu: string[] = [];
  const reservation: string[] = [];
  for (const item of arr(pick(raw, "orderBy"))) {
    const r = rec(item);
    const url = s(r?.url);
    if (url) booking.push(url);
  }
  for (const item of arr(pick(raw, "reservations"))) {
    const r = rec(item);
    const url = s(r?.url);
    if (url) reservation.push(url);
  }
  const menuUrl = s(pick(raw, "menu"));
  if (menuUrl) menu.push(menuUrl);
  // Also detect "book"/"schedule" links in description
  return {
    booking: uniq(booking).slice(0, 5),
    menu: uniq(menu).slice(0, 3),
    reservation: uniq(reservation).slice(0, 5),
  };
}

function extractFaq(raw: AnyRow): Array<{ question: string; answer?: string }> {
  const out: Array<{ question: string; answer?: string }> = [];
  for (const item of arr(pick(raw, "questionsAndAnswers"))) {
    const r = rec(item);
    if (!r) continue;
    const question = s(r.question);
    if (!question) continue;
    const answers = arr(r.answers);
    const ans = answers
      .map((a) => s(rec(a)?.answer))
      .filter((v): v is string => Boolean(v));
    out.push({ question, answer: ans[0] });
    if (out.length >= 6) break;
  }
  return out;
}

function extractCompetitors(raw: AnyRow): string[] {
  const out: string[] = [];
  for (const item of arr(pick(raw, "peopleAlsoSearch"))) {
    const r = rec(item);
    const name = s(r?.title) ?? s(r?.name);
    if (name) out.push(name);
  }
  return uniq(out).slice(0, 8);
}

function extractPopularTimes(raw: AnyRow): WebsiteDataPackage["popularTimes"] {
  const pt = arr(pick(raw, "popularTimesHistogram", "popularTimes"));
  if (!pt.length) {
    const ptObj = rec(pick(raw, "popularTimesHistogram"));
    if (!ptObj) return undefined;
  }
  // Best-effort summary: scan { day, hour, occupancyPercent }
  const buckets: Array<{ day: string; hour: number; pct: number }> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isPlain(v)) {
      const r = v as AnyRow;
      const day = s(r.day) ?? s(r.name);
      const hour = n(r.hour);
      const pct = n(r.occupancyPercent) ?? n(r.percent);
      if (day && typeof hour === "number" && typeof pct === "number") buckets.push({ day, hour, pct });
      else Object.values(r).forEach(walk);
    }
  };
  walk(pick(raw, "popularTimesHistogram", "popularTimes"));
  if (!buckets.length) return undefined;
  buckets.sort((a, b) => b.pct - a.pct);
  const top = buckets.slice(0, 3).map((b) => `${b.day} ~${b.hour}:00 (${b.pct}%)`);
  return { summary: `Busiest: ${top.join(", ")}`, busiest: top };
}
function isPlain(v: unknown): v is AnyRow {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function extractLocation(raw: AnyRow) {
  const loc = rec(pick(raw, "location")) ?? {};
  return {
    full: s(pick(raw, "address")),
    neighborhood: s(pick(raw, "neighborhood")),
    street: s(pick(raw, "street")),
    city: s(pick(raw, "city")),
    state: s(pick(raw, "state")),
    country: s(pick(raw, "countryCode", "country")),
    postalCode: s(pick(raw, "postalCode")),
    lat: n(loc.lat),
    lng: n(loc.lng),
    plusCode: s(pick(raw, "plusCode")),
    googleMapsUrl: s(pick(raw, "url")),
  };
}

function extractValueProps(raw: AnyRow, brandTaglines: string[]): { tagline?: string; candidates: string[]; valueProps: string[] } {
  const candidates: string[] = [...brandTaglines];
  const desc = s(pick(raw, "description"));
  if (desc) {
    // First sentence often = value prop
    const sentences = desc.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    for (const sent of sentences.slice(0, 3)) {
      if (sent.length >= 25 && sent.length <= 140) candidates.push(sent);
    }
  }
  const valueProps: string[] = [];
  for (const block of arr(pick(raw, "additionalInfo"))) {
    const r = rec(block);
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) {
      if (/highlights|from the business|popular for/i.test(k)) {
        for (const item of arr(v)) {
          const ir = rec(item);
          if (!ir) continue;
          for (const [name, on] of Object.entries(ir)) if (on === true) valueProps.push(name);
        }
      }
    }
  }
  return {
    tagline: candidates[0],
    candidates: uniq(candidates).slice(0, 6),
    valueProps: uniq(valueProps).slice(0, 8),
  };
}

function extractReviewStats(raw: AnyRow, reviews: WebsiteDataPackage["reviews"]) {
  const total = n(pick(raw, "reviewsCount"));
  const averageRating = n(pick(raw, "totalScore", "rating"));
  const dist = rec(pick(raw, "reviewsDistribution"));
  const distribution = dist
    ? Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, n(v) ?? 0]))
    : undefined;
  const sampleHighlights = reviews.slice(0, 3).map((r) => r.text.split(/(?<=[.!?])\s/)[0]).filter(Boolean);
  return { averageRating, total, distribution, sampleHighlights };
}

function extractRecentActivity(raw: AnyRow, updates: WebsiteDataPackage["updates"]): WebsiteDataPackage["recentActivity"] {
  const lastUpdate = updates[0]?.date;
  const lastReview = (arr(pick(raw, "reviews"))[0] as AnyRow | undefined);
  const lastReviewDate = s(lastReview?.publishedAtDate) ?? s(lastReview?.publishAt);
  const now = Date.now();
  const daysSince = (d?: string) => {
    if (!d) return undefined;
    const ts = Date.parse(d);
    if (!Number.isFinite(ts)) return undefined;
    return Math.floor((now - ts) / (1000 * 60 * 60 * 24));
  };
  const dsu = daysSince(lastUpdate);
  const dsr = daysSince(lastReviewDate);
  const minDays = [dsu, dsr].filter((v): v is number => typeof v === "number").sort((a, b) => a - b)[0];
  const isActive = typeof minDays === "number" ? minDays <= 60 : false;
  let signal = "Activity unknown";
  if (typeof minDays === "number") {
    if (minDays <= 7) signal = "Very active — posted/reviewed this week";
    else if (minDays <= 30) signal = `Active — last activity ${minDays}d ago`;
    else if (minDays <= 90) signal = `Moderate — last activity ${minDays}d ago`;
    else signal = `Dormant — last activity ${minDays}d ago`;
  }
  return { lastUpdateDate: lastUpdate, lastReviewDate, daysSinceLastUpdate: dsu, daysSinceLastReview: dsr, isActive, signal };
}

function extractGalleryByCategory(raw: AnyRow): Array<{ category: string; count: number; sample?: string }> {
  const out: Array<{ category: string; count: number; sample?: string }> = [];
  for (const item of arr(pick(raw, "imageCategories"))) {
    const r = rec(item);
    if (!r) continue;
    const category = s(r.title) ?? s(r.name);
    const images = arr(r.images);
    if (!category) continue;
    const sample = s(rec(images[0])?.imageUrl) ?? s(rec(images[0])?.url);
    out.push({ category, count: typeof r.count === "number" ? r.count : images.length, sample });
  }
  return out.slice(0, 8);
}

function extractSeoFromBrand(brandRaw: unknown): { metaTitle?: string; metaDescription?: string; keywords: string[] } {
  const root = rec(brandRaw);
  if (!root) return { keywords: [] };
  const brandKit = rec(root.brandKit) ?? {};
  const signals = rec(brandKit.signals) ?? {};
  const meta = rec(signals.meta) ?? {};
  const pages = arr(root.pages);
  const first = rec(pages[0]) ?? {};
  const keywordsStr = s(meta.keywords) ?? s(first.metaKeywords);
  return {
    metaTitle: s(meta.title) ?? s(meta["og:title"]) ?? s(first.metaTitle),
    metaDescription: s(meta.description) ?? s(meta["og:description"]) ?? s(first.metaDescription),
    keywords: keywordsStr ? uniq(keywordsStr.split(/[,;]/).map((x) => x.trim())).slice(0, 12) : [],
  };
}

function extractColorRoles(brandRaw: unknown): WebsiteDataPackage["brand"]["colorRoles"] {
  const root = rec(brandRaw);
  if (!root) return undefined;
  const brandKit = rec(root.brandKit) ?? {};
  const style = rec(brandKit.style) ?? {};
  const sem = rec(style.colorSemantics);
  if (!sem) return undefined;
  const grab = (k: string) => s((sem as AnyRow)[k]);
  const roles = {
    primary: grab("primary"),
    secondary: grab("secondary"),
    accent: grab("accent"),
    background: grab("background"),
    text: grab("text") ?? grab("foreground"),
  };
  return Object.values(roles).some(Boolean) ? roles : undefined;
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
  enrichment?: {
    brandDnaRaw?: unknown;
    instagramRaw?: unknown;
    websiteScreenshot?: string | null;
    websiteScore?: number | null;
    websiteLabel?: string | null;
    websiteAnalysis?: string | null;
  },
  overrides?: Partial<WebsiteDataPackage> | null,
): WebsiteDataPackage {
  const raw = rec(rawLead) ?? {};
  const brand = extractBrandDnaInsights(enrichment?.brandDnaRaw) ?? null;

  const { hero, gallery } = extractGallery(raw);
  const socials = extractSocials(raw);
  if (brand?.instagramUrl && !socials.instagram) socials.instagram = brand.instagramUrl;

  const igRaw = rec(enrichment?.instagramRaw);
  const ig = extractInstagramFromPayload(enrichment?.instagramRaw) ?? extractInstagramFromPayload(raw);

  const reviews = extractReviews(raw);
  const updates = extractUpdates(raw);
  const amenityGroups = extractAmenityGroups(raw);
  const links = extractBookingLinks(raw);
  const valueProps = extractValueProps(raw, brand?.taglines ?? []);
  const location = extractLocation(raw);
  const reviewStats = extractReviewStats(raw, reviews);
  const recentActivity = extractRecentActivity(raw, updates);
  const galleryByCategory = extractGalleryByCategory(raw);
  const seo = extractSeoFromBrand(enrichment?.brandDnaRaw);
  const colorRoles = extractColorRoles(enrichment?.brandDnaRaw);

  // Website quality analysis (split summary into strengths/weaknesses heuristically)
  const wa = enrichment?.websiteAnalysis ?? undefined;
  const websiteAnalysis = enrichment?.websiteScore != null || wa
    ? (() => {
        const weaknesses: string[] = [];
        const strengths: string[] = [];
        if (wa) {
          for (const line of wa.split(/\n|•|-\s+|\.\s+/)) {
            const t = line.trim();
            if (!t || t.length < 8) continue;
            if (/outdated|slow|cluttered|weak|poor|missing|unclear|bad|broken|generic|old/i.test(t)) weaknesses.push(t);
            else if (/modern|clean|fast|clear|strong|good|professional|polished/i.test(t)) strengths.push(t);
          }
        }
        const score = enrichment?.websiteScore ?? undefined;
        if (typeof score === "number" && score < 6 && weaknesses.length === 0) {
          weaknesses.push("Design appears outdated relative to modern standards");
        }
        return {
          score: score ?? undefined,
          label: enrichment?.websiteLabel ?? undefined,
          summary: wa,
          weaknesses: uniq(weaknesses).slice(0, 6),
          strengths: uniq(strengths).slice(0, 6),
          screenshotUrl: enrichment?.websiteScreenshot ?? brand?.screenshotUrl ?? undefined,
        };
      })()
    : undefined;

  const pkg: WebsiteDataPackage = {
    version: WDP_VERSION,
    business: {
      name: s(pick(raw, "title", "name")),
      owner: s(pick(raw, "ownerName")),
      tagline: valueProps.tagline,
      taglineCandidates: valueProps.candidates,
      valueProps: valueProps.valueProps,
      description: brand?.description ?? s(pick(raw, "description")),
      shortDescription: s(pick(raw, "description"))?.split(/(?<=[.!?])\s/)[0],
      categories: extractCategories(raw),
      services: extractServices(raw),
      attributes: extractAttributes(raw),
      priceRange: s(pick(raw, "price", "priceRange")),
      languages: uniq(arr(pick(raw, "languages")).map((l) => (typeof l === "string" ? l : ""))),
      claimed: b(pick(raw, "claimThisBusiness")) ?? b(pick(raw, "isClaimed")),
      permanentlyClosed: b(pick(raw, "permanentlyClosed")),
      serviceArea: uniq(arr(pick(raw, "serviceArea")).map((l) => (typeof l === "string" ? l : ""))),
    },
    contact: {
      phone: s(pick(raw, "phone", "phoneUnformatted")),
      emails: uniq([
        ...(brand?.emails ?? []),
        ...arr(pick(raw, "emails")).map((e) => (typeof e === "string" ? e : "")),
      ]).slice(0, 5),
      address: location,
      hours: extractHours(raw),
      socials,
      bookingLinks: links.booking,
      menuLinks: links.menu,
      reservationLinks: links.reservation,
    },
    brand: {
      logoUrl: brand?.logoUrl,
      colors: (brand?.colors ?? []).slice(0, 6),
      colorRoles,
      fonts: (brand?.fonts ?? []).slice(0, 4),
      tone: brand?.attributes?.join(", ") || brand?.industry,
      personality: brand?.attributes ?? [],
      faviconUrl: brand?.faviconUrl,
    },
    media: {
      heroImage: hero,
      gallery,
      websiteScreenshot: enrichment?.websiteScreenshot ?? brand?.screenshotUrl ?? undefined,
      galleryByCategory,
    },
    reviews,
    reviewStats,
    updates,
    recentActivity,
    amenities: amenityGroups,
    faq: extractFaq(raw),
    popularTimes: extractPopularTimes(raw),
    competitors: extractCompetitors(raw),
    websiteAnalysis,
    seo,
    instagram: ig
      ? {
          handle: ig.username,
          url: ig.url,
          followers: n(igRaw?.followersCount) ?? n(igRaw?.followers),
          following: n(igRaw?.followsCount) ?? n(igRaw?.following),
          postsCount: n(igRaw?.postsCount),
          bio: s(igRaw?.biography) ?? s(igRaw?.bio),
          fullName: s(igRaw?.fullName),
          profilePicUrl: s(igRaw?.profilePicUrl) ?? s(igRaw?.profilePicUrlHD),
          verified: typeof igRaw?.verified === "boolean" ? (igRaw.verified as boolean) : undefined,
          isBusiness: typeof igRaw?.isBusinessAccount === "boolean" ? (igRaw.isBusinessAccount as boolean) : undefined,
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
// Pure JS port of the n8n "Code in JavaScript" + "Code in JavaScript1" nodes.
// Takes raw Apify dataset items + config, returns scored & filtered leads with lovableUrl.

export type ScoreConfig = {
  reviewsMin: number;
  reviewsMax: number;
  ratingMin: number;
  ratingMax: number;
  activeOwnerDays: number;
  scoreThreshold?: number;
  topOnly?: boolean;
};

type AnyRec = Record<string, unknown>;

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function safeDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
function daysAgo(d: Date | null): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function normalizeText(v: unknown): string {
  return String(v || "").toLowerCase().trim();
}
function hasValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}
function getOwnerUpdateDate(j: AnyRec): Date | null {
  const o = j.ownerUpdates as AnyRec | AnyRec[] | undefined;
  const first = Array.isArray(o) ? (o[0] as AnyRec | undefined) : o;
  const candidates = [
    first?.date,
    first?.updatedAt,
    j.ownerUpdateDate,
    j.lastOwnerUpdateDate,
    j.responseFromOwnerDate,
  ];
  for (const c of candidates) {
    const d = safeDate(c);
    if (d) return d;
  }
  return null;
}
function getSocialCount(j: AnyRec): number {
  const keys = [
    "facebooks","instagrams","twitters","youtubes","tiktoks","linkedIns",
    "facebookProfiles","instagramProfiles","twitterProfiles","youtubeProfiles","tiktokProfiles",
  ];
  let n = 0;
  for (const k of keys) {
    const v = j[k];
    if (Array.isArray(v)) n += v.length;
  }
  return n;
}
function getContactCount(j: AnyRec): number {
  let n = 0;
  if (Array.isArray(j.emails)) n += (j.emails as unknown[]).length;
  if (Array.isArray(j.phones)) n += (j.phones as unknown[]).length;
  if (Array.isArray(j.linkedIns)) n += (j.linkedIns as unknown[]).length;
  return n;
}
function scoreRating(r: number): number {
  if (r >= 4.6 && r <= 4.8) return 30;
  if (r >= 4.2 && r < 4.6) return 22;
  if (r > 4.8) return 10;
  if (r < 4.2) return -20;
  return 0;
}
function scoreReviews(c: number): number {
  if (c >= 20 && c <= 50) return 30;
  if (c > 50 && c <= 150) return 25;
  if (c < 20) return -25;
  if (c > 150) return -15;
  return 0;
}
function scoreOwner(d: Date | null): number {
  const days = daysAgo(d);
  if (days === null) return 0;
  if (days <= 14) return 20;
  if (days <= 30) return 16;
  if (days <= 60) return 12;
  if (days <= 120) return 5;
  return -5;
}
function scoreDataDepth(j: AnyRec): number {
  let s = 0;
  if (hasValue(j.website)) s += 8;
  if (hasValue(j.phone) || hasValue(j.phones)) s += 8;
  if (hasValue(j.emails)) s += 10;
  if (hasValue(j.bookingLinks)) s += 8;
  if (hasValue(j.servicesLink)) s += 4;
  if (hasValue(j.reviewsTags)) s += 5;
  if (toNumber(j.imagesCount) > 20) s += 3;
  return s;
}
function scoreOpportunity(j: AnyRec): number {
  const cat = normalizeText(j.categoryName);
  const cats = Array.isArray(j.categories) ? (j.categories as unknown[]).map(normalizeText) : [];
  const combined = [cat, ...cats].join(" | ");
  const hot = ["dentist","cosmetic dentist","medical spa","med spa","spa","clinic","wellness","dental"];
  let s = 0;
  for (const k of hot) if (combined.includes(k)) s += 4;
  return s;
}
function getRedFlags(j: AnyRec, reviews: number, rating: number, owner: Date | null, cfg: ScoreConfig): string[] {
  const f: string[] = [];
  if (reviews < cfg.reviewsMin) f.push("low_reviews");
  if (reviews > cfg.reviewsMax) f.push("too_many_reviews");
  if (rating < cfg.ratingMin) f.push("low_rating");
  if (rating > cfg.ratingMax) f.push("too_high_rating");
  if (!owner) f.push("no_owner_activity");
  if (!hasValue(j.website)) f.push("no_website");
  if (!hasValue(j.phone) && !hasValue(j.phones)) f.push("no_phone");
  if (!hasValue(j.emails)) f.push("no_email");
  return f;
}

export function scoreLeads(items: AnyRec[], cfg: ScoreConfig): AnyRec[] {
  const threshold = cfg.scoreThreshold ?? 70;
  const out: AnyRec[] = [];

  for (const j of items) {
    const reviewsCount = toNumber(j.reviewsCount, 0);
    const totalScore = toNumber(j.totalScore, 0);
    const ownerDate = getOwnerUpdateDate(j);
    const ownerDays = daysAgo(ownerDate);

    const passesReviews = reviewsCount >= cfg.reviewsMin && reviewsCount <= cfg.reviewsMax;
    const passesRating = totalScore >= cfg.ratingMin && totalScore <= cfg.ratingMax;
    const activeOwner = ownerDays !== null && ownerDays <= cfg.activeOwnerDays;

    let leadScore = 0;
    const reasons: string[] = [];

    leadScore += scoreReviews(reviewsCount);
    leadScore += scoreRating(totalScore);
    leadScore += scoreOwner(ownerDate);
    leadScore += scoreDataDepth(j);
    leadScore += scoreOpportunity(j);

    const socialCount = getSocialCount(j);
    const contactCount = getContactCount(j);

    if (socialCount > 0) { leadScore += Math.min(10, socialCount * 2); reasons.push(`social_profiles:${socialCount}`); }
    else leadScore -= 3;

    if (contactCount > 0) { leadScore += Math.min(10, contactCount * 2); reasons.push(`contacts:${contactCount}`); }
    else leadScore -= 3;

    if (hasValue(j.bookingLinks)) { leadScore += 6; reasons.push("booking_available"); }
    if (Array.isArray(j.reviewsTags) && (j.reviewsTags as unknown[]).length > 0) {
      leadScore += 4; reasons.push("has_review_keywords");
    }
    if (activeOwner) reasons.push(`active_owner:${ownerDays}d`);
    if (passesReviews) reasons.push("reviews_in_sweet_spot");
    if (passesRating) reasons.push("rating_in_sweet_spot");

    const redFlags = getRedFlags(j, reviewsCount, totalScore, ownerDate, cfg);

    let tier = "Cold";
    if (leadScore >= 85) tier = "Hot";
    else if (leadScore >= 70) tier = "Warm";
    else if (leadScore >= 50) tier = "Mild";

    const passesMainFilters = passesReviews && passesRating && activeOwner;
    const passed = passesMainFilters || leadScore >= threshold;

    const rejectionReasons: string[] = [];
    if (!passed) {
      if (!passesReviews) {
        rejectionReasons.push(
          reviewsCount < cfg.reviewsMin
            ? `reviews_too_low (${reviewsCount} < ${cfg.reviewsMin})`
            : `reviews_too_high (${reviewsCount} > ${cfg.reviewsMax})`,
        );
      }
      if (!passesRating) {
        rejectionReasons.push(
          totalScore < cfg.ratingMin
            ? `rating_too_low (${totalScore} < ${cfg.ratingMin})`
            : `rating_too_high (${totalScore} > ${cfg.ratingMax})`,
        );
      }
      if (!activeOwner) {
        rejectionReasons.push(
          ownerDays === null
            ? "no_owner_activity"
            : `owner_inactive (${ownerDays}d > ${cfg.activeOwnerDays}d)`,
        );
      }
      if (leadScore < threshold) {
        rejectionReasons.push(`score_below_threshold (${leadScore} < ${threshold})`);
      }
    }

    const enriched: AnyRec = {
      ...j,
      leadScore,
      leadTier: tier,
      passesMainFilters,
      passesReviewsFilter: passesReviews,
      passesRatingFilter: passesRating,
      activeOwner,
      ownerUpdateAgeDays: ownerDays,
      leadReasons: reasons,
      redFlags,
      passed,
      rejectionReasons,
    };

    const prompt =
      "Create a premium, modern, and highly trustworthy website by using the same flow in your instructions for\n\n" +
      JSON.stringify(enriched, null, 2);
    enriched.lovableUrl = "https://lovable.dev/?autosubmit=true#prompt=" + encodeURIComponent(prompt);

    out.push(enriched);
  }

  out.sort((a, b) => (toNumber(b.leadScore) - toNumber(a.leadScore)));
  if (cfg.topOnly) return out.slice(0, 20);
  return out;
}
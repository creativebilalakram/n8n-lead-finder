// Website Data Package (WDP): a clean, stable, high-signal subset of a lead's
// enriched data, used exclusively by the Website Builder flow. The raw Apify
// payloads stay untouched on the row; the WDP is a derived, versioned view.
//
// Bump WDP_VERSION whenever the filter rules below change so the UI can flag
// stale packages and offer a rebuild.
import { extractBrandDnaInsights, extractInstagramFromPayload } from "./brand-dna";

export const WDP_VERSION = 6;

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
    serviceDetails: Array<{ name: string; description?: string }>;
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
  reviewsTags: Array<{ title: string; count: number }>;
  ownerResponses: Array<{ reviewExcerpt: string; response: string; date?: string }>;
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
  leadIntelligence?: {
    score?: number;
    tier?: string;
    redFlags: string[];
    rejectionReasons: string[];
    passed?: boolean;
    ownerUpdateAgeDays?: number;
  };
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

/** Google Places `additionalInfo` is often an OBJECT keyed by group name
 * (e.g. "Service options": [{...}, ...], "Highlights": [...]), but some
 * variants ship it as an array of single-key objects. Normalize to
 * Array<{ group, items: Array<{ label, on }>}> so downstream code is uniform.
 * This was the silent cause of empty attributes / amenities / valueProps. */
function normalizeAdditionalInfo(raw: AnyRow): Array<{ group: string; items: Array<{ label: string; on: boolean }> }> {
  const out: Array<{ group: string; items: Array<{ label: string; on: boolean }> }> = [];
  const push = (group: string, list: unknown) => {
    const items: Array<{ label: string; on: boolean }> = [];
    for (const item of arr(list)) {
      const ir = rec(item);
      if (!ir) continue;
      for (const [label, on] of Object.entries(ir)) {
        if (typeof on === "boolean") items.push({ label, on });
      }
    }
    if (items.length) out.push({ group, items });
  };
  const ai = pick(raw, "additionalInfo");
  if (Array.isArray(ai)) {
    for (const block of ai) {
      const r = rec(block);
      if (!r) continue;
      for (const [k, v] of Object.entries(r)) push(k, v);
    }
  } else if (isPlain(ai)) {
    for (const [k, v] of Object.entries(ai)) push(k, v);
  }
  return out;
}

/** Short descriptions for commonly-detected services. Keeps website builder
 * from rendering bare service names — gives each card a 1-line explainer. */
const SERVICE_DESCRIPTIONS: Record<string, string> = {
  "Dental Implants": "Permanent titanium tooth replacements that restore a natural smile and bite.",
  "Implants": "Permanent titanium tooth replacements that restore a natural smile and bite.",
  "Invisalign": "Clear removable aligners that straighten teeth discreetly without metal braces.",
  "Veneers": "Custom porcelain shells that transform the front of teeth for a flawless smile.",
  "Teeth Whitening": "Professional in-office whitening that brightens teeth several shades safely.",
  "Whitening": "Professional in-office whitening that brightens teeth several shades safely.",
  "Crowns": "Custom-fitted caps that restore strength, shape, and appearance of damaged teeth.",
  "Bridges": "Fixed restorations that fill gaps from missing teeth using neighboring teeth as anchors.",
  "Dentures": "Removable replacements for missing teeth with a natural-looking custom fit.",
  "Root Canal": "Pain-relieving endodontic therapy that saves infected teeth from extraction.",
  "Orthodontics": "Full-spectrum bite correction with braces or aligners for any age.",
  "Braces": "Traditional and modern braces designed to align teeth and correct the bite.",
  "Clear Aligners": "Discreet alternative to braces using a custom series of removable trays.",
  "Cosmetic Dentistry": "Smile-design treatments that enhance appearance, color, shape, and alignment.",
  "Pediatric Dentistry": "Gentle, kid-focused dental care that builds healthy lifelong habits.",
  "Family Dentistry": "Comprehensive care for every age — from first tooth to advanced restorations.",
  "General Dentistry": "Routine cleanings, exams, fillings, and preventive care for lasting oral health.",
  "Sleep Apnea": "Oral-appliance therapy that opens airways for restful, snore-free sleep.",
  "TMJ Treatment": "Targeted therapy to relieve jaw pain, clicking, and headaches caused by TMJ.",
  "TMJ": "Targeted therapy to relieve jaw pain, clicking, and headaches caused by TMJ.",
  "Wisdom Teeth": "Safe, comfortable removal of impacted or problematic wisdom teeth.",
  "Extractions": "Gentle tooth removal with modern techniques for a smooth recovery.",
  "Periodontics": "Specialized gum care to treat and prevent periodontal disease.",
  "Endodontics": "Advanced root-canal expertise that preserves natural teeth.",
  "Oral Surgery": "Surgical solutions for extractions, implants, and complex dental conditions.",
  "Sedation Dentistry": "Anxiety-free dentistry with safe sedation options for relaxed visits.",
  "Emergency Dentistry": "Same-day relief for dental pain, broken teeth, and urgent issues.",
  "Smile Makeover": "A personalized combination of cosmetic treatments to transform your smile.",
  "Botox": "FDA-approved injections that smooth fine lines and wrinkles for a refreshed look.",
  "Dysport": "Fast-acting wrinkle relaxer ideal for frown lines and dynamic wrinkles.",
  "Fillers": "Hyaluronic-acid dermal fillers that restore volume, contour, and youth.",
  "Dermal Fillers": "Hyaluronic-acid dermal fillers that restore volume, contour, and youth.",
  "Lip Filler": "Subtle lip enhancement that adds definition, volume, and natural shape.",
  "Laser Hair Removal": "Long-term hair reduction with safe, fast laser technology for all skin types.",
  "Microneedling": "Collagen-boosting treatment that smooths texture, scars, and fine lines.",
  "Facials": "Customized facials that cleanse, hydrate, and rejuvenate every skin type.",
  "Hydrafacial": "Signature 3-in-1 facial that cleanses, extracts, and hydrates in one session.",
  "Chemical Peel": "Resurfacing peels that reveal smoother, brighter, more even-toned skin.",
  "Coolsculpting": "Non-invasive fat reduction that contours stubborn areas without downtime.",
  "Prp": "PRP therapy that uses your own platelets to regenerate skin and hair.",
  "Ipl": "IPL photofacials that fade sun damage, redness, and pigmentation.",
  "Morpheus8": "Radiofrequency microneedling that tightens skin and remodels deep tissue.",
  "Kybella": "Injectable treatment that permanently dissolves stubborn under-chin fat.",
  "Sculptra": "Collagen-stimulating injectable for gradual, natural-looking volume restoration.",
  "Haircut": "Precision cuts tailored to your face shape, lifestyle, and personal style.",
  "Hair Color": "Custom color services from subtle tones to bold transformations.",
  "Balayage": "Hand-painted highlights for a sun-kissed, low-maintenance finish.",
  "Highlights": "Dimensional highlights designed to brighten and elevate your color.",
  "Extensions": "Premium hair extensions for length, volume, or both — installed seamlessly.",
  "Blowout": "Smooth, voluminous blowouts that last for days.",
  "Keratin": "Smoothing keratin treatments that tame frizz and add brilliant shine.",
  "Lash Extensions": "Semi-permanent lash extensions for fuller, longer, lash-line perfection.",
  "Lash Lift": "Natural-lash lift and tint that opens the eye without extensions.",
  "Brow Lamination": "Set brows in a fuller, fluffier shape that lasts for weeks.",
  "Waxing": "Smooth, precise waxing for face and body with minimal discomfort.",
  "Threading": "Precision brow and facial threading for clean, defined shaping.",
  "Makeup": "Professional makeup application for every occasion and skin tone.",
  "Manicure": "Polished manicures using long-wear formulas and meticulous prep.",
  "Pedicure": "Relaxing pedicures with deep care for healthy, beautiful feet.",
  "Gel Nails": "Long-lasting gel manicures with a high-shine, chip-resistant finish.",
  "Acrylics": "Sculpted acrylic enhancements in any length, shape, and design.",
  "Massage": "Therapeutic massage tailored to relieve tension and restore balance.",
  "Deep Tissue": "Focused deep-tissue work that targets chronic muscle tension.",
  "Swedish Massage": "Classic relaxation massage that eases stress and improves circulation.",
  "Acupuncture": "Traditional acupuncture for pain relief, stress, and whole-body wellness.",
  "Chiropractic": "Hands-on chiropractic care that restores alignment and reduces pain.",
  "Physical Therapy": "Personalized PT plans that rebuild strength, mobility, and confidence.",
  "Consultation": "Complimentary consultations to map out the right plan for your goals.",
};

function extractServices(raw: AnyRow): string[] {
  const out: string[] = [];
  for (const block of normalizeAdditionalInfo(raw)) {
    if (/service options|offerings|highlights|popular for|services/i.test(block.group)) {
      for (const it of block.items) if (it.on) out.push(it.label);
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
  // Mine multiple text surfaces for service keywords
  const textSources = [
    s(pick(raw, "description")),
    s(pick(raw, "subTitle")),
    s(pick(raw, "title")),
    s(pick(raw, "categoryName")),
    ...arr(pick(raw, "categories")).map((c) => (typeof c === "string" ? c : "")),
    ...arr(pick(raw, "questionsAndAnswers")).map((q) => s(rec(q)?.question) ?? ""),
    ...arr(pick(raw, "reviews")).slice(0, 20).map((r) => s(rec(r)?.text) ?? ""),
  ];
  const haystack = textSources.filter(Boolean).join(" \n ").toLowerCase();
  const SERVICE_KEYWORDS = [
    // Dental
    "dental implants", "implants", "invisalign", "veneers", "teeth whitening", "whitening",
    "crowns", "bridges", "dentures", "root canal", "orthodontics", "braces", "clear aligners",
    "cosmetic dentistry", "pediatric dentistry", "family dentistry", "general dentistry",
    "sleep apnea", "tmj treatment", "tmj", "wisdom teeth", "extractions", "extraction",
    "periodontics", "endodontics", "oral surgery", "sedation dentistry", "emergency dentistry",
    "smile makeover", "bonding", "inlays", "onlays", "fluoride treatment", "deep cleaning",
    "gum disease", "preventive care", "dental cleaning", "checkup", "x-rays",
    // MedSpa / cosmetic
    "botox", "dysport", "fillers", "dermal fillers", "lip filler", "laser hair removal",
    "microneedling", "facials", "hydrafacial", "chemical peel", "coolsculpting", "prp",
    "ipl", "skincare", "skin tightening", "morpheus8", "kybella", "sculptra",
    // Beauty / hair
    "haircut", "hair color", "balayage", "highlights", "extensions", "blowout", "keratin",
    "lash extensions", "lash lift", "brow lamination", "waxing", "threading", "makeup",
    "manicure", "pedicure", "gel nails", "acrylics",
    // Wellness
    "massage", "deep tissue", "swedish massage", "acupuncture", "chiropractic", "physical therapy",
    "consultation",
  ];
  for (const kw of SERVICE_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i");
    if (re.test(haystack)) out.push(kw.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return uniq(out).slice(0, 25);
}

/** Pair detected services with short descriptions for the website builder. */
function buildServiceDetails(services: string[]): Array<{ name: string; description?: string }> {
  return services.map((name) => ({ name, description: SERVICE_DESCRIPTIONS[name] }));
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
  for (const block of normalizeAdditionalInfo(raw)) {
    const target = map.find(([re]) => re.test(block.group))?.[1];
    if (!target) continue;
    for (const it of block.items) if (it.on) groups[target].push(it.label);
  }
  for (const k of Object.keys(groups)) groups[k] = uniq(groups[k]).slice(0, 12);
  return groups as WebsiteDataPackage["amenities"];
}

function extractAttributes(raw: AnyRow): string[] {
  // Trust-signal subset (women/black/veteran/family-owned, LGBTQ+ friendly, accessibility)
  const groups = extractAmenityGroups(raw);
  const trust = [
    ...groups.fromTheBusiness,
    ...groups.highlights.filter((v) => /owned|operated|veteran|family|lgbtq|friendly/i.test(v)),
    ...groups.accessibility,
    ...groups.payments,
  ];
  // Mine description for self-described trust phrases
  const desc = `${s(pick(raw, "description")) ?? ""}`;
  const PHRASES = [
    "women-owned", "woman-owned", "black-owned", "veteran-owned", "family-owned",
    "family owned", "lgbtq+ friendly", "minority-owned", "locally owned", "award-winning",
    "board-certified", "board certified", "licensed", "insured", "asian-owned", "latina-owned",
  ];
  for (const p of PHRASES) {
    if (new RegExp(p.replace(/[-+]/g, "\\$&"), "i").test(desc)) {
      trust.push(p.replace(/\b\w/g, (c) => c.toUpperCase()));
    }
  }
  return uniq(trust).slice(0, 20);
}

/** Extract doctor / practitioner names from text: "Dr. Jane Smith", "Jane Smith, DDS". */
function extractOwnerFromText(...texts: Array<string | undefined>): string | undefined {
  const hay = texts.filter(Boolean).join(" \n ");
  if (!hay) return undefined;
  const patterns = [
    /\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'\-]+){1,2})\b/,
    /\b([A-Z][a-z]+\s+[A-Z][a-z'\-]+),?\s+(?:DDS|DMD|MD|DO|PhD|DC|RN|NP|PA|DVM|OD)\b/,
  ];
  for (const re of patterns) {
    const m = hay.match(re);
    if (m) return `Dr. ${m[1]}`.replace(/^Dr\.\s+Dr\.\s+/, "Dr. ");
  }
  return undefined;
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
    if (out.length >= 8) break;
  }
  return out;
}

/** Auto-generate FAQ entries from extracted services + business facts when
 * the GBP Q&A section is empty (which is most leads). These read naturally
 * on a website and beat showing no FAQ at all. */
function buildFaqFallback(
  existing: Array<{ question: string; answer?: string }>,
  raw: AnyRow,
  services: string[],
  hours: Array<{ day: string; hours: string }>,
  amenities: WebsiteDataPackage["amenities"],
): Array<{ question: string; answer?: string }> {
  const out = [...existing];
  const seen = new Set(out.map((f) => f.question.toLowerCase()));
  const add = (q: string, a?: string) => {
    if (seen.has(q.toLowerCase())) return;
    seen.add(q.toLowerCase());
    out.push({ question: q, answer: a });
  };
  const name = s(pick(raw, "title", "name")) ?? "our practice";
  if (services.length) {
    add(
      `What services does ${name} offer?`,
      `We offer ${services.slice(0, 6).join(", ")}${services.length > 6 ? ", and more" : ""}.`,
    );
  }
  if (hours.length) {
    add("What are your hours?", hours.map((h) => `${h.day}: ${h.hours}`).join(" · "));
  }
  const phone = s(pick(raw, "phone", "phoneUnformatted"));
  if (phone) add("How do I book an appointment?", `Call us at ${phone} or use the booking form on this page.`);
  if (amenities.payments.length) add("What payment methods do you accept?", amenities.payments.join(", "));
  if (amenities.accessibility.length) add("Is the location accessible?", amenities.accessibility.join(", "));
  if (amenities.parking.length) add("Do you offer parking?", amenities.parking.join(", "));
  const ins = arr(pick(raw, "additionalInfo")).length || isPlain(pick(raw, "additionalInfo"));
  if (ins) {
    const acceptsInsurance = JSON.stringify(raw).toLowerCase().includes("insurance");
    if (acceptsInsurance) add("Do you accept insurance?", "Yes — please contact us with your provider details and we'll verify coverage.");
  }
  return out.slice(0, 10);
}

/** Title-case a phrase for tagline polish. */
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Industry persona inferred from categories — used to pick the right noun
 * (Dentistry → "dental care", MedSpa → "aesthetic care", Salon → "beauty"). */
function inferIndustryNoun(categories: string[], services: string[]): string {
  const hay = (categories.join(" ") + " " + services.join(" ")).toLowerCase();
  if (/dent|orthodont|endodont|periodont/.test(hay)) return "dental care";
  if (/med ?spa|botox|filler|laser|aesthetic|cosmetic surgery|dermatolog/.test(hay)) return "aesthetic care";
  if (/salon|hair|barber|nail|lash|brow|wax/.test(hay)) return "beauty";
  if (/spa|massage|wellness|acupuncture|chiropract/.test(hay)) return "wellness";
  if (/restaurant|cafe|coffee|bakery|food|bar|pizza/.test(hay)) return "dining";
  if (/gym|fitness|yoga|pilates|crossfit/.test(hay)) return "fitness";
  if (/law|attorney|legal/.test(hay)) return "legal services";
  if (/real estate|realtor|broker/.test(hay)) return "real estate";
  return "service";
}

/** Build several strong, hero-ready tagline candidates from real signals. */
function buildHeroTaglineCandidates(
  taglineCandidates: string[],
  services: string[],
  attributes: string[],
  reviewStats: WebsiteDataPackage["reviewStats"],
  categories: string[],
  city: string | undefined,
  yearEstablished: number | undefined,
): string[] {
  const out: string[] = [];
  const noun = inferIndustryNoun(categories, services);
  const rating = reviewStats.averageRating;
  const total = reviewStats.total ?? 0;
  const top3 = services.slice(0, 3);
  const locale = city ? ` in ${city}` : "";
  const years = yearEstablished ? new Date().getFullYear() - yearEstablished : undefined;

  // 1) Existing strong tagline wins
  const strong = taglineCandidates.find((t) =>
    /award|trusted|leading|premier|top.?rated|board.?certified|expert|voted|#1/i.test(t),
  );
  if (strong) out.push(strong);

  // 2) Rating-led headline
  if (rating && total >= 25) {
    out.push(`${rating.toFixed(1)}★ ${titleCase(noun)}${locale} — Loved by ${total.toLocaleString()}+ Clients`);
  }

  // 3) Service-led promise
  if (top3.length >= 2) {
    out.push(`${top3.slice(0, 2).join(" · ")} & More — Done Right${locale}`);
  }

  // 4) Trust-attribute headline
  const trust = attributes.find((a) => /owned|certified|licensed|award|veteran|family/i.test(a));
  if (trust && top3[0]) {
    out.push(`${trust} — Trusted ${titleCase(noun)}${locale}`);
  }

  // 5) Tenure headline
  if (years && years >= 3) {
    out.push(`${years}+ Years of Exceptional ${titleCase(noun)}${locale}`);
  }

  // 6) Outcome-style fallback
  if (top3[0]) out.push(`Modern ${titleCase(noun)} You Can Smile About${locale}`.replace(" Smile About", noun === "dental care" ? " Smile About" : " Trust"));

  // 7) Whatever original candidates remain
  for (const t of taglineCandidates) if (!out.includes(t)) out.push(t);

  return uniq(out).slice(0, 8);
}

/** Build a conversion-ready set of short value props from concrete signals. */
function buildStrongValueProps(
  attributes: string[],
  services: string[],
  amenities: WebsiteDataPackage["amenities"],
  reviewStats: WebsiteDataPackage["reviewStats"],
  recentActivity: WebsiteDataPackage["recentActivity"],
  hours: Array<{ day: string; hours: string }>,
  yearEstablished: number | undefined,
  claimed: boolean | undefined,
  bookingLinks: string[],
  languages: string[],
  rawDescription: string | undefined,
): string[] {
  const props: string[] = [];
  const add = (p?: string) => { if (p && p.trim()) props.push(p.trim()); };

  // Social proof
  if (reviewStats.averageRating && (reviewStats.total ?? 0) >= 15) {
    add(`${reviewStats.averageRating.toFixed(1)}★ rated by ${(reviewStats.total ?? 0).toLocaleString()}+ clients`);
  }
  // Tenure
  if (yearEstablished) {
    const years = new Date().getFullYear() - yearEstablished;
    if (years >= 2) add(`Serving the community since ${yearEstablished} (${years}+ years)`);
  }
  // Trust attributes
  const trustPriority = ["women-owned", "woman-owned", "black-owned", "veteran-owned", "family-owned", "lgbtq", "minority-owned", "locally owned", "award-winning", "board-certified", "licensed"];
  for (const t of attributes) {
    if (trustPriority.some((k) => t.toLowerCase().includes(k))) add(t);
    if (props.length >= 4) break;
  }
  // Booking convenience
  if (bookingLinks.length) add("Easy online booking — appointments in minutes");
  // Hours
  const dayCount = hours.length;
  const weekendOpen = hours.some((h) => /sat|sun/i.test(h.day) && !/closed/i.test(h.hours));
  if (weekendOpen) add("Open weekends for your convenience");
  else if (dayCount >= 6) add("Open 6+ days a week — flexible scheduling");
  // Accessibility
  if (amenities.accessibility.length) add(`Accessible facility — ${amenities.accessibility.slice(0, 2).join(", ")}`);
  // Parking
  if (amenities.parking.length) add(amenities.parking.find((p) => /free/i.test(p)) ?? amenities.parking[0]);
  // Payments / insurance
  if (amenities.payments.length) {
    const ins = amenities.payments.find((p) => /insurance/i.test(p));
    if (ins) add("Most major insurance accepted");
    const cards = amenities.payments.filter((p) => /credit|debit|nfc|apple pay|google pay/i.test(p));
    if (cards.length) add(`Pay your way — ${cards.slice(0, 3).join(", ")}`);
  } else if (/\binsurance\b/i.test(rawDescription ?? "")) {
    add("Most major insurance accepted");
  }
  // Languages
  if (languages.length > 1) add(`Spoken here: ${languages.slice(0, 4).join(", ")}`);
  // Service breadth
  if (services.length >= 5) add(`${services.length}+ services under one roof`);
  // Activity
  if (recentActivity?.isActive) add("Actively engaged with patients & community");
  // Claimed / verified
  if (claimed) add("Verified business profile");

  return uniq(props).slice(0, 10);
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
  // Filter throwaway openings that aren't real taglines
  const isJunkOpening = (t: string) =>
    /^(welcome to|thank you|located (?:in|at)|come (?:in|visit)|call (?:us|today)|find us|our (?:office|practice|team) is)/i.test(t.trim()) ||
    /^(at\s+[A-Z][\w\s&.,'-]+,\s*we)/i.test(t.trim());

  const candidates: string[] = brandTaglines.filter((t) => !isJunkOpening(t));
  const desc = s(pick(raw, "description"));
  if (desc) {
    const sentences = desc.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
    // Skip junk openings, prefer punchy 25-140 char sentences
    for (const sent of sentences) {
      if (isJunkOpening(sent)) continue;
      if (sent.length >= 25 && sent.length <= 140) candidates.push(sent);
      if (candidates.length >= 8) break;
    }
  }
  // Brand DNA junk fallback if nothing else
  if (candidates.length === 0) candidates.push(...brandTaglines);

  const valueProps: string[] = [];
  // Pulls from BOTH array and object shapes of `additionalInfo` (the silent
  // bug that previously left valueProps empty for most leads).
  for (const block of normalizeAdditionalInfo(raw)) {
    if (/highlights|from the business|popular for|service options/i.test(block.group)) {
      for (const it of block.items) if (it.on) valueProps.push(it.label);
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

/** Aggregated review keywords (e.g. "kind doctor", "gentle care"). */
function extractReviewsTags(raw: AnyRow): Array<{ title: string; count: number }> {
  const out: Array<{ title: string; count: number }> = [];
  for (const item of arr(pick(raw, "reviewsTags"))) {
    const r = rec(item);
    if (!r) continue;
    const title = s(r.title) ?? s(r.name);
    if (!title) continue;
    out.push({ title, count: n(r.count) ?? 0 });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 15);
}

/** Owner replies on reviews — huge personalization signal for outreach. */
function extractOwnerResponses(raw: AnyRow): Array<{ reviewExcerpt: string; response: string; date?: string }> {
  const out: Array<{ reviewExcerpt: string; response: string; date?: string }> = [];
  for (const item of arr(pick(raw, "reviews"))) {
    const r = rec(item);
    if (!r) continue;
    const response =
      s(r.responseFromOwnerText) ??
      s(r.responseFromOwner) ??
      s(rec(r.responseFromOwner)?.text);
    if (!response) continue;
    const reviewText = s(r.text) ?? s(r.reviewText) ?? "";
    out.push({
      reviewExcerpt: reviewText.slice(0, 140),
      response: response.slice(0, 400),
      date: s(r.responseFromOwnerDate) ?? s(r.publishedAtDate),
    });
    if (out.length >= 8) break;
  }
  return out;
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
    leadIntel?: {
      score?: number | null;
      tier?: string | null;
      redFlags?: unknown;
      rejectionReasons?: unknown;
      passed?: boolean | null;
      ownerUpdateAgeDays?: number | null;
    } | null;
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
  const reviewsTags = extractReviewsTags(raw);
  const ownerResponses = extractOwnerResponses(raw);
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
  const services = extractServices(raw);
  const attributes = extractAttributes(raw);
  const hours = extractHours(raw);
  const categories = extractCategories(raw);
  const yearEstablished = n(pick(raw, "yearEstablished", "establishedYear"));
  const claimed = b(pick(raw, "claimThisBusiness")) ?? b(pick(raw, "isClaimed"));
  const languages = uniq(arr(pick(raw, "languages")).map((l) => (typeof l === "string" ? l : "")));
  const heroTaglines = buildHeroTaglineCandidates(
    valueProps.candidates,
    services,
    attributes,
    reviewStats,
    categories,
    location.city,
    yearEstablished,
  );
  const heroValueProp = heroTaglines[0];
  const strongValueProps = buildStrongValueProps(
    attributes,
    services,
    amenityGroups,
    reviewStats,
    recentActivity,
    hours,
    yearEstablished,
    claimed,
    links.booking,
    languages,
    s(pick(raw, "description")),
  );
  const faq = buildFaqFallback(extractFaq(raw), raw, services, hours, amenityGroups);

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
      owner: s(pick(raw, "ownerName")) ?? extractOwnerFromText(
        s(pick(raw, "title")),
        s(pick(raw, "description")),
        brand?.description,
        ...reviews.slice(0, 5).map((r) => r.text),
      ),
      tagline: heroValueProp ?? valueProps.tagline,
      taglineCandidates: uniq([...heroTaglines, ...valueProps.candidates]).slice(0, 8),
      valueProps: uniq([...strongValueProps, ...valueProps.valueProps]).slice(0, 10),
      description: brand?.description ?? s(pick(raw, "description")),
      shortDescription: s(pick(raw, "description"))?.split(/(?<=[.!?])\s/)[0],
      categories,
      services,
      serviceDetails: buildServiceDetails(services),
      attributes,
      priceRange: s(pick(raw, "price", "priceRange")),
      languages,
      claimed,
      yearEstablished,
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
      hours,
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
    reviewsTags,
    ownerResponses,
    reviewStats,
    updates,
    recentActivity,
    amenities: amenityGroups,
    faq,
    popularTimes: extractPopularTimes(raw),
    competitors: extractCompetitors(raw),
    websiteAnalysis,
    seo,
    leadIntelligence: enrichment?.leadIntel
      ? {
          score: enrichment.leadIntel.score ?? undefined,
          tier: enrichment.leadIntel.tier ?? undefined,
          redFlags: uniq(arr(enrichment.leadIntel.redFlags).map((v) => (typeof v === "string" ? v : ""))),
          rejectionReasons: uniq(arr(enrichment.leadIntel.rejectionReasons).map((v) => (typeof v === "string" ? v : ""))),
          passed: enrichment.leadIntel.passed ?? undefined,
          ownerUpdateAgeDays: enrichment.leadIntel.ownerUpdateAgeDays ?? undefined,
        }
      : undefined,
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
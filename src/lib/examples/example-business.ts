// =============================================================================
// EXAMPLE BUSINESS — Reference shape for one fully-enriched lead.
// =============================================================================
// This file is documentation-as-code. It is NOT imported anywhere in the app
// at runtime. Its only purpose is to give a developer (or future you) a clear,
// concrete mental model of:
//
//   1. What a "lead" looks like after all our actors have run.
//   2. Which Apify actor produced which field.
//   3. How the data flows into the Website Builder brief (`website_package`)
//      and into Contact Intelligence (decision makers + emails).
//
// Use this as a reference when:
//   - Adding a new actor / new field to the pipeline.
//   - Debugging "why is field X empty for this lead?".
//   - Onboarding someone new to the codebase.
//
// Everything below is illustrative — values are realistic but fabricated.
// =============================================================================

/**
 * Sources we currently pull data from, in pipeline order.
 *
 * 1. compass~crawler-google-places          → core business + reviews
 * 2. apify/screenshot-url + Lovable AI      → website modernity score
 * 3. tri_angle~fast-instagram-profile-scraper → Instagram stats
 * 4. Brand DNA analyzer (LLM over website)  → tone, colors, value props
 * 5. vdrmota~contact-info-scraper           → emails / phones / socials from site
 * 6. harvestapi~linkedin-company-employees  → decision makers (smart route)
 *    └ fallback: piotrv1001~linkedin-decision-maker-finder
 * 7. anchor~linkedin-to-email               → email for each DM
 *    └ fallback: harvestapi~linkedin-profile-scraper (profile + email search)
 */
export const EXAMPLE_LEAD = {
  // ── Identity ─────────────────────────────────────────────────────────────
  id: "lead_ex_0001",
  name: "Bright Smile Dental Studio",
  placeId: "ChIJExampleBrightSmileDental",       // from Google Maps actor
  website: "https://brightsmiledental.example",
  phone: "+1 (555) 010-2233",
  address: "120 Maple Ave, Austin, TX 78704, USA",

  // ── Google Business Profile signals (compass~crawler-google-places) ──────
  rating: 4.7,
  reviewsCount: 86,
  categoryName: "Cosmetic dentist",
  permanentlyClosed: false,
  lastReviewAgeDays: 18,         // used by scoring → "active owner" check

  // ── Our internal scoring (src/lib/lead-scoring.ts + score-adjust.ts) ─────
  score: 112,                    // base + bonuses (outdated site bonus etc.)
  tier: "Hot",                   // Hot ≥ 85 → triggers auto-enrichment
  qualified: true,               // evaluated live against Settings filters
  rejectionReasons: [] as string[],

  // ── Social links discovered from GBP / website ──────────────────────────
  instagramUrl: "https://instagram.com/brightsmile.atx",
  linkedinCompanyUrl: "https://www.linkedin.com/company/brightsmile-dental",

  // ── Website modernity (apify/screenshot-url + Gemini via AI Gateway) ────
  // Lower score = more outdated = +30 priority bonus (we WANT these leads).
  websiteModernScore: 4,
  websiteLabel: "OUTDATED",
  websiteAnalysis: {
    summary: "Early-2010s template, table layouts, no mobile breakpoints.",
    issues: ["No SSL badge visible", "Stock photography only", "Tiny tap targets"],
    strengths: ["Phone number prominent", "Hours clearly listed"],
  },

  // ── Instagram (tri_angle~fast-instagram-profile-scraper) ────────────────
  instagram: {
    handle: "brightsmile.atx",
    followers: 4280,
    following: 612,
    postsCount: 318,
    bio: "Cosmetic & family dentistry in South Austin · Book ↓",
    externalUrl: "https://brightsmiledental.example/book",
    lastPostAgeDays: 6,
    isBusinessAccount: true,
  },

  // ── Brand DNA (LLM over scraped homepage) ───────────────────────────────
  brand: {
    tone: ["friendly", "professional", "modern-minimal"],
    valueProps: [
      "Same-day crowns",
      "Sedation options for anxious patients",
      "Family-friendly Saturday hours",
    ],
    colors: ["#0EA5A4", "#0F172A", "#F8FAFC"],
    tagline: "Confident smiles, gentle care.",
  },

  // ── Auto-enrichment status (src/routes/api/public/auto-enrich.ts) ───────
  autoEnrichStatus: "completed",
  autoEnrichSteps: {
    screenshot:   { status: "completed", finishedAt: "2026-06-29T10:00:11Z" },
    websiteScore: { status: "completed", finishedAt: "2026-06-29T10:00:24Z" },
    brandDna:     { status: "completed", finishedAt: "2026-06-29T10:01:02Z" },
    instagram:    { status: "completed", finishedAt: "2026-06-29T10:01:40Z" },
  },

  // ── Contact Intelligence (separate `businesses` row + jobs) ─────────────
  // See src/routes/api/public/contacts.enrich.ts
  contactIntel: {
    businessId: "biz_ex_0001",
    routing: "smart",            // "smart" = used linkedin-company-employees
    // Fallback would have been: "fallback-by-name" or "fallback-by-hint"
    websiteContacts: {
      emails: ["hello@brightsmiledental.example", "billing@brightsmiledental.example"],
      phones: ["+1-555-010-2233"],
      linkedins: ["https://www.linkedin.com/company/brightsmile-dental"],
      socials: {
        instagrams: ["https://instagram.com/brightsmile.atx"],
        facebooks:  ["https://facebook.com/brightsmiledental"],
      },
    },
    decisionMakers: [
      {
        personName: "Dr. Alecia Hardy",
        personTitle: "Owner & Lead Dentist",
        personProfileUrl: "https://www.linkedin.com/in/alecia-hardy-dds",
        decisionMakerScore: 190,   // Alecia Hardy +100, "owner" +90
        priority: "High",
        discoverySource: "linkedin-company-employees",
        emails: [
          { email: "alecia@brightsmiledental.example", confidence: "high",
            source: "anchor~linkedin-to-email" },
        ],
      },
      {
        personName: "Jamie Ortiz",
        personTitle: "Practice Manager",
        personProfileUrl: "https://www.linkedin.com/in/jamie-ortiz-pm",
        decisionMakerScore: 55,
        priority: "Medium",
        discoverySource: "linkedin-company-employees",
        emails: [
          { email: "jamie@brightsmiledental.example",
            confidence: "harvestapi-fallback",
            source: "harvestapi~linkedin-profile-scraper" },
        ],
      },
    ],
  },

  // ── UI state we persist ─────────────────────────────────────────────────
  openedAt: null as string | null,   // set when user clicks "Open in Lovable"
} as const;

/**
 * Example of the "Premium Website Architect" brief we send to Lovable when
 * the user clicks "Open in Lovable". Produced by
 * `orderWebsitePackageForExport()` in src/lib/website-package.ts.
 *
 * Note the key order — it is intentional and must stay stable so the AI
 * builder reads role → context → business facts → supporting signals.
 */
export const EXAMPLE_WEBSITE_BRIEF = {
  _role:
    "You are a senior premium website architect at Creative Bilal. " +
    "Design a modern, conversion-focused site for the business below. " +
    "Respect the brand tone and lean on the trust signals provided.",
  _context: {
    goal: "Generate bookings and qualified phone calls.",
    audience: "Local patients in South Austin looking for cosmetic dentistry.",
    primaryCta: "Book a consultation",
    secondaryCta: "Call now",
  },
  business: {
    name: EXAMPLE_LEAD.name,
    category: EXAMPLE_LEAD.categoryName,
    tagline: EXAMPLE_LEAD.brand.tagline,
    valueProps: EXAMPLE_LEAD.brand.valueProps,
    services: ["Cleanings", "Whitening", "Crowns", "Implants", "Sedation dentistry"],
    serviceArea: ["South Austin", "Travis County"],
  },
  trustAndAttributes: {
    rating: EXAMPLE_LEAD.rating,
    reviewsCount: EXAMPLE_LEAD.reviewsCount,
    yearsInBusiness: 12,
    attributes: ["Family-owned", "Wheelchair accessible", "Free parking"],
  },
  brand: EXAMPLE_LEAD.brand,
  media: {
    screenshotUrl: "https://cdn.example/screenshots/brightsmile.png",
    instagramTopPosts: [
      "https://instagram.com/p/exampleA",
      "https://instagram.com/p/exampleB",
    ],
  },
  contact: {
    phone: EXAMPLE_LEAD.phone,
    email: "hello@brightsmiledental.example",
    address: EXAMPLE_LEAD.address,
    bookingUrl: "https://brightsmiledental.example/book",
  },
  reviews: [
    { author: "Maria L.", rating: 5, text: "Dr. Hardy made my anxious 8-year-old laugh. Painless visit." },
    { author: "Tom R.",   rating: 5, text: "Same-day crown, perfect fit. Saved me a second trip." },
  ],
  recentUpdates: [
    { type: "post", ageDays: 6, summary: "New whitening special for summer." },
  ],
  websiteAnalysis: EXAMPLE_LEAD.websiteAnalysis,
  instagram: EXAMPLE_LEAD.instagram,
} as const;

/**
 * Quick map: every field above → which actor / step produced it.
 * Handy when something is missing and you need to know what to re-run.
 */
export const FIELD_PROVENANCE: Record<string, string> = {
  "name, rating, reviewsCount, phone, address, categoryName, placeId":
    "compass~crawler-google-places (initial search)",
  "websiteModernScore, websiteLabel, websiteAnalysis":
    "apify/screenshot-url + Lovable AI Gateway (Gemini)",
  "instagram.*":
    "tri_angle~fast-instagram-profile-scraper",
  "brand.* (tone, valueProps, colors, tagline)":
    "Brand DNA analyzer — LLM over scraped homepage HTML",
  "contactIntel.websiteContacts.*":
    "vdrmota~contact-info-scraper",
  "contactIntel.decisionMakers (smart route)":
    "harvestapi~linkedin-company-employees",
  "contactIntel.decisionMakers (fallback)":
    "piotrv1001~linkedin-decision-maker-finder",
  "decisionMakers[].emails (primary)":
    "anchor~linkedin-to-email",
  "decisionMakers[].emails (fallback)":
    "harvestapi~linkedin-profile-scraper (Profile details + email search)",
  "score, tier, qualified":
    "src/lib/lead-scoring.ts + score-adjust.ts (re-evaluated live against Settings)",
};
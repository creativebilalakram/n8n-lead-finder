
## Goal

Stop dumping every Apify field into the same surface. Keep the **Lead Detail** view as the unfiltered intelligence hub for outreach, and add a new **Website Builder** view that only consumes a small, hand-curated, high-signal payload — the **Website Data Package (WDP)**.

---

## 1. Data flow (new shape)

```text
Apify Actors (GBP, Brand DNA, Instagram, …future)
        │
        ▼
  raw_* columns on `leads`   ◄── unchanged, source of truth
        │
        ▼
  buildWebsitePackage(lead)  ◄── pure function, deterministic
        │
        ▼
  website_package (jsonb)    ◄── cached, versioned, regen-able
        │
        ├──► Lead Detail view  (shows raw + package side-by-side)
        └──► Website Builder view  (shows ONLY package)
                    │
                    ▼
             Website generation flow (LLM/template) gets WDP, never raw
```

Key principle: **raw stays raw, package is derived**. We never mutate raw, and we can re-run `buildWebsitePackage` any time the rules change without re-scraping.

---

## 2. Database changes

Add to `leads`:

- `website_package jsonb` — the cleaned WDP
- `website_package_version int` — bump when rules change so we can detect stale packages
- `website_package_built_at timestamptz`

No new tables needed yet. When we add a 4th/5th source (Yelp, Facebook, etc.) we just add another `raw_*` column and extend the builder — the rest of the app doesn't change.

---

## 3. The Website Data Package (WDP) schema

A single, stable, documented shape. This is the contract the website generator depends on.

```ts
type WebsiteDataPackage = {
  version: 1;
  business: {
    name: string;
    owner?: string;           // doctor / founder name
    tagline?: string;         // from Brand DNA hero candidates
    description?: string;     // short, <300 chars
    categories: string[];
    services: string[];
    attributes: string[];     // women-owned, accessibility, etc.
  };
  contact: {
    phone?: string;
    emails: string[];
    address?: { full: string; city?: string; state?: string; country?: string };
    hours?: Array<{ day: string; open: string; close: string }>;
    socials: { instagram?: string; facebook?: string; tiktok?: string; youtube?: string; linkedin?: string };
  };
  brand: {
    logoUrl?: string;
    colors: string[];         // max 6, deduped, hex
    tone?: string;            // one-liner extracted from Brand DNA
  };
  media: {
    heroImage?: string;
    gallery: string[];        // max ~12, owner-uploaded prioritized
  };
  reviews: Array<{ author: string; rating: number; text: string; date?: string }>; // max 6, filtered
  updates: Array<{ text: string; date?: string; image?: string }>;                   // max 5 latest owner posts
  instagram?: {
    handle: string;
    followers?: number;
    bio?: string;
    verified?: boolean;
  };
};
```

### Filtering rules (codified in builder)

**Reviews kept** when: `rating >= 4`, `text.length between 80 and 400`, not duplicated, prefer ones mentioning service/staff names. Take top 6.

**Gallery kept** when: source is `Owner` first, then `Customer`; dedupe by URL; skip menu/price-list images; cap 12.

**Updates kept**: sort by date desc, take 5.

**Colors**: only valid hex, dedupe case-insensitive, drop near-white/near-black duplicates, cap 6.

**Explicitly dropped (never enter WDP):**
- GBP: `peopleAlsoSearch`, `webResults`, `questionsAndAnswers`, `popularTimes`, `placeId`, `kgmid`, `fid`, `cid`, search metadata, `leadScore`, `rejectionReasons`, `redFlags`
- Brand DNA: `cssVariables`, `campaignInsights`, `trendHistory`, `readabilityScores`, marketing templates, `assetFingerprint` internals, page-by-page dumps
- Instagram: post arrays, hashtags, engagement math, follower lists

---

## 4. Lead Detail view (unchanged purpose, lightly reorganized)

Stays the **outreach cockpit**. Shows everything:

- Existing sections (Contact, Website analysis, Brand signals, Instagram)
- **New tab** at top: `Raw Data` (GBP / Brand DNA / Instagram subtabs) with collapsible JSON viewers
- **New badge**: "WDP ready ✓" or "WDP missing — Rebuild" button

Nothing is hidden here. This is for humans doing outreach.

---

## 5. Website Builder view (new route)

Route: `src/routes/leads.$id.website.tsx` (or a tab inside the lead detail page).

Layout:

```text
┌─ Header: Business name + "Generate Website" CTA ─────────────┐
│  Package version: v1 · built 2m ago · [Rebuild package]      │
├──────────────────────────────────────────────────────────────┤
│  ◐ Brand          ◐ Content         ◐ Media        ◐ Social │
│  logo, colors,    name, tagline,    hero + gallery  IG, FB   │
│  tone preview     services, hours   thumbnails      handles  │
├──────────────────────────────────────────────────────────────┤
│  Reviews (6)              Owner Updates (5)                  │
│  ─ editable cards ─       ─ editable cards ─                 │
├──────────────────────────────────────────────────────────────┤
│  [Preview JSON]   [Copy WDP]   [Send to Website Generator →] │
└──────────────────────────────────────────────────────────────┘
```

Rules for this view:
- **Reads only `website_package`**, never `raw`.
- Every section is editable; edits patch `website_package` (raw stays untouched).
- "Rebuild from raw" button regenerates the package from current rules (warns if unsaved edits).
- "Send to generator" passes the WDP JSON to the website-building flow — that flow no longer touches raw or queries Apify.

---

## 6. Builder implementation

New file `src/lib/website-package.ts`:

```ts
export const WDP_VERSION = 1;
export function buildWebsitePackage(lead: LeadRow): WebsiteDataPackage { … }
```

Pure, no I/O. Unit-testable. Called from:

1. `apify.import.ts` — after a row is upserted, build + store WDP.
2. `brand.analyze.ts`, `instagram.analyze.ts`, `website.analyze.ts` — after each enrichment, rebuild WDP.
3. A `/api/public/leads/rebuild-package` route for bulk rebuilds when rules change.

---

## 7. Scalability for future sources

Adding Yelp/Facebook later means:

1. New `raw_yelp` column + analyzer route.
2. Extend `buildWebsitePackage` to merge that source into the existing WDP fields (e.g. more reviews, more photos) using the same filter rules.
3. WDP shape stays stable → website generator code doesn't change.

---

## 8. Implementation order

1. Add `website_package*` columns (migration).
2. Build `src/lib/website-package.ts` + types + filter rules.
3. Hook builder into all 4 analyzer routes + a manual rebuild endpoint.
4. Backfill existing leads (one-time rebuild).
5. Add Website Builder route/tab consuming only WDP.
6. Add "Raw Data" tab + WDP status badge to Lead Detail.
7. Point existing website generation flow at WDP instead of raw.

---

## Technical notes

- WDP is stored as `jsonb` so we can query into it later (e.g. "leads with >=4 reviews in package").
- `website_package_version` lets the UI show a "stale" badge when `WDP_VERSION` constant is bumped.
- Editable edits in the Builder view are saved into the same column — to keep "rebuild" safe we'll add `website_package_overrides jsonb` so rebuilding only refreshes auto-derived fields and re-applies overrides on top.
- No new auth surface; this is internal tooling, existing `/api/public/*` pattern is reused.

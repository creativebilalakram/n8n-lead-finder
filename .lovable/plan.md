# Lead Generation App — Plan

A clean single-page app that posts search params to your n8n webhook, displays returned leads as premium cards, and gives each lead a one-click **Open in Lovable** button.

## Pages / Routes

Single route `/` (replace placeholder `src/routes/index.tsx`). No auth, no backend, no Lovable Cloud — pure frontend + webhook.

## UI

**Layout**: centered max-w-6xl, soft gradient background, glassmorphism cards, premium typography (Space Grotesk + Inter).

**1. Search Form (top, glass card)**
- Search Keywords — tag input (type, press Enter to add chip). Pre-seeded with example chips.
- Country Code — short text (default `us`)
- Max Places per Search — number (default 10)
- Min Reviews / Max Reviews — number pair (defaults 20 / 150)
- Min Rating / Max Rating — number pair, step 0.1 (defaults 4.2 / 4.8)
- Active Owner Days — number (default 60)
- Big primary "Search Leads" button with loading spinner + disabled state
- Secondary "Clear Results" button (only when results exist)
- Toast errors via existing sonner

**2. Results Header**
- "Found N leads" + tier breakdown chips (Hot / Warm / Mild counts)

**3. Lead Cards Grid** (responsive 1/2/3 cols)
Each card shows:
- Business name + category
- Tier badge (Hot=red, Warm=orange, Mild=yellow) + numeric leadScore
- Address (with map pin icon)
- Rating ⭐ + reviews count
- Phone / Email rows (when present, click-to-call/mail)
- Website link (when present)
- Red flags as small muted pills (e.g. `no_email`, `low_reviews`)
- Big **Open in Lovable** CTA button (gradient) → opens `lovableUrl` in new tab (`target="_blank"`, `rel="noopener"`)

## Data Flow

1. User fills form → click Search Leads
2. POST to `https://creativebilalakram2.app.n8n.cloud/webhook/3aacc2c2-521b-4406-af35-4784f02ab2cd` with JSON body matching form fields
3. Show loading skeleton cards
4. On response: parse array, store in React state + `localStorage` under `lead-gen-results`
5. On mount: hydrate from localStorage so refresh keeps results
6. Clear Results wipes both

**Webhook request payload (sent from form):**
```json
{
  "searchStringsArray": ["Cosmetic Dentist in Frisco, Texas", "..."],
  "countryCode": "us",
  "maxCrawledPlacesPerSearch": 10,
  "reviewsMin": 20,
  "reviewsMax": 150,
  "ratingMin": 4.2,
  "ratingMax": 4.8,
  "activeOwnerDays": 60
}
```

## Required n8n Workflow Changes (you must apply in n8n)

Your current workflow has two issues that the frontend alone cannot fix:

**A. Hardcoded values in "Start Apify Scraping Job1" → make them expressions**
Replace `jsonBody` static values with `{{ $json.X }}` references coming from the Webhook node:
- `searchStringsArray` → `={{ $('Webhook').item.json.body.searchStringsArray }}`
- `countryCode` → `={{ $('Webhook').item.json.body.countryCode }}`
- `maxCrawledPlacesPerSearch` → `={{ $('Webhook').item.json.body.maxCrawledPlacesPerSearch }}`

**B. Hardcoded CONFIG in "Code in JavaScript" → read from webhook body**
At the top of the JS code, replace the static CONFIG block with:
```js
const body = $('Webhook').first().json.body || {};
const CONFIG = {
  reviewsMin: body.reviewsMin ?? 20,
  reviewsMax: body.reviewsMax ?? 150,
  ratingMin: body.ratingMin ?? 4.2,
  ratingMax: body.ratingMax ?? 4.8,
  activeOwnerDays: body.activeOwnerDays ?? 60,
  scoreThreshold: 70,
  topOnly: false
};
```

**C. "Code in JavaScript1" currently strips lead data and returns only `lovableUrl`.**
Change it to keep the lead fields the UI needs:
```js
return $input.all().map(item => {
  const j = item.json;
  const prompt = "Create a premium, modern, and highly trustworthy website by using the same flow in your instructions for\n\n" + JSON.stringify(j, null, 2);
  return {
    json: {
      title: j.title,
      categoryName: j.categoryName,
      address: j.address,
      phone: j.phone,
      emails: j.emails,
      website: j.website,
      totalScore: j.totalScore,
      reviewsCount: j.reviewsCount,
      leadScore: j.leadScore,
      leadTier: j.leadTier,
      redFlags: j.redFlags,
      lovableUrl: "https://lovable.dev/?autosubmit=true#prompt=" + encodeURIComponent(prompt)
    }
  };
});
```

The frontend will be defensive — it renders whatever fields are present, so partial updates still work, but **C** is required for cards to show anything beyond the Lovable button.

## Tech Notes
- TanStack Start route `src/routes/index.tsx`
- TanStack Query mutation for the webhook POST (no loader — public webhook, user-triggered)
- shadcn `Card`, `Input`, `Button`, `Badge`, `Skeleton`, `sonner`
- All styling via Tailwind + design tokens in `src/styles.css` (add gradient + glass utility classes)
- No new packages required

## Out of Scope
- User-configurable webhook URL field (you said you'll later swap it; for now hardcoded constant in one file, easy to change)
- Pagination / filtering of results
- Persisting form values across refresh (only results persist)

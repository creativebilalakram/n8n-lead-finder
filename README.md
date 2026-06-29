# LeadForge — Lead Intelligence & Outreach Automation

LeadForge is a premium, SaaS-style lead generation and enrichment app. It
turns a single Google Maps search into a fully-enriched book of business —
scored, qualified, contact-resolved, and ready for personalized outreach
(including AI-assisted website rebuild briefs).

It started as a thin frontend for an n8n workflow and grew into a full
product: the n8n pipeline has been ported into the app itself, with a
Supabase-backed database, smart Apify orchestration, automatic enrichment,
and a Contact Intelligence Hub embedded directly into every lead.

---

## Highlights

- **One-click lead generation** — search a niche + location, Apify
  `compass~crawler-google-places` runs via a Start + Poll architecture so
  long runs don't hit the Cloudflare Worker timeout.
- **Live scoring & qualification** — `src/lib/lead-scoring.ts` +
  `src/lib/filter-settings.ts` evaluate every lead against user-editable
  thresholds (reviews, rating, active owner) in real time. Change a filter
  in Settings and the entire app re-ranks instantly — nothing is hard-coded
  at import time.
- **Outdated-website bonus** — websites scoring lower on modernity get a
  +30 priority bonus, pushing the best rebuild prospects to the top.
- **Smart deduplication** — `src/lib/lead-identity.ts` collapses dupes by
  `placeId`, normalized website, or name+address.
- **Automatic enrichment for hot leads** — `/api/public/auto-enrich`
  orchestrates website screenshot → AI modernity scoring → Brand DNA +
  Instagram analysis, with incremental persistence and retries.
- **Contact Intelligence Hub (inline)** — embedded in every lead card and
  detail page. Smart routing prefers
  `harvestapi~linkedin-company-employees` when a `/company/` URL is known,
  otherwise falls back to `piotrv1001~linkedin-decision-maker-finder`.
  Emails are resolved via `anchor~linkedin-to-email` with a
  `harvestapi~linkedin-profile-scraper` fallback. Per-step and per-person
  re-runs are supported.
- **All-signals aggregation** — emails, phones, LinkedIn, IG, FB, YT, X,
  TikTok and websites pulled from every source (GBP, website scrape,
  Brand DNA, Instagram actor, decision makers) with provenance chips.
- **"Open in Lovable" website brief** — `src/lib/website-package.ts`
  produces a deterministic Premium Website Architect brief (`_role`,
  `_context`, business, brand, media, contact, reviews, websiteAnalysis,
  instagram…) so the rebuild prompt always has the same shape and never
  ships with missing data. Per-lead lock prevents duplicate tabs from
  rapid multi-clicks (`src/lib/lovable-open.ts`).
- **Apify run history sync** — import past Apify runs into the local
  database from `/runs`.
- **Analytics tab** — qualification %, per-filter rejection breakdown,
  tier distribution, outreach progress, dedup ratios.

---

## Tech stack

- **Frontend / SSR**: TanStack Start v1 + React 19 + Vite 7
- **Styling**: Tailwind CSS v4 (via `src/styles.css`), shadcn/ui
- **Backend**: Lovable Cloud (Supabase) — `search_runs`, `leads`,
  `app_settings`, `businesses`, `contact_jobs`, `website_contacts`,
  `decision_makers`, `linkedin_emails`
- **Server logic**: TanStack `createServerFn` + public routes under
  `src/routes/api/public/*` for Apify orchestration
- **AI**: Lovable AI Gateway (Gemini) for website modernity scoring
- **Data sources**: Apify actors —
  `compass~crawler-google-places`, `apify~screenshot-url`,
  `vdrmota~contact-info-scraper`, Instagram + Brand DNA scrapers,
  `harvestapi~linkedin-company-employees`,
  `piotrv1001~linkedin-decision-maker-finder`,
  `anchor~linkedin-to-email`,
  `harvestapi~linkedin-profile-scraper`

---

## Project layout

```
src/
  routes/                    # File-based routes (TanStack Start)
    index.tsx                # Search entry
    search.tsx               # Active run + results
    leads.index.tsx          # All leads (Qualified / Filtered Out tabs)
    leads.$id.tsx            # Lead detail (enrichment + Contact Intel)
    website.$id.tsx          # Website brief preview
    history.*                # Past search runs
    runs.tsx                 # Apify run sync
    settings.tsx             # Filters + Analytics
    api/public/*             # Server endpoints (Apify, enrichment, brief)
  lib/
    lead-scoring.ts          # Tiering + qualification
    filter-settings.ts       # Live, user-editable filters
    score-adjust.ts          # Outdated-site priority bonus
    lead-identity.ts         # Dedup keys
    leads-db.ts              # Supabase CRUD
    website-package.ts       # Premium Website Architect brief builder
    contacts-pipeline.server.ts  # Smart routing + fallbacks
    apify-async.server.ts    # Start-poll-fetch helper
    enrichment-runner.server.ts  # Auto-enrich orchestrator
    examples/example-business.ts # Reference business + provenance map
  components/
    lead-card.tsx
    contact-intel-panel.tsx  # Inline Contact Intelligence Hub
    app-sidebar.tsx
```

See `src/lib/examples/example-business.ts` for a fully-annotated example
of one enriched business — useful when onboarding or debugging missing
fields.

---

## Local development

```bash
bun install
bun run dev
```

Lovable Cloud (database + secrets) is provisioned automatically. Required
server secrets: `APIFY_TOKEN`, `LOVABLE_API_KEY` (AI Gateway), Supabase
service role (managed).

---

## Conventions

- App-internal server logic uses `createServerFn`; long-running Apify
  orchestration lives under `src/routes/api/public/*`.
- All UI colors come from semantic tokens in `src/styles.css` — never
  hard-code Tailwind color utilities in components.
- Never edit `src/routeTree.gen.ts`, `src/integrations/supabase/*`
  (auto-generated), or `.env`.
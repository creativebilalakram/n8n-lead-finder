# Contact Intelligence Hub

A new module inside your existing LeadForge app that finds decision makers, enriches website contacts, and resolves LinkedIn → email — orchestrated as a single pipeline per business.

## Scope

Adds a new top-level section accessible from the sidebar: **Contact Intelligence Hub** (route group `/contacts/*`). The existing lead/search/website system stays untouched. Any qualified lead from the Leads page gets a "Run Full Enrichment" button that pushes it into this hub.

## Apify actors wired

1. `vdrmota/contact-info-scraper` — website → emails / phones / socials
2. `piotrv1001/linkedin-decision-maker-finder` — company name (+ LinkedIn URL if found) → people
3. `anchor/linkedin-to-email` — LinkedIn profile URL → verified email

All three run server-side via the existing hardened `apify-async.server.ts` (start → poll → fetch-items) so Cloudflare Worker timeouts don't kill long runs.

## Pipeline orchestration

A single endpoint `POST /api/public/contacts/enrich` accepts `{ businessName, website, leadId? }` and runs:

```text
[contact-info-scraper]  →  websiteContacts (emails, phones, socials, linkedIns)
        │
        ▼
[decision-maker-finder]  ← uses businessName + first discovered LinkedIn URL
        │
        ▼
[filter + score code]   ← exact logic from your n8n Code node (Alecia Hardy priority, blacklist, scoring)
        │
        ▼
[linkedin-to-email]     ← batched, one call per filtered personProfileUrl
        │
        ▼
persist into Supabase, mark business.enrichment_status = completed
```

Each step persists its result immediately (so a later step failing never loses earlier data), and updates a `contact_jobs` row with per-step status (`pending | running | completed | failed`) → drives the Processing Center UI.

## Database (new tables, additive)

- `businesses` — one row per (name + website). Dedup key = normalized website host or `lower(name)`. Linked to optional `lead_id`.
- `decision_makers` — people from actor #2 after filter+score. Unique on `(business_id, person_profile_url)` to prevent duplicate runs piling up.
- `website_contacts` — emails/phones/socials extracted from actor #1, one row per business with JSON arrays.
- `linkedin_emails` — emails resolved by actor #3, FK to `decision_makers`.
- `contact_jobs` — one row per pipeline run, with per-actor status JSON, started/finished timestamps, error text.

Re-running enrichment for the same business updates existing rows (upsert on the unique keys above) instead of creating duplicates — handles your "multiple Apify runs per business without duplication" requirement.

## Filter & scoring logic

Ported verbatim from your n8n Code node into `src/lib/decision-maker-score.ts`:
- Always keep `alecia hardy` (+100)
- Blacklist: SDR/BDR/recruiter/intern/AE/appointment setter
- Whitelist keywords with confidence gate (high or medium + relevant title)
- Score weights: owner 90, founder 85, ceo/president 80, director 60, practice/office manager 55/50, operations 50, marketing 45, creative 40, content 35, dentist 30, implant/cosmetic 20
- Priority badge: `High` if score ≥ 70, `Medium` if ≥ 40, else `Low`
- Settings page exposes the keyword lists + weights so they're editable later

## UI

New sidebar group "Contact Intelligence" with sub-routes:

- `/contacts` — **Overview Dashboard**: counts of businesses processed, decision makers found, emails extracted, pipelines running, last 10 runs.
- `/contacts/decision-makers` — table: Name · Title · Company · Score · Priority badge · LinkedIn (copy) · Email (copy if resolved) · actions [View, Get Email, Add to Outreach]. Filter by business, score, priority.
- `/contacts/website-contacts` — accordion per business: emails, phones, socials grid (Instagram/Facebook/TikTok/Twitter/YouTube with copy buttons).
- `/contacts/emails` — flat list of every resolved email with source person + confidence, copy-all and CSV export.
- `/contacts/processing` — live Processing Center: each `contact_jobs` row with three step pills (Website / Decision Makers / LinkedIn→Email) showing Running/Completed/Failed and elapsed time. Auto-refresh every 4s while any job is running.
- `/contacts/rules` — Filters & Rules: shows current keyword lists + score weights (read-only first pass, editable in a follow-up).

Entry points to start a pipeline:
1. `/contacts` has a primary "Run Full Enrichment" form (business name + website).
2. Lead detail page (`/leads/$id`) gets a "Run Contact Enrichment" button that pre-fills from the lead.

## UX details

- Glassmorphism cards matching existing LeadForge style — no new design system.
- Each step shows a spinner with the actor name while running; toast on completion/failure.
- Copy buttons everywhere (LinkedIn URL, email, phone) with a 1s "Copied" tick.
- Manual promote/demote on the decision-makers table writes `manual_score_override` so the user's choices survive re-runs.
- Duplicate-safe: re-clicking "Run Full Enrichment" on an in-flight job no-ops with a toast.

## Technical notes

- All actor calls go through `src/lib/apify-async.server.ts` (already hardened with retries + long polling).
- New server route files: `src/routes/api/public/contacts.enrich.ts`, `contacts.status.ts` (poll job state), `contacts.list.ts` (paged reads).
- Score + filter logic lives in `src/lib/decision-maker-score.ts` and is unit-callable so the Rules page can preview it.
- One Supabase migration adds the 5 tables with GRANTs and an open RLS policy (matching existing project posture).
- The full pipeline kicks off in the background; the client polls `contacts.status` rather than holding an HTTP connection — Worker-safe.

## Out of scope (clearly)

- Outreach sending (we store "Add to Outreach" as a flag for now; sending is a follow-up).
- Editable rules UI (read-only first pass).
- Authentication / multi-user (project remains single-tenant as today).

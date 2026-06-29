# Contact Hub — Plan

Additive feature for manual ContactOut data + outreach tracking. Existing scoring, enrichment, and lead pipeline untouched.

## 1. Database migration

Two new tables (open-access RLS to match existing tables).

**`dm_contacts`** — per-decision-maker channels
- FKs: `decision_maker_id → decision_makers(id)`, `lead_id → leads(id)` (both ON DELETE CASCADE)
- Identity: `full_name`, `first_name`, `last_name`, `role`
- Channels: `personal_email`, `work_email`, `phone`, `whatsapp`, `linkedin_url`, `instagram_handle`, `facebook_url`, `twitter_handle`
- Provenance: `source` (`contactout-manual` | `apify` | `pdl` | `manual-research`), `confidence` (`verified` | `likely` | `guessed`), `notes`
- `created_at`, `updated_at` + update trigger
- Indexes on `lead_id`, `decision_maker_id`

**`business_channels`** — per-business generic contacts (one row per lead)
- FKs: `business_id → businesses(id)`, `lead_id → leads(id)` (CASCADE)
- `generic_emails jsonb default '[]'`, `generic_phones jsonb default '[]'`
- `instagram_url`, `facebook_url`, `tiktok_url`, `linkedin_company_url`, `twitter_url`, `youtube_url`, `whatsapp_business`
- `updated_at` + trigger; unique index on `lead_id` for upsert

**Outreach status (for /inbox)** — add nullable columns to `leads`:
- `outreach_status text` (`null` | `ready` | `sent` | `replied` | `not_interested`)
- `last_action_at timestamptz`
- `last_action_note text`

Standard GRANTs + permissive `Open access` policy on both new tables (consistent with existing schema).

## 2. Lead detail page (`/leads/$id`) — additive panel

**New section above the existing Decision Makers list:** "Business Channels" card
- Auto-seeds from `leads.raw` on first open (emails, phones, instagram/facebook URLs from compass output) — saved via upsert to `business_channels`
- Editable: chip input for emails/phones, plain inputs for socials
- Save → toast

**Per-DM addition:** below each existing decision-maker card render a compact `DmContactsCard`
- If `dm_contacts` row exists: show chips for each filled channel (email/phone/WA/LinkedIn/IG/FB/Twitter) + source/confidence badge
- "Add/Edit Contact Details" button → opens `DmContactModal`

**`DmContactModal`** (sonner toasts):
- Tabs: **Manual fields** | **Quick paste**
- Manual fields: stacked inputs for all `dm_contacts` columns, `source` + `confidence` selects, notes textarea
- Quick paste tab: textarea + "Parse" button. Regex extractors:
  - emails → first match → `work_email`, second → `personal_email`
  - phones (E.164-ish / US patterns) → `phone`, then `whatsapp`
  - `linkedin.com/in/<slug>` → `linkedin_url` + derive first/last name from slug if name empty
  - `instagram.com/<handle>` → `instagram_handle`
  - `facebook.com/<path>` → `facebook_url`
  - `twitter.com|x.com/<handle>` → `twitter_handle`
- LinkedIn paste in the manual `linkedin_url` field also runs slug→name extraction on blur
- Save = upsert keyed on `decision_maker_id`

## 3. New route `/inbox`

`src/routes/inbox.tsx` — table view of qualified Hot leads.

**Query**: leads where `leadTier in ('Hot','Warm')` AND `passed=true` (current qualified set), joined client-side with counts from `dm_contacts` and existing `decision_makers`.

**Columns**: Business · City · Score · Contact Status (🔴/🟡/🟢) · DMs with contacts (`x / y`) · Outreach Status · Last Action · row click → `/leads/$id`

**Contact Status derivation**:
- 🔴 `No contacts` — 0 DMs have any filled channel AND `business_channels` empty
- 🟡 `Has contacts, no outreach` — has channels, `outreach_status` null/`ready`
- 🟢 `Sent` — `outreach_status = 'sent'`
- 💬 `Replied` — `outreach_status = 'replied'`
- ❌ `Not interested` — `outreach_status = 'not_interested'`

**Filter chips** above the table mapped to the statuses above. Quick-action menu per row to set `outreach_status` + auto-stamp `last_action_at`.

## 4. Sidebar

Add a single "Inbox" entry (with `Inbox` lucide icon) to the existing workspace items list in `src/components/app-sidebar.tsx`. No other sidebar changes.

## 5. Files touched / added

**New**
- `supabase/migrations/<ts>_contact_hub.sql` (via migration tool)
- `src/lib/contact-hub-db.ts` — typed CRUD helpers (`upsertDmContact`, `getDmContactsForLead`, `upsertBusinessChannels`, `getBusinessChannels`, `setOutreachStatus`, `getInboxLeads`)
- `src/lib/contact-parse.ts` — pure regex/parse helpers (emails, phones, social URLs, LinkedIn slug → name)
- `src/components/business-channels-card.tsx`
- `src/components/dm-contacts-card.tsx`
- `src/components/dm-contact-modal.tsx`
- `src/routes/inbox.tsx`

**Edited (additive only)**
- `src/routes/leads.$id.tsx` — render `<BusinessChannelsCard leadId raw>` above DM list; render `<DmContactsCard dm leadId>` under each existing DM card
- `src/components/app-sidebar.tsx` — append "Inbox" item

No changes to `/api/public/leads/start`, `/api/public/auto-enrich`, scoring, enrichment runner, or existing Contact Intelligence panel.

## Technical notes

- All DB access uses the browser Supabase client (matches existing patterns; open RLS).
- Validation with zod on modal save (email/url shape, length caps).
- `Business Channels` upsert keyed on `lead_id` (unique index ensures idempotent auto-seed).
- `dm_contacts` upsert keyed on `decision_maker_id`.
- LinkedIn slug parse: split on `-`, capitalize tokens, ignore trailing numeric/random suffixes (`john-smith-1a2b` → John Smith).
- Phone regex tuned for US + intl `+\d{8,15}`; first match → phone, second distinct → whatsapp.
- Inbox row count: single query for qualified leads, then one batched `dm_contacts` count query grouped by `lead_id` to avoid N+1.
- Outreach status changes write `last_action_at = now()` and a short note (`"Marked sent"` etc.) for the Last Action column.

// Server-only outreach prompt builder. Versioned so we can A/B prompts later
// without breaking already-generated drafts (the version is persisted on each
// row in `ai_prompt_version`).

export const PROMPT_VERSION = 1;

export type Channel =
  | "email"
  | "linkedin_dm"
  | "instagram_dm"
  | "whatsapp"
  | "facebook_dm"
  | "twitter_dm";

type LeadLike = Record<string, unknown>;
type DmLike = Record<string, unknown> | null | undefined;

function s(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function pickArr<T = unknown>(value: unknown, max = 6): T[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max) as T[];
}

function deepGet(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

function deriveBrandTone(lead: LeadLike): string {
  const summary = s(lead.brand_dna_summary);
  if (summary) return summary.slice(0, 240);
  const label = s(lead.brand_dna_label);
  return label || "professional";
}

function deriveReviewTags(lead: LeadLike): string[] {
  // Google Maps payload commonly includes reviewsTags
  const fromRaw = deepGet(lead.raw, ["reviewsTags"]);
  if (Array.isArray(fromRaw)) {
    return fromRaw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object") return s((entry as Record<string, unknown>).title);
        return "";
      })
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function deriveTopServices(lead: LeadLike): string[] {
  const fromRaw =
    deepGet(lead.raw, ["additionalInfo", "Service options"]) ||
    deepGet(lead.raw, ["categories"]) ||
    deepGet(lead.raw, ["categoryName"]);
  if (Array.isArray(fromRaw)) return fromRaw.map((v) => s(v)).filter(Boolean).slice(0, 6);
  if (typeof fromRaw === "string") return [fromRaw];
  return [];
}

function deriveRecentUpdates(lead: LeadLike): string[] {
  const updates = deepGet(lead.raw, ["updatesFromCustomers"]) || deepGet(lead.raw, ["posts"]);
  if (!Array.isArray(updates)) return [];
  return updates
    .slice(0, 3)
    .map((u) => {
      if (typeof u === "string") return u;
      if (u && typeof u === "object") return s((u as Record<string, unknown>).text);
      return "";
    })
    .filter(Boolean);
}

function deriveOwnerRespondsToReviews(lead: LeadLike): boolean {
  const reviews = deepGet(lead.raw, ["reviews"]);
  if (!Array.isArray(reviews)) return false;
  return reviews.some((r) => {
    if (!r || typeof r !== "object") return false;
    const reply = (r as Record<string, unknown>).responseFromOwnerText;
    return typeof reply === "string" && reply.trim().length > 10;
  });
}

function deriveYearEstablished(lead: LeadLike): string {
  const direct = s(deepGet(lead.raw, ["openingDate"]) || deepGet(lead.raw, ["yearEstablished"]));
  if (direct) return direct;
  return "unknown";
}

function deriveDemoUrl(lead: LeadLike): string {
  return s(lead.lovable_url) || s(deepGet(lead.website_package, ["demoUrl"])) || "";
}

function deriveModernityReason(lead: LeadLike): string {
  const reason = s(lead.website_analysis);
  if (reason) return reason;
  const score = lead.website_modern_score;
  if (typeof score === "number" && score < 6) {
    return "outdated layout, dated typography, weak mobile experience";
  }
  return "";
}

export type BuildPromptInput = {
  lead: LeadLike;
  dm: DmLike;
  channel: Channel;
  sequenceStep: number;
  recipientType: "decision_maker" | "business_generic";
  recipientHandle?: string | null;
  version?: number;
};

export type BuiltPrompt = {
  system: string;
  user: string;
  demoUrl: string;
  context: Record<string, unknown>;
  promptVersion: number;
};

export function buildOutreachPrompt(input: BuildPromptInput): BuiltPrompt {
  const { lead, dm, channel, sequenceStep, recipientType, version = PROMPT_VERSION } = input;
  const businessName = s(lead.title, "this business");
  const category = s(lead.category, "local business");
  const city = s(lead.city, "your area");
  const yearEstablished = deriveYearEstablished(lead);
  const reviewsCount = s(lead.reviews_count, "0");
  const rating = s(lead.rating, "—");
  const ownerUpdateAgeDays = s(lead.owner_update_age_days, "unknown");
  const topServices = deriveTopServices(lead);
  const brandTone = deriveBrandTone(lead);
  const recentUpdates = deriveRecentUpdates(lead);
  const reviewTags = deriveReviewTags(lead);
  const ownerResponds = deriveOwnerRespondsToReviews(lead);
  const modernityScore = s(lead.website_modern_score, "unknown");
  const modernityLabel = s(lead.website_label, "");
  const modernityReason = deriveModernityReason(lead);
  const demoUrl = deriveDemoUrl(lead) || "(demo URL not yet generated)";

  const firstName = s(dm?.first_name) || s(dm?.full_name).split(" ")[0] || "there";
  const lastName = s(dm?.full_name).split(" ").slice(1).join(" ") || "";
  const role = s(dm?.role, recipientType === "business_generic" ? "the team" : "Decision Maker");

  const system =
    "You are a senior cold outreach copywriter for Creative Bilal Agency, a premium web design + AI systems studio. " +
    "Respond ONLY as valid minified JSON: {\"subject\": string|null, \"body\": string}. No prose outside JSON.";

  const user = `THE OFFER:
We rebuilt ${businessName}'s website as a free premium demo. No strings.
If they love it, they can keep it. If not, no hard feelings.

THE LEAD:
- Business: ${businessName}
- Category: ${category}
- Location: ${city}
- Years established: ${yearEstablished}
- Reviews: ${reviewsCount} at ${rating}★
- Recent owner activity: ${ownerUpdateAgeDays} days ago
- Top services: ${topServices.length ? topServices.join(", ") : "—"}
- Brand tone (from Brand DNA): ${brandTone}
- Recent updates from owner: ${recentUpdates.length ? recentUpdates.join(" | ") : "—"}
- Top review tags (what people love): ${reviewTags.length ? reviewTags.join(", ") : "—"}
- Owner responds personally to reviews: ${ownerResponds ? "yes" : "no"}
- Current website modernity: ${modernityScore}/10 ${modernityLabel ? `(${modernityLabel})` : ""}
- Why it's outdated: ${modernityReason || "n/a"}

THE RECIPIENT:
- Name: ${firstName} ${lastName}
- Role: ${role}
- Channel: ${channel}
- Recipient type: ${recipientType}
- This is touchpoint #${sequenceStep} (0 = first contact)

CHANNEL RULES:
- email: 80-120 words, subject line, clear value, demo link end
- linkedin_dm: 50-80 words, no subject, casual-professional, demo link
- instagram_dm: 30-60 words, very casual, emoji ok, demo link
- whatsapp: 40-70 words, conversational, no formal greeting
- facebook_dm: similar to IG but slightly more formal
- twitter_dm: 30-50 words, very casual, demo link

OUTPUT RULES:
1. Open with something SPECIFIC to their business — a review tag, recent update, or service they offer. NEVER a generic "I came across your website" opener.
2. Acknowledge what they're doing well (use review tags / owner activity)
3. Transition to the demo — frame it as a gift, not a pitch
4. Demo URL to include: ${demoUrl}
5. Close with a low-friction CTA — not "book a call", more like "let me know if you'd like the source code" or "happy to walk you through it"
6. NO superlatives ("amazing", "incredible"). Confident, calm tone.
7. NO mention of "AI" or "automated" — human voice only.
8. Match the brand's energy (clinical vs warm, luxury vs friendly) if detectable.
9. For business_generic recipient_type, address the team, not a person by name.
10. If channel is not "email", set subject to null.

FOLLOW-UP RULES (only if sequenceStep > 0):
- Step 1 (3 days later): Different angle. Highlight a specific section of the demo. Don't say "bumping this up".
- Step 2 (7 days later): Share a specific result/case-study angle.
- Step 3 (14 days later): "Closing the loop" — graceful exit, leave door open.
- Step 4 (30 days later): One last value drop — industry insight, no ask.

Respond ONLY as JSON exactly like:
{"subject":"...","body":"..."}`;

  const context = {
    businessName,
    category,
    city,
    yearEstablished,
    reviewsCount,
    rating,
    ownerUpdateAgeDays,
    topServices,
    brandTone,
    recentUpdates,
    reviewTags,
    ownerResponds,
    modernityScore,
    modernityLabel,
    modernityReason,
    recipient: { firstName, lastName, role, recipientType, channel, sequenceStep },
    demoUrl,
  };

  return { system, user, demoUrl, context, promptVersion: version };
}

// Helper exported for the followup scheduler.
export function followupOffsetMs(step: number): number | null {
  switch (step) {
    case 1: return 3 * 24 * 60 * 60 * 1000;
    case 2: return 7 * 24 * 60 * 60 * 1000;
    case 3: return 14 * 24 * 60 * 60 * 1000;
    case 4: return 30 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

export function _pickArr<T = unknown>(value: unknown, max = 6): T[] {
  return pickArr<T>(value, max);
}

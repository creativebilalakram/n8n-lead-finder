// Shared server-only pipeline helpers for the Contact Intelligence flow.
// Used by both /api/public/contacts/enrich (full run) and
// /api/public/contacts/rerun (single-step re-execution).

import { runApifyActorAsync } from "@/lib/apify-async.server";
import { filterAndScore, type DMCandidate } from "@/lib/decision-maker-score";

export type Json = Record<string, unknown>;

export function env() {
  return {
    supabaseUrl: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    apifyToken: process.env.APIFY_TOKEN!,
  };
}

export async function sb(path: string, init: RequestInit = {}) {
  const { supabaseUrl, serviceKey } = env();
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export async function patchJob(id: string, patch: Json) {
  await sb(`contact_jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
}

export async function updateStep(jobId: string, currentSteps: Json, step: string, payload: Json) {
  const next = { ...(currentSteps as object), [step]: { ...(currentSteps[step] as object || {}), ...payload } } as Json;
  await patchJob(jobId, { steps: next });
  return next;
}

const LINKEDIN_RE = /https?:\/\/(?:[a-z]{2,4}\.)?linkedin\.com\/[A-Za-z0-9._\-\/?%=&#]+/gi;
export function mineLinkedIns(blob: unknown): string[] {
  if (blob == null) return [];
  try {
    const txt = typeof blob === "string" ? blob : JSON.stringify(blob);
    const out = new Set<string>();
    for (const m of txt.matchAll(LINKEDIN_RE)) {
      out.add(m[0].replace(/[)\].,'"<>]+$/g, ""));
    }
    return [...out];
  } catch {
    return [];
  }
}
export function rankLinkedIns(urls: string[]): string[] {
  const score = (u: string) => {
    const l = u.toLowerCase();
    if (l.includes("/company/")) return 3;
    if (l.includes("/school/")) return 2;
    if (l.includes("/in/") || l.includes("/pub/")) return 1;
    return 0;
  };
  return [...new Set(urls)].sort((a, b) => score(b) - score(a));
}

export type LinkedInHint = { url: string; source: string };

// ────────────────────────────────────────────────────────────────────────────
// Smart routing helper: prefer company-employees actor when we have a
// LinkedIn /company/ URL; otherwise fall back to decision-maker-finder.
// ────────────────────────────────────────────────────────────────────────────
export type DiscoveryResult = {
  ok: boolean;
  candidates: DMCandidate[];
  source: "linkedin-company-employees" | "decision-maker-finder";
  companyUrl: string | null;
  rawCount: number;
  error?: string;
};

export function pickCompanyUrl(firstLinkedIn: string, hints: LinkedInHint[]): string | null {
  if (firstLinkedIn && /linkedin\.com\/company\//i.test(firstLinkedIn)) return firstLinkedIn;
  const fromHints = hints.find((h) => /linkedin\.com\/company\//i.test(h.url));
  return fromHints?.url || null;
}

function mapCompanyEmployee(it: Json): DMCandidate | null {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = (it as Json)[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const first = get("firstName", "first_name");
  const last = get("lastName", "last_name");
  const fullFromParts = [first, last].filter(Boolean).join(" ").trim();
  const name = get("name", "fullName") || fullFromParts;
  const positionObj = (it as Json).currentPosition || (it as Json).position;
  const positionTitle =
    (positionObj && typeof positionObj === "object" && typeof (positionObj as Json).title === "string"
      ? ((positionObj as Json).title as string)
      : "") || "";
  const title = get("headline", "title", "occupation", "jobTitle") || positionTitle;
  let url = get("linkedinUrl", "profileUrl", "url", "publicProfileUrl");
  if (!url) {
    const pid = get("publicIdentifier", "username");
    if (pid) url = `https://www.linkedin.com/in/${pid}`;
  }
  if (!name && !url) return null;
  return {
    personName: name || undefined,
    personTitle: title || undefined,
    personProfileUrl: url || undefined,
    confidence: "high", // company-employees results are first-party current employees
    ...it,
  };
}

export async function discoverDecisionMakers(opts: {
  businessName: string;
  firstLinkedIn: string;
  hints: LinkedInHint[];
}): Promise<DiscoveryResult> {
  const { apifyToken } = env();
  const companyUrl = pickCompanyUrl(opts.firstLinkedIn, opts.hints);

  // Smart path: company employees
  if (companyUrl) {
    const run = await runApifyActorAsync<Json>(
      "harvestapi~linkedin-company-employees",
      {
        companies: [companyUrl],
        maxItems: 10,
        profileScraperMode: "Full + email search ($12 per 1k)",
        recentlyChangedJobs: false,
      },
      { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
    );
    if (run.ok) {
      const candidates = run.items
        .map(mapCompanyEmployee)
        .filter((c): c is DMCandidate => Boolean(c));
      return {
        ok: true,
        candidates,
        source: "linkedin-company-employees",
        companyUrl,
        rawCount: run.items.length,
      };
    }
    // fall through to fallback if smart actor fails
  }

  // Fallback: decision-maker-finder
  const companies = [opts.businessName];
  if (opts.firstLinkedIn && !companies.includes(opts.firstLinkedIn)) companies.push(opts.firstLinkedIn);
  for (const h of opts.hints.slice(0, 3)) if (!companies.includes(h.url)) companies.push(h.url);
  const dmRun = await runApifyActorAsync<DMCandidate>(
    "piotrv1001~linkedin-decision-maker-finder",
    { companies, maxPersonsPerCompany: 5, titles: ["CEO","CTO","Founder","Owner","Marketing","Social Media Handler ("] },
    { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
  );
  if (!dmRun.ok) {
    return { ok: false, candidates: [], source: "decision-maker-finder", companyUrl, rawCount: 0, error: dmRun.error };
  }
  return { ok: true, candidates: dmRun.items, source: "decision-maker-finder", companyUrl, rawCount: dmRun.items.length };
}

export async function gatherLeadHints(leadId: string | null) {
  if (!leadId) return { linkedinHints: [] as LinkedInHint[], instagramUrl: null as string | null, websiteFromLead: null as string | null };
  const res = await sb(`leads?id=eq.${leadId}&select=raw,brand_dna_raw,instagram_raw,instagram_url,website`);
  if (!res.ok) return { linkedinHints: [], instagramUrl: null, websiteFromLead: null };
  const rows = (await res.json()) as Json[];
  const row = rows[0];
  if (!row) return { linkedinHints: [], instagramUrl: null, websiteFromLead: null };
  const hints: LinkedInHint[] = [];
  for (const u of rankLinkedIns(mineLinkedIns(row.raw))) hints.push({ url: u, source: "Google Business Profile" });
  for (const u of rankLinkedIns(mineLinkedIns(row.brand_dna_raw))) hints.push({ url: u, source: "Brand DNA" });
  for (const u of rankLinkedIns(mineLinkedIns(row.instagram_raw))) hints.push({ url: u, source: "Instagram bio" });
  const seen = new Set<string>();
  return {
    linkedinHints: hints.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true))),
    instagramUrl: (row.instagram_url as string | null) || null,
    websiteFromLead: (row.website as string | null) || null,
  };
}

function pickWebsiteContacts(items: Json[]) {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const linkedins = new Set<string>();
  const socials: Record<string, string[]> = { instagrams: [], facebooks: [], tiktoks: [], twitters: [], youtubes: [] };
  const pushAll = (arr: unknown, set: Set<string> | string[]) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) if (typeof v === "string" && v.trim()) (set instanceof Set ? set.add(v.trim()) : set.push(v.trim()));
  };
  for (const it of items) {
    pushAll(it.emails, emails);
    pushAll(it.phones, phones);
    pushAll(it.linkedIns, linkedins);
    for (const k of Object.keys(socials)) {
      const arr = (it as Json)[k];
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string") socials[k].push(v);
    }
  }
  for (const k of Object.keys(socials)) socials[k] = [...new Set(socials[k])];
  return { emails: [...emails], phones: [...phones], linkedins: [...linkedins], socials };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 1: website contact scraper
// ────────────────────────────────────────────────────────────────────────────
export async function runWebsiteStep(opts: {
  jobId: string;
  steps: Json;
  businessId: string;
  website: string | null;
}): Promise<{ steps: Json; firstLinkedIn: string; linkedInSource: string }> {
  const { apifyToken } = env();
  let { steps } = opts;
  let firstLinkedIn = "";
  let linkedInSource = "";
  if (!opts.website) {
    steps = await updateStep(opts.jobId, steps, "website", {
      status: "skipped",
      reason: "No website — using LinkedIn hints from GBP/Brand DNA/Instagram",
    });
    return { steps, firstLinkedIn, linkedInSource };
  }
  steps = await updateStep(opts.jobId, steps, "website", { status: "running", startedAt: new Date().toISOString() });
  const run = await runApifyActorAsync<Json>(
    "vdrmota~contact-info-scraper",
    {
      considerChildFrames: true,
      leadsEnrichmentDepartments: ["sales","design","human_resources","information_technology","engineering_technical","product","operations"],
      maxDepth: 2,
      maxRequests: 9999999,
      maxRequestsPerStartUrl: 20,
      maximumLeadsEnrichmentRecords: 3,
      mergeContacts: true,
      sameDomain: true,
      scrapeSocialMediaProfiles: { facebooks: true, instagrams: true, tiktoks: true, twitters: true, youtubes: true },
      startUrls: [{ url: opts.website }],
      useBrowser: false,
      verifyLeadsEnrichmentEmails: true,
    },
    { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
  );
  if (run.ok) {
    const picked = pickWebsiteContacts(run.items);
    firstLinkedIn = picked.linkedins[0] || "";
    if (firstLinkedIn) linkedInSource = "website";
    await sb("website_contacts", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        business_id: opts.businessId,
        emails: picked.emails,
        phones: picked.phones,
        linkedins: picked.linkedins,
        socials: picked.socials,
        raw: run.items.slice(0, 5),
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => {});
    steps = await updateStep(opts.jobId, steps, "website", {
      status: "completed",
      finishedAt: new Date().toISOString(),
      counts: { emails: picked.emails.length, phones: picked.phones.length, socials: Object.values(picked.socials).flat().length },
      linkedinSource: firstLinkedIn ? "website" : null,
      note: firstLinkedIn ? null : "No LinkedIn found on website — will try fallback signals",
    });
  } else {
    steps = await updateStep(opts.jobId, steps, "website", {
      status: "failed",
      error: run.error,
      finishedAt: new Date().toISOString(),
      note: "Website scrape failed — using fallback LinkedIn hints from other actors",
    });
  }
  return { steps, firstLinkedIn, linkedInSource };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 2: decision-maker finder
// ────────────────────────────────────────────────────────────────────────────
export async function runDecisionMakersStep(opts: {
  jobId: string;
  steps: Json;
  businessId: string;
  businessName: string;
  firstLinkedIn: string;
  linkedInSource: string;
  hints: LinkedInHint[];
}): Promise<{ steps: Json; insertedDMs: Json[] }> {
  let { steps } = opts;
  const companyUrl = pickCompanyUrl(opts.firstLinkedIn, opts.hints);
  const willSmartRoute = Boolean(companyUrl);
  steps = await updateStep(opts.jobId, steps, "decision_makers", {
    status: "running",
    startedAt: new Date().toISOString(),
    linkedinSource: willSmartRoute
      ? "linkedin-company-employees"
      : opts.linkedInSource || (opts.firstLinkedIn ? "website" : "name-only"),
    smartRouting: willSmartRoute,
    companyUrl: companyUrl,
    note: willSmartRoute
      ? `Smart routing: fetching current employees of ${companyUrl}`
      : opts.firstLinkedIn
      ? opts.linkedInSource === "website"
        ? "Fallback: decision-maker-finder using website LinkedIn hint"
        : `Fallback: decision-maker-finder using ${opts.linkedInSource}`
      : "Fallback: decision-maker-finder by business name (no company LinkedIn anywhere)",
  });
  const dmRun = await discoverDecisionMakers({
    businessName: opts.businessName,
    firstLinkedIn: opts.firstLinkedIn,
    hints: opts.hints,
  });
  let insertedDMs: Json[] = [];
  if (dmRun.ok) {
    const scored = filterAndScore(dmRun.candidates);
    if (scored.length) {
      const rows = scored.map((p) => ({
        business_id: opts.businessId,
        person_name: p.personName ?? null,
        person_title: p.personTitle ?? null,
        person_profile_url: p.personProfileUrl ?? null,
        confidence: p.confidence ?? null,
        decision_maker_score: p.decisionMakerScore,
        priority: p.priority,
        raw: { ...p, _discoverySource: dmRun.source },
      }));
      const ins = await sb("decision_makers", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(rows),
      });
      if (ins.ok) insertedDMs = (await ins.json()) as Json[];
    }
    steps = await updateStep(opts.jobId, steps, "decision_makers", {
      status: "completed",
      finishedAt: new Date().toISOString(),
      counts: { found: dmRun.rawCount, kept: scored.length },
      discoverySource: dmRun.source,
      companyUrl: dmRun.companyUrl,
      note:
        scored.length === 0
          ? dmRun.source === "linkedin-company-employees"
            ? "Company employees fetched but none matched decision-maker filters"
            : "No qualifying decision makers — try a different LinkedIn company URL"
          : dmRun.source === "linkedin-company-employees"
            ? `Smart routing succeeded — pulled ${dmRun.rawCount} current employees, kept ${scored.length}`
            : `Fallback finder returned ${dmRun.rawCount} candidates, kept ${scored.length}`,
    });
  } else {
    steps = await updateStep(opts.jobId, steps, "decision_makers", {
      status: "failed",
      error: dmRun.error || "Discovery failed",
      discoverySource: dmRun.source,
      finishedAt: new Date().toISOString(),
    });
  }
  return { steps, insertedDMs };
}

// ────────────────────────────────────────────────────────────────────────────
// STEP 3: linkedin-to-email + HarvestAPI fallback
// targetDMs lets a rerun process only specific DMs (e.g. those without
// emails). When omitted, all provided DMs are processed.
// ────────────────────────────────────────────────────────────────────────────
export async function runEmailsStep(opts: {
  jobId: string;
  steps: Json;
  businessId: string;
  dms: Array<{ id: string; person_profile_url: string | null }>;
}): Promise<{ steps: Json; emailsFound: number; fallbackEmailsFound: number }> {
  const { apifyToken } = env();
  let { steps } = opts;
  if (opts.dms.length === 0) {
    steps = await updateStep(opts.jobId, steps, "emails", {
      status: "skipped",
      reason: "No decision makers to resolve emails for",
      finishedAt: new Date().toISOString(),
    });
    return { steps, emailsFound: 0, fallbackEmailsFound: 0 };
  }
  steps = await updateStep(opts.jobId, steps, "emails", {
    status: "running",
    startedAt: new Date().toISOString(),
    note: "Primary: snipercoder bulk LinkedIn email finder (batched)",
  });

  const norm = (s: string) => s.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
  // Extract the LinkedIn handle (/in/<slug> or /pub/<slug>) — the most
  // reliable identity key when HarvestAPI normalizes URLs.
  const handleOf = (u: string | null | undefined): string => {
    if (!u) return "";
    const m = String(u).toLowerCase().match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/);
    return m ? m[1].replace(/\/+$/, "") : "";
  };
  const dmsWithUrl = opts.dms.filter((d): d is { id: string; person_profile_url: string } => !!d.person_profile_url);

  // Build a handle → dm index used by every provider for robust matching.
  const handleIndex = new Map<string, { id: string; person_profile_url: string }>();
  for (const d of dmsWithUrl) {
    const h = handleOf(d.person_profile_url);
    if (h) handleIndex.set(h, d);
  }
  // Match an arbitrary actor item back to one of our DMs.
  const matchItemToDM = (item: Json): { id: string; person_profile_url: string } | undefined => {
    const itemUrl = (item.linkedinUrl ||
      item.linkedin_url ||
      item.profileUrl ||
      item.url ||
      item.input ||
      item.query ||
      item.linkedin_url_or_id) as string | undefined;
    let match = itemUrl ? handleIndex.get(handleOf(String(itemUrl))) : undefined;
    if (!match && itemUrl) {
      match = dmsWithUrl.find(
        (d) =>
          norm(d.person_profile_url) === norm(String(itemUrl)) ||
          norm(String(itemUrl)).includes(norm(d.person_profile_url)) ||
          norm(d.person_profile_url).includes(norm(String(itemUrl))),
      );
    }
    if (!match) {
      const pid = (item.publicIdentifier || item.username) as string | undefined;
      if (pid) match = handleIndex.get(String(pid).toLowerCase().replace(/\/+$/, ""));
    }
    return match;
  };
  // Pull any email-looking values out of a (potentially nested) actor item.
  const extractEmails = (item: Json): Array<{ email: string; confidence?: string }> => {
    const out: Array<{ email: string; confidence?: string }> = [];
    const single = (item.email ||
      item.foundEmail ||
      item.workEmail ||
      item.personalEmail ||
      item.found_email ||
      item.work_email) as string | undefined;
    if (typeof single === "string" && single.includes("@")) out.push({ email: single });
    for (const key of ["emails", "found_emails", "verified_emails"]) {
      const arr = (item as Json)[key];
      if (Array.isArray(arr)) {
        for (const v of arr) {
          if (typeof v === "string" && v.includes("@")) out.push({ email: v });
          else if (v && typeof v === "object" && typeof (v as Json).email === "string") {
            out.push({
              email: (v as Json).email as string,
              confidence: (v as Json).confidence as string | undefined,
            });
          }
        }
      }
    }
    return out;
  };
  const insertEmails = async (dmId: string, source: string, label: string, items: Array<{ email: string; confidence?: string }>) => {
    if (!items.length) return 0;
    const rows = items.map((c) => ({
      decision_maker_id: dmId,
      business_id: opts.businessId,
      email: c.email,
      confidence: c.confidence ?? label,
      raw: { ...c, source },
    }));
    const ins = await sb("linkedin_emails", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
    });
    return ins.ok ? items.length : 0;
  };

  // ── PRIMARY: snipercoder~bulk-linkedin-email-finder (batched) ──────────
  let primaryEmailsFound = 0;
  let primaryError: string | null = null;
  let primaryItemCount = 0;
  let primaryMatchedDMs = 0;
  const remaining = new Map(dmsWithUrl.map((d) => [d.id, d] as const));
  if (dmsWithUrl.length) {
    const sniper = await runApifyActorAsync<Json>(
      "snipercoder~bulk-linkedin-email-finder",
      { linkedin_url_or_ids: dmsWithUrl.map((d) => d.person_profile_url) },
      { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
    );
    if (!sniper.ok) {
      primaryError = sniper.error;
    } else {
      primaryItemCount = sniper.items.length;
      for (const item of sniper.items) {
        const match = matchItemToDM(item);
        if (!match) continue;
        primaryMatchedDMs++;
        const emails = extractEmails(item);
        if (!emails.length) continue;
        const added = await insertEmails(match.id, "snipercoder~bulk-linkedin-email-finder", "snipercoder-primary", emails);
        if (added) {
          primaryEmailsFound += added;
          remaining.delete(match.id);
        }
      }
    }
  }
  const afterPrimary = [...remaining.values()];

  // Persist primary stats BEFORE running fallbacks so the UI sees it ran.
  steps = await updateStep(opts.jobId, steps, "emails", {
    primary: {
      actor: "snipercoder~bulk-linkedin-email-finder",
      ok: !primaryError,
      error: primaryError,
      itemsReturned: primaryItemCount,
      matchedDMs: primaryMatchedDMs,
      emailsFound: primaryEmailsFound,
      profilesQueried: dmsWithUrl.length,
    },
  });

  // ── SECONDARY: HarvestAPI batched profile scraper ──────────────────────
  let secondaryEmailsFound = 0;
  let secondaryError: string | null = null;
  let secondaryItemCount = 0;
  let secondaryMatchedDMs = 0;
  if (afterPrimary.length) {
    steps = await updateStep(opts.jobId, steps, "emails", {
      note: `Primary returned ${primaryEmailsFound} email(s) — falling back to HarvestAPI for ${afterPrimary.length} profile(s)`,
    });
    const harvest = await runApifyActorAsync<Json>(
      "harvestapi~linkedin-profile-scraper",
      {
        profileScraperMode: "Profile details + email search ($10 per 1k)",
        queries: afterPrimary.map((d) => d.person_profile_url),
      },
      { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
    );
    if (!harvest.ok) {
      secondaryError = harvest.error;
    } else {
      secondaryItemCount = harvest.items.length;
      for (const item of harvest.items) {
        const match = matchItemToDM(item);
        if (!match || !remaining.has(match.id)) continue;
        secondaryMatchedDMs++;
        const emails = extractEmails(item);
        if (!emails.length) continue;
        const added = await insertEmails(match.id, "harvestapi~linkedin-profile-scraper", "harvestapi-secondary", emails);
        if (added) {
          secondaryEmailsFound += added;
          remaining.delete(match.id);
        }
      }
    }
  }
  steps = await updateStep(opts.jobId, steps, "emails", {
    secondary: {
      actor: "harvestapi~linkedin-profile-scraper",
      ran: afterPrimary.length > 0,
      ok: !secondaryError,
      error: secondaryError,
      itemsReturned: secondaryItemCount,
      matchedDMs: secondaryMatchedDMs,
      emailsFound: secondaryEmailsFound,
      profilesQueried: afterPrimary.length,
    },
  });

  // ── TERTIARY: anchor~linkedin-to-email per remaining profile ───────────
  let tertiaryEmailsFound = 0;
  const afterSecondary = [...remaining.values()];
  if (afterSecondary.length) {
    steps = await updateStep(opts.jobId, steps, "emails", {
      note: `${afterSecondary.length} profile(s) still missing — trying anchor~linkedin-to-email last`,
    });
    for (const dm of afterSecondary) {
      const run = await runApifyActorAsync<Json>(
        "anchor~linkedin-to-email",
        { startUrls: [{ url: dm.person_profile_url, id: "1" }] },
        { token: apifyToken, maxWaitMs: 180_000, pollIntervalMs: 6_000 },
      );
      if (!run.ok) continue;
      const all: Array<{ email: string; confidence?: string }> = [];
      for (const item of run.items) all.push(...extractEmails(item));
      if (!all.length) continue;
      const added = await insertEmails(dm.id, "anchor~linkedin-to-email", "anchor-tertiary", all);
      if (added) {
        tertiaryEmailsFound += added;
        remaining.delete(dm.id);
      }
    }
  }

  const totalFound = primaryEmailsFound + secondaryEmailsFound + tertiaryEmailsFound;
  const stillMissing = remaining.size;
  steps = await updateStep(opts.jobId, steps, "emails", {
    status: "completed",
    finishedAt: new Date().toISOString(),
    counts: {
      emails: totalFound,
      primary: primaryEmailsFound,
      secondary: secondaryEmailsFound,
      tertiary: tertiaryEmailsFound,
    },
    tertiary: {
      actor: "anchor~linkedin-to-email",
      ran: afterSecondary.length > 0,
      emailsFound: tertiaryEmailsFound,
      profilesQueried: afterSecondary.length,
    },
    note:
      totalFound > 0
        ? `Found ${totalFound} email(s) — primary ${primaryEmailsFound}, secondary ${secondaryEmailsFound}, tertiary ${tertiaryEmailsFound}${stillMissing ? `; still missing ${stillMissing}` : ""}`
        : `All three providers returned 0 emails for ${dmsWithUrl.length} profile(s)`,
  });
  return { steps, emailsFound: primaryEmailsFound, fallbackEmailsFound: secondaryEmailsFound + tertiaryEmailsFound };
}
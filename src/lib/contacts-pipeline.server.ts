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
  const { apifyToken } = env();
  let { steps } = opts;
  steps = await updateStep(opts.jobId, steps, "decision_makers", {
    status: "running",
    startedAt: new Date().toISOString(),
    linkedinSource: opts.linkedInSource || (opts.firstLinkedIn ? "website" : "name-only"),
    note: opts.firstLinkedIn
      ? opts.linkedInSource === "website"
        ? "Using company LinkedIn found on website"
        : `Website had no LinkedIn — falling back to ${opts.linkedInSource}`
      : "No company LinkedIn anywhere — searching by business name only",
  });
  const companies = [opts.businessName];
  if (opts.firstLinkedIn) companies.push(opts.firstLinkedIn);
  for (const h of opts.hints.slice(0, 3)) if (!companies.includes(h.url)) companies.push(h.url);

  const dmRun = await runApifyActorAsync<DMCandidate>(
    "piotrv1001~linkedin-decision-maker-finder",
    { companies, maxPersonsPerCompany: 5, titles: ["CEO","CTO","Founder","Owner","Marketing","Social Media Handler ("] },
    { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
  );
  let insertedDMs: Json[] = [];
  if (dmRun.ok) {
    const scored = filterAndScore(dmRun.items);
    if (scored.length) {
      const rows = scored.map((p) => ({
        business_id: opts.businessId,
        person_name: p.personName ?? null,
        person_title: p.personTitle ?? null,
        person_profile_url: p.personProfileUrl ?? null,
        confidence: p.confidence ?? null,
        decision_maker_score: p.decisionMakerScore,
        priority: p.priority,
        raw: p,
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
      counts: { found: dmRun.items.length, kept: scored.length },
      note: scored.length === 0 ? "No qualifying decision makers — try a different LinkedIn company URL" : null,
    });
  } else {
    steps = await updateStep(opts.jobId, steps, "decision_makers", {
      status: "failed",
      error: dmRun.error,
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
  });

  let emailsFound = 0;
  const noEmailDMs: Array<{ id: string; url: string }> = [];
  for (const dm of opts.dms) {
    const url = dm.person_profile_url;
    if (!url) continue;
    const run = await runApifyActorAsync<Json>(
      "anchor~linkedin-to-email",
      { startUrls: [{ url, id: "1" }] },
      { token: apifyToken, maxWaitMs: 180_000, pollIntervalMs: 6_000 },
    );
    if (!run.ok) { noEmailDMs.push({ id: dm.id, url }); continue; }
    const emails: Array<{ email: string; confidence?: string }> = [];
    for (const item of run.items) {
      const e = (item.email || item.foundEmail || item.workEmail) as string | undefined;
      if (typeof e === "string" && e.includes("@")) emails.push({ email: e, confidence: (item.confidence as string) || undefined });
      const arr = item.emails as unknown;
      if (Array.isArray(arr)) {
        for (const v of arr) {
          if (typeof v === "string" && v.includes("@")) emails.push({ email: v });
          else if (v && typeof v === "object" && typeof (v as Json).email === "string") emails.push({ email: (v as Json).email as string, confidence: (v as Json).confidence as string | undefined });
        }
      }
    }
    if (emails.length) {
      const rows = emails.map((e) => ({
        decision_maker_id: dm.id,
        business_id: opts.businessId,
        email: e.email,
        confidence: e.confidence ?? null,
        raw: e,
      }));
      const ins = await sb("linkedin_emails", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(rows),
      });
      if (ins.ok) emailsFound += emails.length;
    } else {
      noEmailDMs.push({ id: dm.id, url });
    }
  }

  let fallbackEmailsFound = 0;
  let fallbackError: string | null = null;
  if (noEmailDMs.length) {
    steps = await updateStep(opts.jobId, steps, "emails", {
      note: `Primary actor returned no email for ${noEmailDMs.length} profile(s) — trying HarvestAPI fallback`,
    });
    const harvest = await runApifyActorAsync<Json>(
      "harvestapi~linkedin-profile-scraper",
      {
        profileScraperMode: "Profile details + email search ($10 per 1k)",
        queries: noEmailDMs.map((d) => d.url),
      },
      { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
    );
    if (!harvest.ok) {
      fallbackError = harvest.error;
    } else {
      const norm = (s: string) => s.toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
      for (const item of harvest.items) {
        const itemUrl = (item.linkedinUrl || item.profileUrl || item.url || item.input || item.query) as string | undefined;
        const match = itemUrl
          ? noEmailDMs.find((d) => norm(d.url) === norm(String(itemUrl)) || norm(String(itemUrl)).includes(norm(d.url)) || norm(d.url).includes(norm(String(itemUrl))))
          : null;
        const dmId = match?.id;
        const collected: Array<{ email: string; confidence?: string }> = [];
        const e = (item.email || item.foundEmail || item.workEmail || item.personalEmail) as string | undefined;
        if (typeof e === "string" && e.includes("@")) collected.push({ email: e });
        const arr = item.emails as unknown;
        if (Array.isArray(arr)) {
          for (const v of arr) {
            if (typeof v === "string" && v.includes("@")) collected.push({ email: v });
            else if (v && typeof v === "object" && typeof (v as Json).email === "string") collected.push({ email: (v as Json).email as string, confidence: (v as Json).confidence as string | undefined });
          }
        }
        if (!collected.length || !dmId) continue;
        const rows = collected.map((c) => ({
          decision_maker_id: dmId,
          business_id: opts.businessId,
          email: c.email,
          confidence: c.confidence ?? "harvestapi-fallback",
          raw: { ...c, source: "harvestapi~linkedin-profile-scraper" },
        }));
        const ins = await sb("linkedin_emails", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(rows),
        });
        if (ins.ok) fallbackEmailsFound += collected.length;
      }
    }
  }

  steps = await updateStep(opts.jobId, steps, "emails", {
    status: "completed",
    finishedAt: new Date().toISOString(),
    counts: { emails: emailsFound + fallbackEmailsFound, primary: emailsFound, fallback: fallbackEmailsFound },
    note: fallbackError
      ? `Fallback (HarvestAPI) failed: ${fallbackError}`
      : fallbackEmailsFound > 0
        ? `Recovered ${fallbackEmailsFound} email(s) via HarvestAPI fallback`
        : noEmailDMs.length && fallbackEmailsFound === 0
          ? `Neither primary nor HarvestAPI fallback found emails for ${noEmailDMs.length} profile(s)`
          : null,
  });
  return { steps, emailsFound, fallbackEmailsFound };
}
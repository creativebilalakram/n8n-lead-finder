import { createFileRoute } from "@tanstack/react-router";
import { runApifyActorAsync } from "@/lib/apify-async.server";
import { filterAndScore, normalizeBusinessKey } from "@/lib/decision-maker-score";
import { discoverDecisionMakers, pickCompanyUrl, runEmailsStep } from "@/lib/contacts-pipeline.server";

type Json = Record<string, unknown>;

function env() {
  return {
    supabaseUrl: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    apifyToken: process.env.APIFY_TOKEN!,
  };
}

async function sb(path: string, init: RequestInit = {}) {
  const { supabaseUrl, serviceKey } = env();
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return res;
}

async function upsertBusiness(name: string, website: string | null, leadId: string | null) {
  const normalized_key = normalizeBusinessKey(name, website);
  const existing = await sb(`businesses?normalized_key=eq.${encodeURIComponent(normalized_key)}&select=*`);
  const rows = existing.ok ? ((await existing.json()) as Json[]) : [];
  if (rows[0]) return rows[0];
  const created = await sb("businesses", {
    method: "POST",
    body: JSON.stringify({ name, website, normalized_key, lead_id: leadId }),
  });
  const json = (await created.json()) as Json[];
  return json[0];
}

async function createJob(businessId: string) {
  const res = await sb("contact_jobs", {
    method: "POST",
    body: JSON.stringify({
      business_id: businessId,
      status: "running",
      steps: {
        website: { status: "pending" },
        decision_makers: { status: "pending" },
        emails: { status: "pending" },
      },
    }),
  });
  const json = (await res.json()) as Json[];
  return json[0];
}

async function patchJob(id: string, patch: Json) {
  await sb(`contact_jobs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
}

async function updateStep(jobId: string, currentSteps: Json, step: string, payload: Json) {
  const next = { ...(currentSteps as object), [step]: { ...(currentSteps[step] as object || {}), ...payload } } as Json;
  await patchJob(jobId, { steps: next });
  return next;
}

// Mine LinkedIn URLs from any nested JSON blob.
const LINKEDIN_RE = /https?:\/\/(?:[a-z]{2,4}\.)?linkedin\.com\/[A-Za-z0-9._\-\/?%=&#]+/gi;
function mineLinkedIns(blob: unknown): string[] {
  if (blob == null) return [];
  try {
    const txt = typeof blob === "string" ? blob : JSON.stringify(blob);
    const out = new Set<string>();
    for (const m of txt.matchAll(LINKEDIN_RE)) {
      const clean = m[0].replace(/[)\].,'"<>]+$/g, "");
      out.add(clean);
    }
    return [...out];
  } catch {
    return [];
  }
}
function rankLinkedIns(urls: string[]): string[] {
  // company pages first, then school, then in/people
  const score = (u: string) => {
    const l = u.toLowerCase();
    if (l.includes("/company/")) return 3;
    if (l.includes("/school/")) return 2;
    if (l.includes("/in/") || l.includes("/pub/")) return 1;
    return 0;
  };
  return [...new Set(urls)].sort((a, b) => score(b) - score(a));
}

type LinkedInHint = { url: string; source: string };

async function gatherLeadHints(leadId: string | null): Promise<{
  linkedinHints: LinkedInHint[];
  instagramUrl: string | null;
  websiteFromLead: string | null;
}> {
  if (!leadId) return { linkedinHints: [], instagramUrl: null, websiteFromLead: null };
  const res = await sb(
    `leads?id=eq.${leadId}&select=raw,brand_dna_raw,instagram_raw,instagram_url,website`,
  );
  if (!res.ok) return { linkedinHints: [], instagramUrl: null, websiteFromLead: null };
  const rows = (await res.json()) as Json[];
  const row = rows[0];
  if (!row) return { linkedinHints: [], instagramUrl: null, websiteFromLead: null };
  const hints: LinkedInHint[] = [];
  for (const u of rankLinkedIns(mineLinkedIns(row.raw))) hints.push({ url: u, source: "Google Business Profile" });
  for (const u of rankLinkedIns(mineLinkedIns(row.brand_dna_raw))) hints.push({ url: u, source: "Brand DNA" });
  for (const u of rankLinkedIns(mineLinkedIns(row.instagram_raw))) hints.push({ url: u, source: "Instagram bio" });
  // dedupe preserving first-seen source
  const seen = new Set<string>();
  const deduped = hints.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
  return {
    linkedinHints: deduped,
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
    for (const v of arr) {
      if (typeof v === "string" && v.trim()) {
        if (set instanceof Set) set.add(v.trim());
        else set.push(v.trim());
      }
    }
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

async function runPipeline(businessId: string, jobId: string, businessName: string, website: string | null, leadId: string | null) {
  const { apifyToken } = env();
  let steps: Json = {
    website: { status: "pending" },
    decision_makers: { status: "pending" },
    emails: { status: "pending" },
  };

  // Smart fallback: gather LinkedIn hints from previously-enriched lead data
  // (Google Business Profile raw, Brand DNA, Instagram bio). We use these
  // when the website scraper finds no LinkedIn — so the pipeline is never
  // blocked by one weak signal.
  const hints = await gatherLeadHints(leadId);

  // Step 1: contact-info-scraper
  let firstLinkedIn = "";
  let linkedInSource = "";
  if (website) {
    steps = await updateStep(jobId, steps, "website", { status: "running", startedAt: new Date().toISOString() });
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
        startUrls: [{ url: website }],
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
          business_id: businessId,
          emails: picked.emails,
          phones: picked.phones,
          linkedins: picked.linkedins,
          socials: picked.socials,
          raw: run.items.slice(0, 5),
          updated_at: new Date().toISOString(),
        }),
      }).catch(() => {});
      steps = await updateStep(jobId, steps, "website", {
        status: "completed",
        finishedAt: new Date().toISOString(),
        counts: { emails: picked.emails.length, phones: picked.phones.length, socials: Object.values(picked.socials).flat().length },
        linkedinSource: firstLinkedIn ? "website" : null,
        note: firstLinkedIn ? null : "No LinkedIn found on website — will try fallback signals",
      });
    } else {
      steps = await updateStep(jobId, steps, "website", {
        status: "failed",
        error: run.error,
        finishedAt: new Date().toISOString(),
        note: "Website scrape failed — using fallback LinkedIn hints from other actors",
      });
    }
  } else {
    steps = await updateStep(jobId, steps, "website", {
      status: "skipped",
      reason: "No website — using LinkedIn hints from GBP/Brand DNA/Instagram",
    });
  }

  // Fallback: if website didn't yield a LinkedIn, fall back to hints.
  if (!firstLinkedIn && hints.linkedinHints.length) {
    const top = hints.linkedinHints[0];
    firstLinkedIn = top.url;
    linkedInSource = top.source;
  }

  // Step 2: decision-maker-finder
  const companyUrl = pickCompanyUrl(firstLinkedIn, hints.linkedinHints);
  const willSmartRoute = Boolean(companyUrl);
  steps = await updateStep(jobId, steps, "decision_makers", {
    status: "running",
    startedAt: new Date().toISOString(),
    linkedinSource: willSmartRoute
      ? "linkedin-company-employees"
      : linkedInSource || (firstLinkedIn ? "website" : "name-only"),
    smartRouting: willSmartRoute,
    companyUrl,
    note: willSmartRoute
      ? `Smart routing: fetching current employees of ${companyUrl}`
      : firstLinkedIn
      ? linkedInSource === "website"
        ? "Fallback: decision-maker-finder using website LinkedIn hint"
        : `Fallback: decision-maker-finder using ${linkedInSource}`
      : "Fallback: decision-maker-finder by business name (no company LinkedIn anywhere)",
  });
  const dmRun = await discoverDecisionMakers({
    businessName,
    firstLinkedIn,
    hints: hints.linkedinHints,
  });
  let scored: ReturnType<typeof filterAndScore> = [];
  let insertedDMs: Json[] = [];
  if (dmRun.ok) {
    scored = filterAndScore(dmRun.candidates);
    if (scored.length) {
      const rows = scored.map((p) => ({
        business_id: businessId,
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
    steps = await updateStep(jobId, steps, "decision_makers", {
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
    steps = await updateStep(jobId, steps, "decision_makers", { status: "failed", error: dmRun.error || "Discovery failed", discoverySource: dmRun.source, finishedAt: new Date().toISOString() });
  }

  // Step 3: linkedin-to-email per kept person
  steps = await updateStep(jobId, steps, "emails", {
    status: insertedDMs.length === 0 ? "skipped" : "running",
    startedAt: new Date().toISOString(),
    reason: insertedDMs.length === 0 ? "No decision makers to resolve emails for" : undefined,
  });
  if (insertedDMs.length === 0) {
    await patchJob(jobId, { status: "completed", finished_at: new Date().toISOString() });
    await sb(`businesses?id=eq.${businessId}`, {
      method: "PATCH",
      body: JSON.stringify({ enrichment_status: "completed", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    }).catch(() => {});
    return;
  }
  let emailsFound = 0;
  const noEmailDMs: Array<{ id: string; url: string }> = [];
  for (const dm of insertedDMs) {
    const url = dm.person_profile_url as string | null;
    if (!url) continue;
    const run = await runApifyActorAsync<Json>(
      "anchor~linkedin-to-email",
      { startUrls: [{ url, id: "1" }] },
      { token: apifyToken, maxWaitMs: 180_000, pollIntervalMs: 6_000 },
    );
    if (!run.ok) { noEmailDMs.push({ id: dm.id as string, url }); continue; }
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
        business_id: businessId,
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
      noEmailDMs.push({ id: dm.id as string, url });
    }
  }

  // Fallback: harvestapi~linkedin-profile-scraper (Profile details + email search)
  let fallbackEmailsFound = 0;
  let fallbackError: string | null = null;
  if (noEmailDMs.length) {
    steps = await updateStep(jobId, steps, "emails", {
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
          business_id: businessId,
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

  steps = await updateStep(jobId, steps, "emails", {
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

  await patchJob(jobId, { status: "completed", finished_at: new Date().toISOString() });
  await sb(`businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: JSON.stringify({ enrichment_status: "completed", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

export const Route = createFileRoute("/api/public/contacts/enrich")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { businessName?: string; website?: string | null; leadId?: string | null } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const name = (body.businessName || "").trim();
        if (!name) return Response.json({ error: "businessName required" }, { status: 400 });
        let website = (body.website || "").trim() || null;
        if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;

        const biz = await upsertBusiness(name, website, body.leadId ?? null);
        if (!biz) return Response.json({ error: "Failed to upsert business" }, { status: 500 });

        // Don't start a second job if one is already running — but treat
        // jobs older than 5 minutes as dead (Worker likely terminated mid-run)
        // so users aren't blocked forever by a stuck row.
        const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const open = await sb(`contact_jobs?business_id=eq.${biz.id}&status=eq.running&started_at=gte.${staleCutoff}&select=id`);
        const openRows = open.ok ? ((await open.json()) as Json[]) : [];
        if (openRows[0]) {
          return Response.json({ businessId: biz.id, jobId: openRows[0].id, alreadyRunning: true });
        }
        // Mark any older "running" rows for this business as failed so the UI updates.
        await sb(`contact_jobs?business_id=eq.${biz.id}&status=eq.running`, {
          method: "PATCH",
          body: JSON.stringify({ status: "failed", error: "Stuck job auto-cleared", finished_at: new Date().toISOString() }),
        }).catch(() => {});

        const job = await createJob(biz.id as string);
        await sb(`businesses?id=eq.${biz.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enrichment_status: "running", updated_at: new Date().toISOString() }),
        }).catch(() => {});

        // IMPORTANT: must `await` on Cloudflare Workers — a detached promise
        // gets killed the moment the response is sent, which is why jobs were
        // stuck with all steps "pending" and Apify never saw a run.
        try {
          await runPipeline(biz.id as string, job.id as string, name, website, body.leadId ?? null);
        } catch (e) {
          await patchJob(job.id as string, {
            status: "failed",
            error: String((e as Error)?.message || e),
            finished_at: new Date().toISOString(),
          });
        }
        return Response.json({ businessId: biz.id, jobId: job.id });
      },
    },
  },
});
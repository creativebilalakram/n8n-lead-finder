import { createFileRoute } from "@tanstack/react-router";
import { runApifyActorAsync } from "@/lib/apify-async.server";
import { filterAndScore, normalizeBusinessKey, type DMCandidate } from "@/lib/decision-maker-score";

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

async function runPipeline(businessId: string, jobId: string, businessName: string, website: string | null) {
  const { apifyToken } = env();
  let steps: Json = {
    website: { status: "pending" },
    decision_makers: { status: "pending" },
    emails: { status: "pending" },
  };

  // Step 1: contact-info-scraper
  let firstLinkedIn = "";
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
      });
    } else {
      steps = await updateStep(jobId, steps, "website", { status: "failed", error: run.error, finishedAt: new Date().toISOString() });
    }
  } else {
    steps = await updateStep(jobId, steps, "website", { status: "skipped", reason: "No website" });
  }

  // Step 2: decision-maker-finder
  steps = await updateStep(jobId, steps, "decision_makers", { status: "running", startedAt: new Date().toISOString() });
  const companies = [businessName];
  if (firstLinkedIn) companies.push(firstLinkedIn);
  const dmRun = await runApifyActorAsync<DMCandidate>(
    "piotrv1001~linkedin-decision-maker-finder",
    {
      companies,
      maxPersonsPerCompany: 5,
      titles: ["CEO","CTO","Founder","Owner","Marketing","Social Media Handler ("],
    },
    { token: apifyToken, maxWaitMs: 240_000, pollIntervalMs: 6_000 },
  );
  let scored: ReturnType<typeof filterAndScore> = [];
  let insertedDMs: Json[] = [];
  if (dmRun.ok) {
    scored = filterAndScore(dmRun.items);
    if (scored.length) {
      const rows = scored.map((p) => ({
        business_id: businessId,
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
    steps = await updateStep(jobId, steps, "decision_makers", {
      status: "completed",
      finishedAt: new Date().toISOString(),
      counts: { found: dmRun.items.length, kept: scored.length },
    });
  } else {
    steps = await updateStep(jobId, steps, "decision_makers", { status: "failed", error: dmRun.error, finishedAt: new Date().toISOString() });
  }

  // Step 3: linkedin-to-email per kept person
  steps = await updateStep(jobId, steps, "emails", { status: "running", startedAt: new Date().toISOString() });
  let emailsFound = 0;
  for (const dm of insertedDMs) {
    const url = dm.person_profile_url as string | null;
    if (!url) continue;
    const run = await runApifyActorAsync<Json>(
      "anchor~linkedin-to-email",
      { startUrls: [{ url, id: "1" }] },
      { token: apifyToken, maxWaitMs: 180_000, pollIntervalMs: 6_000 },
    );
    if (!run.ok) continue;
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
    }
  }
  steps = await updateStep(jobId, steps, "emails", {
    status: "completed",
    finishedAt: new Date().toISOString(),
    counts: { emails: emailsFound },
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

        // Don't start a second job if one is already running
        const open = await sb(`contact_jobs?business_id=eq.${biz.id}&status=eq.running&select=id`);
        const openRows = open.ok ? ((await open.json()) as Json[]) : [];
        if (openRows[0]) {
          return Response.json({ businessId: biz.id, jobId: openRows[0].id, alreadyRunning: true });
        }

        const job = await createJob(biz.id as string);
        await sb(`businesses?id=eq.${biz.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enrichment_status: "running", updated_at: new Date().toISOString() }),
        }).catch(() => {});

        // Fire-and-forget; client polls /contacts/status
        runPipeline(biz.id as string, job.id as string, name, website).catch(async (e) => {
          await patchJob(job.id as string, { status: "failed", error: String((e as Error)?.message || e), finished_at: new Date().toISOString() });
        });

        return Response.json({ businessId: biz.id, jobId: job.id });
      },
    },
  },
});
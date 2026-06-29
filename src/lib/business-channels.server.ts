// Server-side: run the website contact scraper (vdrmota/contact-info-scraper)
// for a given lead, then merge the result with all other known signals
// (Google Business Profile raw, Instagram raw, Brand DNA raw) into a single
// upserted business_channels row. Smart filter drops post/reel URLs and
// dedupes phones/emails across sources, tracking provenance.

import { runApifyActorAsync } from "@/lib/apify-async.server";
import { mergeChannelsFromSources, mergedToRow } from "@/lib/channel-merge";

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

function pickWebsiteContacts(items: Json[]) {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const linkedins = new Set<string>();
  const socials: Record<string, string[]> = { instagrams: [], facebooks: [], tiktoks: [], twitters: [], youtubes: [] };
  const pushAll = (arr: unknown, set: Set<string>) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) if (typeof v === "string" && v.trim()) set.add(v.trim());
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

export type ChannelRunResult =
  | { ok: true; scraped: boolean; counts: { emails: number; phones: number; socials: number; dropped: number }; reason?: string }
  | { ok: false; error: string };

export async function runContactScraperAndMerge(leadId: string): Promise<ChannelRunResult> {
  const { apifyToken } = env();

  // 1) Load lead signals
  const leadRes = await sb(
    `leads?id=eq.${leadId}&select=id,website,raw,brand_dna_raw,instagram_raw`,
  );
  if (!leadRes.ok) return { ok: false, error: `lead fetch ${leadRes.status}` };
  const [lead] = (await leadRes.json()) as Json[];
  if (!lead) return { ok: false, error: "lead not found" };
  const website = (lead.website as string | null)?.trim() || null;

  // 2) Find associated business (created by the contacts pipeline). Channels
  //    can still be saved without one (lead_id is the canonical key).
  let businessId: string | null = null;
  const bizRes = await sb(`businesses?lead_id=eq.${leadId}&select=id&order=updated_at.desc&limit=1`);
  if (bizRes.ok) {
    const bizRows = (await bizRes.json()) as Array<{ id: string }>;
    businessId = bizRows[0]?.id ?? null;
  }

  // 3) If website exists, scrape it. (Skipped when missing — the merge will
  //    still pull anything from GBP / Instagram / Brand DNA.)
  let websiteContacts: Json | null = null;
  let scraped = false;
  if (website) {
    const run = await runApifyActorAsync<Json>(
      "vdrmota~contact-info-scraper",
      {
        considerChildFrames: true,
        maxDepth: 2,
        maxRequests: 9999999,
        maxRequestsPerStartUrl: 20,
        mergeContacts: true,
        sameDomain: true,
        scrapeSocialMediaProfiles: { facebooks: true, instagrams: true, tiktoks: true, twitters: true, youtubes: true },
        startUrls: [{ url: website }],
        useBrowser: false,
      },
      { token: apifyToken, maxWaitMs: 180_000, pollIntervalMs: 6_000 },
    );
    if (run.ok) {
      const picked = pickWebsiteContacts(run.items);
      websiteContacts = picked as unknown as Json;
      scraped = true;
      // Cache in website_contacts so the rest of the app sees it too.
      if (businessId) {
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
      }
    }
  }

  // 4) Pull any existing website_contacts row (covers prior scrapes when this
  //    run skipped or failed).
  if (!websiteContacts && businessId) {
    const wcRes = await sb(
      `website_contacts?business_id=eq.${businessId}&select=*&order=updated_at.desc&limit=1`,
    );
    if (wcRes.ok) {
      const rows = (await wcRes.json()) as Json[];
      if (rows[0]) websiteContacts = rows[0];
    }
  }

  // 5) Merge with smart filter (drops post/reel URLs, dedupes, ranks sources).
  const merged = mergeChannelsFromSources({
    gbpRaw: lead.raw,
    websiteContacts,
    instagramRaw: lead.instagram_raw,
    brandDnaRaw: lead.brand_dna_raw,
  });
  const row = mergedToRow(merged);

  // 6) Upsert business_channels (lead_id is the conflict target).
  const upsert = await sb("business_channels", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      ...row,
      lead_id: leadId,
      business_id: businessId,
      auto_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!upsert.ok) {
    const txt = await upsert.text().catch(() => "");
    return { ok: false, error: `business_channels upsert ${upsert.status}: ${txt.slice(0, 200)}` };
  }

  return {
    ok: true,
    scraped,
    reason: !website ? "No website — merged GBP/IG/Brand signals only" : undefined,
    counts: {
      emails: row.generic_emails.length,
      phones: row.generic_phones.length,
      socials: [row.instagram_url, row.facebook_url, row.tiktok_url, row.linkedin_company_url, row.twitter_url, row.youtube_url].filter(Boolean).length,
      dropped: merged.droppedNonProfile,
    },
  };
}
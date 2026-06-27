// Server-only helper: rebuild a single lead's WDP via Supabase REST.
// Used by analyzer routes after they persist new enrichment data.
import { buildWebsitePackage, WDP_VERSION, mergeOverrides, type WebsiteDataPackage } from "./website-package";

export async function rebuildWebsitePackageServer(leadId: string): Promise<WebsiteDataPackage | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const getRes = await fetch(
    `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=raw,brand_dna_raw,instagram_raw,website_screenshot_url,website_modern_score,website_label,website_analysis,website_package_overrides,lead_score,lead_tier,red_flags,rejection_reasons,passed,owner_update_age_days`,
    { headers },
  );
  if (!getRes.ok) return null;
  const rows = (await getRes.json()) as Array<Record<string, unknown>>;
  const lead = rows[0];
  if (!lead) return null;

  const base = buildWebsitePackage((lead.raw as Record<string, unknown>) ?? {}, {
    brandDnaRaw: lead.brand_dna_raw,
    instagramRaw: lead.instagram_raw,
    websiteScreenshot: (lead.website_screenshot_url as string | null) ?? null,
    websiteScore: (lead.website_modern_score as number | null) ?? null,
    websiteLabel: (lead.website_label as string | null) ?? null,
    websiteAnalysis: (lead.website_analysis as string | null) ?? null,
    leadIntel: {
      score: (lead.lead_score as number | null) ?? null,
      tier: (lead.lead_tier as string | null) ?? null,
      redFlags: lead.red_flags,
      rejectionReasons: lead.rejection_reasons,
      passed: (lead.passed as boolean | null) ?? null,
      ownerUpdateAgeDays: (lead.owner_update_age_days as number | null) ?? null,
    },
  });
  const overrides = lead.website_package_overrides as Partial<WebsiteDataPackage> | null;
  const pkg = overrides ? mergeOverrides(base, overrides) : base;

  await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({
      website_package: pkg,
      website_package_version: WDP_VERSION,
      website_package_built_at: new Date().toISOString(),
    }),
  }).catch(() => {});
  return pkg;
}
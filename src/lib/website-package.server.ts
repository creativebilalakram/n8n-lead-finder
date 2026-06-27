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
    `${supabaseUrl}/rest/v1/leads?id=eq.${leadId}&select=raw,brand_dna_raw,instagram_raw,website_screenshot_url,website_package_overrides`,
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
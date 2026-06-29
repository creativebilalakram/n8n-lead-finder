import { supabase } from "@/integrations/supabase/client";

export type DmContact = {
  id: string;
  decision_maker_id: string | null;
  lead_id: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  personal_email: string | null;
  work_email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin_url: string | null;
  instagram_handle: string | null;
  facebook_url: string | null;
  twitter_handle: string | null;
  source: string | null;
  confidence: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessChannels = {
  id: string;
  business_id: string | null;
  lead_id: string | null;
  generic_emails: string[];
  generic_phones: string[];
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  linkedin_company_url: string | null;
  twitter_url: string | null;
  youtube_url: string | null;
  whatsapp_business: string | null;
  updated_at: string;
};

export async function getDmContactsForLead(leadId: string): Promise<DmContact[]> {
  const { data, error } = await supabase
    .from("dm_contacts")
    .select("*")
    .eq("lead_id", leadId);
  if (error) throw error;
  return (data ?? []) as unknown as DmContact[];
}

export async function upsertDmContact(
  input: Partial<DmContact> & { decision_maker_id: string | null; lead_id: string },
): Promise<DmContact> {
  // If we have a row id, update by id. If we have a decision_maker_id, upsert on it.
  // Otherwise (standalone / custom contact with no DM), plain insert.
  if (input.id) {
    const { data, error } = await supabase
      .from("dm_contacts")
      .update(input as never)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as unknown as DmContact;
  }
  if (input.decision_maker_id) {
    const { data, error } = await supabase
      .from("dm_contacts")
      .upsert(input as never, { onConflict: "decision_maker_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data as unknown as DmContact;
  }
  const { data, error } = await supabase
    .from("dm_contacts")
    .insert({ ...input, decision_maker_id: null } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as DmContact;
}

export async function deleteDmContact(id: string): Promise<void> {
  const { error } = await supabase.from("dm_contacts").delete().eq("id", id);
  if (error) throw error;
}

export async function getBusinessChannels(leadId: string): Promise<BusinessChannels | null> {
  const { data, error } = await supabase
    .from("business_channels")
    .select("*")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    ...(row as unknown as BusinessChannels),
    generic_emails: Array.isArray(row.generic_emails) ? (row.generic_emails as string[]) : [],
    generic_phones: Array.isArray(row.generic_phones) ? (row.generic_phones as string[]) : [],
  };
}

export async function upsertBusinessChannels(
  input: Partial<BusinessChannels> & { lead_id: string },
): Promise<BusinessChannels> {
  const payload = {
    ...input,
    generic_emails: input.generic_emails ?? [],
    generic_phones: input.generic_phones ?? [],
  };
  const { data, error } = await supabase
    .from("business_channels")
    .upsert(payload as never, { onConflict: "lead_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as BusinessChannels;
}

export type OutreachStatus = "ready" | "sent" | "replied" | "not_interested";

export async function setOutreachStatus(
  leadId: string,
  status: OutreachStatus | null,
  note?: string,
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      outreach_status: status,
      last_action_at: new Date().toISOString(),
      last_action_note: note ?? `Marked ${status ?? "cleared"}`,
    } as never)
    .eq("id", leadId);
  if (error) throw error;
}

export type InboxRow = {
  id: string;
  title: string;
  city: string | null;
  lead_score: number | null;
  lead_tier: string | null;
  outreach_status: string | null;
  last_action_at: string | null;
  last_action_note: string | null;
  dmCount: number;
  dmWithContacts: number;
  hasBusinessChannels: boolean;
};

function hasAnyChannel(c: DmContact): boolean {
  return Boolean(
    c.personal_email ||
      c.work_email ||
      c.phone ||
      c.whatsapp ||
      c.linkedin_url ||
      c.instagram_handle ||
      c.facebook_url ||
      c.twitter_handle,
  );
}

export async function getInboxLeads(): Promise<InboxRow[]> {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, title, city, lead_score, lead_tier, passed, outreach_status, last_action_at, last_action_note")
    .eq("passed", true)
    .in("lead_tier", ["Hot", "Warm"])
    .order("lead_score", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (leads ?? []) as Array<{
    id: string;
    title: string | null;
    city: string | null;
    lead_score: number | null;
    lead_tier: string | null;
    outreach_status: string | null;
    last_action_at: string | null;
    last_action_note: string | null;
  }>;
  if (!rows.length) return [];
  const leadIds = rows.map((r) => r.id);

  const [{ data: dms }, { data: contacts }, { data: bc }] = await Promise.all([
    supabase.from("decision_makers").select("id, business_id"),
    supabase.from("dm_contacts").select("*").in("lead_id", leadIds),
    supabase.from("business_channels").select("lead_id").in("lead_id", leadIds),
  ]);

  // dm count per lead — join via businesses
  const { data: biz } = await supabase
    .from("businesses")
    .select("id, lead_id")
    .in("lead_id", leadIds);
  const bizByLead = new Map<string, string[]>();
  for (const b of (biz ?? []) as Array<{ id: string; lead_id: string | null }>) {
    if (!b.lead_id) continue;
    const arr = bizByLead.get(b.lead_id) ?? [];
    arr.push(b.id);
    bizByLead.set(b.lead_id, arr);
  }
  const dmCountByBiz = new Map<string, number>();
  for (const d of (dms ?? []) as Array<{ id: string; business_id: string }>) {
    dmCountByBiz.set(d.business_id, (dmCountByBiz.get(d.business_id) ?? 0) + 1);
  }
  const contactByLead = new Map<string, DmContact[]>();
  for (const c of (contacts ?? []) as DmContact[]) {
    if (!c.lead_id) continue;
    const arr = contactByLead.get(c.lead_id) ?? [];
    arr.push(c);
    contactByLead.set(c.lead_id, arr);
  }
  const bcLeads = new Set<string>(((bc ?? []) as Array<{ lead_id: string | null }>).map((b) => b.lead_id ?? "").filter(Boolean));

  return rows.map((r) => {
    const bizIds = bizByLead.get(r.id) ?? [];
    const dmCount = bizIds.reduce((sum, bid) => sum + (dmCountByBiz.get(bid) ?? 0), 0);
    const contactsForLead = contactByLead.get(r.id) ?? [];
    const dmWithContacts = contactsForLead.filter(hasAnyChannel).length;
    return {
      id: r.id,
      title: r.title ?? "Untitled",
      city: r.city,
      lead_score: r.lead_score,
      lead_tier: r.lead_tier,
      outreach_status: r.outreach_status,
      last_action_at: r.last_action_at,
      last_action_note: r.last_action_note,
      dmCount,
      dmWithContacts,
      hasBusinessChannels: bcLeads.has(r.id),
    };
  });
}

export function deriveContactStatus(row: InboxRow): {
  key: "no_contacts" | "ready" | "sent" | "replied" | "not_interested";
  label: string;
  emoji: string;
  color: string;
} {
  if (row.outreach_status === "sent")
    return { key: "sent", label: "Sent", emoji: "🟢", color: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (row.outreach_status === "replied")
    return { key: "replied", label: "Replied", emoji: "💬", color: "text-indigo-700 bg-indigo-50 border-indigo-200" };
  if (row.outreach_status === "not_interested")
    return { key: "not_interested", label: "Not interested", emoji: "❌", color: "text-slate-600 bg-slate-50 border-slate-200" };
  const hasContacts = row.dmWithContacts > 0 || row.hasBusinessChannels;
  if (hasContacts) return { key: "ready", label: "Ready", emoji: "🟡", color: "text-amber-700 bg-amber-50 border-amber-200" };
  return { key: "no_contacts", label: "No contacts", emoji: "🔴", color: "text-rose-700 bg-rose-50 border-rose-200" };
}
import { supabase } from "@/integrations/supabase/client";

export type Business = {
  id: string;
  name: string;
  website: string | null;
  normalized_key: string;
  lead_id: string | null;
  enrichment_status: string;
  last_enriched_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactJob = {
  id: string;
  business_id: string;
  status: string;
  steps: Record<string, {
    status: string;
    error?: string;
    counts?: Record<string, number>;
    startedAt?: string;
    finishedAt?: string;
    reason?: string;
    note?: string | null;
    linkedinSource?: string | null;
  }>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type DecisionMaker = {
  id: string;
  business_id: string;
  person_name: string | null;
  person_title: string | null;
  person_profile_url: string | null;
  confidence: string | null;
  decision_maker_score: number;
  manual_score_override: number | null;
  priority: string;
  added_to_outreach: boolean;
};

export type WebsiteContacts = {
  id: string;
  business_id: string;
  emails: string[];
  phones: string[];
  linkedins: string[];
  socials: Record<string, string[]>;
  updated_at: string;
};

export type LinkedinEmail = {
  id: string;
  decision_maker_id: string;
  business_id: string;
  email: string;
  confidence: string | null;
  created_at: string;
};

export async function listBusinesses() {
  const { data } = await supabase.from("businesses").select("*").order("updated_at", { ascending: false });
  return (data || []) as Business[];
}
export async function listJobs(limit = 50) {
  const { data } = await supabase.from("contact_jobs").select("*").order("started_at", { ascending: false }).limit(limit);
  return (data || []) as ContactJob[];
}
export async function listDecisionMakers(businessId?: string) {
  let q = supabase.from("decision_makers").select("*").order("decision_maker_score", { ascending: false });
  if (businessId) q = q.eq("business_id", businessId);
  const { data } = await q;
  return (data || []) as DecisionMaker[];
}
export async function listWebsiteContacts() {
  const { data } = await supabase.from("website_contacts").select("*").order("updated_at", { ascending: false });
  return (data || []) as WebsiteContacts[];
}
export async function listEmails() {
  const { data } = await supabase.from("linkedin_emails").select("*").order("created_at", { ascending: false });
  return (data || []) as LinkedinEmail[];
}
export async function updateDecisionMaker(id: string, patch: Partial<DecisionMaker>) {
  await supabase.from("decision_makers").update(patch).eq("id", id);
}

export async function startEnrichment(businessName: string, website: string | null, leadId: string | null = null) {
  const res = await fetch("/api/public/contacts/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessName, website, leadId }),
  });
  if (!res.ok) throw new Error(`Enrichment failed: ${res.status}`);
  return res.json() as Promise<{ businessId: string; jobId: string; alreadyRunning?: boolean }>;
}

export type RerunStep = "website" | "decision_makers" | "emails";

export async function rerunStep(businessId: string, step: RerunStep, scope: "all" | "missing" = "all", dmIds?: string[]) {
  const res = await fetch("/api/public/contacts/rerun", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId, step, scope, dmIds }),
  });
  if (!res.ok) throw new Error(`Re-run failed: ${res.status}`);
  return res.json() as Promise<{ businessId: string; jobId: string; step: RerunStep; alreadyRunning?: boolean }>;
}
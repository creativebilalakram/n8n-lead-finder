import { supabase } from "@/integrations/supabase/client";

export type OutreachStatus =
  | "draft"
  | "approved"
  | "scheduled"
  | "sent"
  | "failed"
  | "replied"
  | "skipped";

export type OutreachDraft = {
  id: string;
  lead_id: string;
  dm_contact_id: string | null;
  channel: string;
  recipient_type: string;
  recipient_handle: string | null;
  sequence_step: number;
  scheduled_for: string | null;
  subject: string | null;
  message_body: string;
  demo_url: string | null;
  ai_model: string | null;
  ai_prompt_version: number | null;
  generation_context: Record<string, unknown> | null;
  status: OutreachStatus;
  sent_at: string | null;
  reply_received_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listDraftsForLead(leadId: string): Promise<OutreachDraft[]> {
  const { data, error } = await supabase
    .from("outreach_drafts")
    .select("*")
    .eq("lead_id", leadId)
    .order("sequence_step", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OutreachDraft[];
}

export async function listAllDrafts(): Promise<OutreachDraft[]> {
  const { data, error } = await supabase
    .from("outreach_drafts")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as unknown as OutreachDraft[];
}

export async function updateDraft(id: string, patch: Partial<OutreachDraft>): Promise<void> {
  const { error } = await supabase
    .from("outreach_drafts")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function setStatus(id: string, status: OutreachStatus, extra: Partial<OutreachDraft> = {}): Promise<void> {
  const patch: Partial<OutreachDraft> = { status, ...extra };
  if (status === "sent" && !patch.sent_at) patch.sent_at = new Date().toISOString();
  if (status === "replied" && !patch.reply_received_at) patch.reply_received_at = new Date().toISOString();
  const { error } = await supabase
    .from("outreach_drafts")
    .update(patch as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteDraft(id: string): Promise<void> {
  const { error } = await supabase.from("outreach_drafts").delete().eq("id", id);
  if (error) throw error;
}

export type GenerateParams = {
  leadId: string;
  dmContactId: string | "business_generic" | null;
  channel: string;
  sequenceStep?: number;
  model?: "gemini" | "claude";
  recipientType: "decision_maker" | "business_generic";
  recipientHandle?: string | null;
};

export async function generateDraft(params: GenerateParams): Promise<OutreachDraft> {
  const res = await fetch("/api/public/outreach/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as { ok: boolean; error?: string; draft?: OutreachDraft };
  if (!json.ok || !json.draft) throw new Error(json.error || "Generation failed");
  return json.draft;
}

export async function approveAndScheduleFollowups(draftId: string): Promise<{ scheduled: number }> {
  const res = await fetch("/api/public/outreach/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftId }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string; scheduled?: number };
  if (!json.ok) throw new Error(json.error || "Approve failed");
  return { scheduled: json.scheduled ?? 0 };
}

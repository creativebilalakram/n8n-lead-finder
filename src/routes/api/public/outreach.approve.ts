import { createFileRoute } from "@tanstack/react-router";
import { followupOffsetMs } from "@/lib/outreach-prompts.server";

type Body = { draftId?: string };

async function pgPatch(
  url: string,
  key: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PG patch ${res.status}`);
  return (await res.json()) as unknown[];
}

async function pgInsert(
  url: string,
  key: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=minimal,resolution=ignore-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok && res.status !== 409) {
    const t = await res.text().catch(() => "");
    throw new Error(`PG insert ${res.status}: ${t.slice(0, 200)}`);
  }
}

async function pgRead(url: string, key: string, path: string): Promise<unknown[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`PG read ${res.status}`);
  return (await res.json()) as unknown[];
}

// Approves a draft and, for sequence_step === 0, generates followup
// placeholder rows (steps 1..4) scheduled at +3d/+7d/+14d/+30d. The follow-up
// message body is left empty; the user (or a later auto-generation pass) can
// regenerate each via the standard generate endpoint.
export const Route = createFileRoute("/api/public/outreach/approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body = {};
        try { body = (await request.json()) as Body; } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        if (!body.draftId) return Response.json({ ok: false, error: "draftId required" }, { status: 400 });

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ ok: false, error: "Supabase env missing" }, { status: 500 });
        }

        let updated: Record<string, unknown> | undefined;
        try {
          const rows = await pgPatch(
            supabaseUrl,
            serviceKey,
            `outreach_drafts?id=eq.${body.draftId}`,
            { status: "approved" },
          );
          updated = rows[0] as Record<string, unknown> | undefined;
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }
        if (!updated) return Response.json({ ok: false, error: "Draft not found" }, { status: 404 });

        const seq = Number(updated.sequence_step ?? 0);
        if (seq !== 0) return Response.json({ ok: true, scheduled: 0, draft: updated });

        // Look for existing followups for this (lead, dm/handle, channel)
        const leadId = updated.lead_id as string;
        const channel = updated.channel as string;
        const dmId = updated.dm_contact_id as string | null;
        const handle = updated.recipient_handle as string | null;
        const dmFilter = dmId ? `dm_contact_id=eq.${dmId}` : `dm_contact_id=is.null&recipient_handle=eq.${handle ?? ""}`;
        const existing = (await pgRead(
          supabaseUrl,
          serviceKey,
          `outreach_drafts?lead_id=eq.${leadId}&channel=eq.${channel}&${dmFilter}&select=sequence_step`,
        )) as Array<{ sequence_step: number }>;
        const have = new Set(existing.map((r) => r.sequence_step));

        const now = Date.now();
        const newRows: Record<string, unknown>[] = [];
        for (let step = 1; step <= 4; step++) {
          if (have.has(step)) continue;
          const offset = followupOffsetMs(step);
          if (offset == null) continue;
          newRows.push({
            lead_id: leadId,
            dm_contact_id: dmId,
            channel,
            recipient_type: updated.recipient_type,
            recipient_handle: handle,
            sequence_step: step,
            scheduled_for: new Date(now + offset).toISOString(),
            subject: null,
            message_body: "",
            demo_url: updated.demo_url,
            ai_model: null,
            ai_prompt_version: updated.ai_prompt_version,
            generation_context: null,
            status: "draft",
          });
        }

        try {
          await pgInsert(supabaseUrl, serviceKey, "outreach_drafts", newRows);
        } catch (e) {
          return Response.json({ ok: true, draft: updated, scheduled: 0, warning: e instanceof Error ? e.message : String(e) });
        }

        return Response.json({ ok: true, draft: updated, scheduled: newRows.length });
      },
    },
  },
});

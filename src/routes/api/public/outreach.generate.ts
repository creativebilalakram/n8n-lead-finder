import { createFileRoute } from "@tanstack/react-router";
import { fetchWithRetry, extractJson } from "@/lib/fetch-retry";
import { buildOutreachPrompt, PROMPT_VERSION, type Channel } from "@/lib/outreach-prompts.server";

type Body = {
  leadId?: string;
  dmContactId?: string | "business_generic" | null;
  channel?: Channel;
  sequenceStep?: number;
  model?: "gemini" | "claude";
  recipientType?: "decision_maker" | "business_generic";
  recipientHandle?: string | null;
  promptVersion?: number;
};

type DraftOut = { subject: string | null; body: string };

async function pgRead(
  url: string,
  key: string,
  path: string,
): Promise<unknown> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`PG read ${res.status}: ${path}`);
  return res.json();
}

async function pgInsert(
  url: string,
  key: string,
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PG insert ${res.status}: ${t.slice(0, 300)}`);
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function pgPatch(
  url: string,
  key: string,
  table: string,
  filter: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`PG patch ${res.status}: ${t.slice(0, 300)}`);
  }
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

async function callGemini(system: string, user: string): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    timeoutMs: 60_000,
    retries: 1,
    backoffMs: 1500,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Lovable AI ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? "";
}

async function callClaude(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
    timeoutMs: 60_000,
    retries: 1,
    backoffMs: 1500,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as { content?: Array<{ text?: string }> };
  return j.content?.map((c) => c.text ?? "").join("\n") ?? "";
}

export const Route = createFileRoute("/api/public/outreach/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body = {};
        try { body = (await request.json()) as Body; } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const {
          leadId,
          dmContactId,
          channel,
          sequenceStep = 0,
          model = "gemini",
          recipientType,
          recipientHandle = null,
          promptVersion = PROMPT_VERSION,
        } = body;
        if (!leadId || !channel || !recipientType) {
          return Response.json({ ok: false, error: "leadId, channel, recipientType required" }, { status: 400 });
        }

        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !serviceKey) {
          return Response.json({ ok: false, error: "Supabase env missing" }, { status: 500 });
        }

        let lead: Record<string, unknown> | undefined;
        try {
          const leadRows = (await pgRead(
            supabaseUrl,
            serviceKey,
            `leads?id=eq.${leadId}&select=*`,
          )) as Record<string, unknown>[];
          lead = leadRows[0];
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }
        if (!lead) return Response.json({ ok: false, error: "Lead not found" }, { status: 404 });

        let dm: Record<string, unknown> | null = null;
        const isGeneric = !dmContactId || dmContactId === "business_generic";
        if (!isGeneric) {
          try {
            const dmRows = (await pgRead(
              supabaseUrl,
              serviceKey,
              `dm_contacts?id=eq.${dmContactId}&select=*`,
            )) as Record<string, unknown>[];
            dm = dmRows[0] ?? null;
          } catch {
            dm = null;
          }
        }

        const built = buildOutreachPrompt({
          lead,
          dm,
          channel,
          sequenceStep,
          recipientType,
          recipientHandle,
          version: promptVersion,
        });

        let raw = "";
        let usedModel = "google/gemini-3-flash-preview";
        try {
          if (model === "claude") {
            usedModel = "claude-sonnet-4-6";
            raw = await callClaude(built.system, built.user);
          } else {
            raw = await callGemini(built.system, built.user);
          }
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }

        const parsed = extractJson<DraftOut>(raw);
        if (!parsed || typeof parsed.body !== "string") {
          return Response.json({ ok: false, error: "AI returned non-JSON output", raw: raw.slice(0, 500) }, { status: 200 });
        }
        const subject = channel === "email" ? (parsed.subject ?? null) : null;
        const messageBody = parsed.body.trim();

        const row: Record<string, unknown> = {
          lead_id: leadId,
          dm_contact_id: isGeneric ? null : dmContactId,
          channel,
          recipient_type: recipientType,
          recipient_handle: recipientHandle,
          sequence_step: sequenceStep,
          subject,
          message_body: messageBody,
          demo_url: built.demoUrl,
          ai_model: usedModel,
          ai_prompt_version: built.promptVersion,
          generation_context: built.context,
          status: "draft",
          updated_at: new Date().toISOString(),
        };

        // Manual upsert: the table has PARTIAL unique indexes (WHERE
        // dm_contact_id IS NULL/NOT NULL), which PostgREST's on_conflict
        // cannot infer. Look up existing row by the logical unique key, then
        // PATCH or INSERT accordingly.
        let draft: Record<string, unknown> | null = null;
        try {
          const handleFilter = recipientHandle == null
            ? "recipient_handle=is.null"
            : `recipient_handle=eq.${encodeURIComponent(recipientHandle)}`;
          const lookupFilter = isGeneric
            ? `lead_id=eq.${leadId}&dm_contact_id=is.null&channel=eq.${encodeURIComponent(channel)}&${handleFilter}&sequence_step=eq.${sequenceStep}`
            : `lead_id=eq.${leadId}&dm_contact_id=eq.${dmContactId}&channel=eq.${encodeURIComponent(channel)}&sequence_step=eq.${sequenceStep}`;
          const existing = (await pgRead(
            supabaseUrl,
            serviceKey,
            `outreach_drafts?${lookupFilter}&select=id&limit=1`,
          )) as Array<{ id: string }>;
          if (existing[0]?.id) {
            draft = await pgPatch(
              supabaseUrl,
              serviceKey,
              "outreach_drafts",
              `id=eq.${existing[0].id}`,
              row,
            );
          } else {
            draft = await pgInsert(supabaseUrl, serviceKey, "outreach_drafts", row);
          }
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
        }

        return Response.json({ ok: true, draft });
      },
    },
  },
});

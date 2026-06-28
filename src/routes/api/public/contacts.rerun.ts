import { createFileRoute } from "@tanstack/react-router";
import {
  sb,
  patchJob,
  gatherLeadHints,
  runWebsiteStep,
  runDecisionMakersStep,
  runEmailsStep,
  type Json,
} from "@/lib/contacts-pipeline.server";

type Step = "website" | "decision_makers" | "emails";

async function createRerunJob(businessId: string, step: Step) {
  const baseSteps: Json = {
    website: { status: "pending" },
    decision_makers: { status: "pending" },
    emails: { status: "pending" },
  };
  // Mark unrelated steps so the UI shows what is actually re-running.
  for (const k of ["website", "decision_makers", "emails"] as Step[]) {
    if (k !== step) (baseSteps[k] as Json).status = "skipped";
    if (k !== step) (baseSteps[k] as Json).reason = "Not part of this re-run";
  }
  const res = await sb("contact_jobs", {
    method: "POST",
    body: JSON.stringify({ business_id: businessId, status: "running", steps: baseSteps }),
  });
  const json = (await res.json()) as Json[];
  return json[0];
}

async function runStep(opts: {
  businessId: string;
  jobId: string;
  step: Step;
  scope?: "all" | "missing"; // emails only
  dmIds?: string[]; // emails only — restrict to specific decision makers
}) {
  // Load business + lead
  const bizRes = await sb(`businesses?id=eq.${opts.businessId}&select=*`);
  const bizRows = bizRes.ok ? ((await bizRes.json()) as Json[]) : [];
  const biz = bizRows[0];
  if (!biz) throw new Error("Business not found");

  const businessName = String(biz.name || "");
  const website = (biz.website as string | null) || null;
  const leadId = (biz.lead_id as string | null) || null;

  let steps: Json = {
    website: { status: "pending" },
    decision_makers: { status: "pending" },
    emails: { status: "pending" },
  };

  if (opts.step === "website") {
    const r = await runWebsiteStep({ jobId: opts.jobId, steps, businessId: opts.businessId, website });
    steps = r.steps;
  } else if (opts.step === "decision_makers") {
    // Pre-load LinkedIn hints + the LinkedIn already discovered on the website.
    const hints = await gatherLeadHints(leadId);
    const wcRes = await sb(`website_contacts?business_id=eq.${opts.businessId}&select=linkedins&order=updated_at.desc&limit=1`);
    const wcRows = wcRes.ok ? ((await wcRes.json()) as Json[]) : [];
    const websiteLinkedIns = (wcRows[0]?.linkedins as string[] | undefined) || [];
    const firstLinkedIn = websiteLinkedIns[0] || hints.linkedinHints[0]?.url || "";
    const linkedInSource = websiteLinkedIns[0]
      ? "website"
      : hints.linkedinHints[0]?.source || "";
    const r = await runDecisionMakersStep({
      jobId: opts.jobId,
      steps,
      businessId: opts.businessId,
      businessName,
      firstLinkedIn,
      linkedInSource,
      hints: hints.linkedinHints,
    });
    steps = r.steps;
  } else if (opts.step === "emails") {
    // Load existing DMs; optionally restrict to those without any email row yet.
    const dmRes = await sb(`decision_makers?business_id=eq.${opts.businessId}&select=id,person_profile_url`);
    const dms = (dmRes.ok ? ((await dmRes.json()) as Json[]) : []) as Array<{ id: string; person_profile_url: string | null }>;
    let target = dms.filter((d) => !!d.person_profile_url);
    if (opts.dmIds && opts.dmIds.length) {
      const want = new Set(opts.dmIds);
      target = target.filter((d) => want.has(d.id));
    }
    if (opts.scope === "missing") {
      const emRes = await sb(`linkedin_emails?business_id=eq.${opts.businessId}&select=decision_maker_id`);
      const existing = emRes.ok ? ((await emRes.json()) as Array<{ decision_maker_id: string }>) : [];
      const have = new Set(existing.map((e) => e.decision_maker_id));
      target = target.filter((d) => !have.has(d.id));
    }
    const r = await runEmailsStep({ jobId: opts.jobId, steps, businessId: opts.businessId, dms: target });
    steps = r.steps;
  }

  await patchJob(opts.jobId, { status: "completed", finished_at: new Date().toISOString() });
  await sb(`businesses?id=eq.${opts.businessId}`, {
    method: "PATCH",
    body: JSON.stringify({ enrichment_status: "completed", last_enriched_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

export const Route = createFileRoute("/api/public/contacts/rerun")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { businessId?: string; step?: Step; scope?: "all" | "missing"; dmIds?: string[] } = {};
        try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
        const businessId = (body.businessId || "").trim();
        const step = body.step;
        if (!businessId) return Response.json({ error: "businessId required" }, { status: 400 });
        if (step !== "website" && step !== "decision_makers" && step !== "emails") {
          return Response.json({ error: "step must be one of: website, decision_makers, emails" }, { status: 400 });
        }

        // Don't stack runs.
        const open = await sb(`contact_jobs?business_id=eq.${businessId}&status=eq.running&select=id`);
        const openRows = open.ok ? ((await open.json()) as Json[]) : [];
        if (openRows[0]) {
          return Response.json({ businessId, jobId: openRows[0].id, alreadyRunning: true });
        }

        const job = await createRerunJob(businessId, step);
        await sb(`businesses?id=eq.${businessId}`, {
          method: "PATCH",
          body: JSON.stringify({ enrichment_status: "running", updated_at: new Date().toISOString() }),
        }).catch(() => {});

        runStep({ businessId, jobId: job.id as string, step, scope: body.scope, dmIds: body.dmIds }).catch(async (e) => {
          await patchJob(job.id as string, {
            status: "failed",
            error: String((e as Error)?.message || e),
            finished_at: new Date().toISOString(),
          });
        });

        return Response.json({ businessId, jobId: job.id, step });
      },
    },
  },
});
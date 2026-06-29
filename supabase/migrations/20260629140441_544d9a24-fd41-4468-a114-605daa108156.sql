CREATE TABLE public.outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  dm_contact_id UUID REFERENCES public.dm_contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  recipient_handle TEXT,
  sequence_step INT NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  subject TEXT,
  message_body TEXT NOT NULL DEFAULT '',
  demo_url TEXT,
  ai_model TEXT,
  ai_prompt_version INT,
  generation_context JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  reply_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_drafts TO authenticated, anon;
GRANT ALL ON public.outreach_drafts TO service_role;

ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_outreach_drafts" ON public.outreach_drafts FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_drafts_lead ON public.outreach_drafts(lead_id);
CREATE INDEX idx_drafts_status ON public.outreach_drafts(status);
CREATE INDEX idx_drafts_scheduled ON public.outreach_drafts(scheduled_for) WHERE status IN ('draft', 'approved');
CREATE UNIQUE INDEX idx_drafts_unique_dm ON public.outreach_drafts(lead_id, dm_contact_id, channel, sequence_step) WHERE dm_contact_id IS NOT NULL;
CREATE UNIQUE INDEX idx_drafts_unique_generic ON public.outreach_drafts(lead_id, channel, recipient_handle, sequence_step) WHERE dm_contact_id IS NULL;

CREATE TRIGGER trg_outreach_drafts_touch BEFORE UPDATE ON public.outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- dm_contacts
CREATE TABLE IF NOT EXISTS public.dm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_maker_id UUID UNIQUE REFERENCES public.decision_makers(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT,
  personal_email TEXT,
  work_email TEXT,
  phone TEXT,
  whatsapp TEXT,
  linkedin_url TEXT,
  instagram_handle TEXT,
  facebook_url TEXT,
  twitter_handle TEXT,
  source TEXT,
  confidence TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dm_contacts_lead ON public.dm_contacts(lead_id);
CREATE INDEX IF NOT EXISTS idx_dm_contacts_dm ON public.dm_contacts(decision_maker_id);
GRANT ALL ON public.dm_contacts TO anon, authenticated, service_role;
ALTER TABLE public.dm_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Open access" ON public.dm_contacts;
CREATE POLICY "Open access" ON public.dm_contacts FOR ALL USING (true) WITH CHECK (true);

-- business_channels
CREATE TABLE IF NOT EXISTS public.business_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id UUID UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  generic_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  generic_phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  instagram_url TEXT,
  facebook_url TEXT,
  tiktok_url TEXT,
  linkedin_company_url TEXT,
  twitter_url TEXT,
  youtube_url TEXT,
  whatsapp_business TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_channels_lead ON public.business_channels(lead_id);
GRANT ALL ON public.business_channels TO anon, authenticated, service_role;
ALTER TABLE public.business_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Open access" ON public.business_channels;
CREATE POLICY "Open access" ON public.business_channels FOR ALL USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
DROP TRIGGER IF EXISTS trg_dm_contacts_updated_at ON public.dm_contacts;
CREATE TRIGGER trg_dm_contacts_updated_at BEFORE UPDATE ON public.dm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_business_channels_updated_at ON public.business_channels;
CREATE TRIGGER trg_business_channels_updated_at BEFORE UPDATE ON public.business_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Outreach tracking on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS outreach_status TEXT,
  ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_action_note TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_outreach_status ON public.leads(outreach_status);

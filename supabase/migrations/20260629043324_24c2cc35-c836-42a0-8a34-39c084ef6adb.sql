-- Contact Hub: dm_contacts + business_channels + outreach status on leads

CREATE TABLE public.dm_contacts (
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
CREATE INDEX idx_dm_contacts_lead ON public.dm_contacts(lead_id);
CREATE INDEX idx_dm_contacts_dm ON public.dm_contacts(decision_maker_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dm_contacts TO anon, authenticated;
GRANT ALL ON public.dm_contacts TO service_role;
ALTER TABLE public.dm_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.dm_contacts FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.business_channels (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_business_channels_business ON public.business_channels(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_channels TO anon, authenticated;
GRANT ALL ON public.business_channels TO service_role;
ALTER TABLE public.business_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.business_channels FOR ALL USING (true) WITH CHECK (true);

-- Reuse existing update_app_settings_updated_at-style trigger function (generic)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_dm_contacts_updated_at BEFORE UPDATE ON public.dm_contacts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_business_channels_updated_at BEFORE UPDATE ON public.business_channels
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Outreach status on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS outreach_status TEXT,
  ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_action_note TEXT;

-- Contact Intelligence Hub tables

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  normalized_key text NOT NULL UNIQUE,
  lead_id uuid,
  enrichment_status text NOT NULL DEFAULT 'idle',
  last_enriched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.businesses TO anon, authenticated;
GRANT ALL ON public.businesses TO service_role;
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.businesses FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.contact_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_jobs TO anon, authenticated;
GRANT ALL ON public.contact_jobs TO service_role;
ALTER TABLE public.contact_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.contact_jobs FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.website_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  emails jsonb NOT NULL DEFAULT '[]'::jsonb,
  phones jsonb NOT NULL DEFAULT '[]'::jsonb,
  linkedins jsonb NOT NULL DEFAULT '[]'::jsonb,
  socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_contacts TO anon, authenticated;
GRANT ALL ON public.website_contacts TO service_role;
ALTER TABLE public.website_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.website_contacts FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.decision_makers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  person_name text,
  person_title text,
  person_profile_url text,
  confidence text,
  decision_maker_score integer NOT NULL DEFAULT 0,
  manual_score_override integer,
  priority text NOT NULL DEFAULT 'Low',
  added_to_outreach boolean NOT NULL DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, person_profile_url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decision_makers TO anon, authenticated;
GRANT ALL ON public.decision_makers TO service_role;
ALTER TABLE public.decision_makers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.decision_makers FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.linkedin_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_maker_id uuid NOT NULL REFERENCES public.decision_makers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  confidence text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_maker_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.linkedin_emails TO anon, authenticated;
GRANT ALL ON public.linkedin_emails TO service_role;
ALTER TABLE public.linkedin_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Open access" ON public.linkedin_emails FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_dm_business ON public.decision_makers(business_id);
CREATE INDEX idx_emails_business ON public.linkedin_emails(business_id);
CREATE INDEX idx_jobs_business ON public.contact_jobs(business_id);

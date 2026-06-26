
CREATE TABLE public.search_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  apify_run_id TEXT,
  source TEXT NOT NULL DEFAULT 'search' CHECK (source IN ('search','import')),
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  qualified_count INT NOT NULL DEFAULT 0,
  filtered_count INT NOT NULL DEFAULT 0,
  total_count INT NOT NULL DEFAULT 0,
  apify_started_at TIMESTAMPTZ,
  apify_finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX search_runs_apify_run_id_key ON public.search_runs (apify_run_id) WHERE apify_run_id IS NOT NULL;
CREATE INDEX search_runs_created_at_idx ON public.search_runs (created_at DESC);

CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  search_run_id UUID NOT NULL REFERENCES public.search_runs(id) ON DELETE CASCADE,
  apify_run_id TEXT,
  place_id TEXT,
  title TEXT,
  category TEXT,
  address TEXT,
  city TEXT,
  country_code TEXT,
  phone TEXT,
  phones JSONB,
  email TEXT,
  emails JSONB,
  website TEXT,
  rating NUMERIC,
  reviews_count INT,
  lead_score INT,
  lead_tier TEXT,
  red_flags JSONB,
  passed BOOLEAN NOT NULL DEFAULT false,
  rejection_reasons JSONB,
  lovable_url TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX leads_search_run_id_idx ON public.leads (search_run_id);
CREATE INDEX leads_apify_run_id_idx ON public.leads (apify_run_id);
CREATE INDEX leads_passed_idx ON public.leads (passed);
CREATE INDEX leads_lead_tier_idx ON public.leads (lead_tier);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_runs TO anon, authenticated;
GRANT ALL ON public.search_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon, authenticated;
GRANT ALL ON public.leads TO service_role;

ALTER TABLE public.search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Single-user mode: app has no login, so allow open access for now.
CREATE POLICY "Open access" ON public.search_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Open access" ON public.leads FOR ALL USING (true) WITH CHECK (true);

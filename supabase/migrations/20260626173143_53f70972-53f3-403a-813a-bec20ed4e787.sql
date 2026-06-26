ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE INDEX IF NOT EXISTS leads_opened_at_idx ON public.leads (opened_at) WHERE opened_at IS NOT NULL;
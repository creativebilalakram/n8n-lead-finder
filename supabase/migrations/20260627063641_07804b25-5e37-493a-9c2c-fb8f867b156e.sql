ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS auto_enrich_status text,
  ADD COLUMN IF NOT EXISTS auto_enrich_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_enrich_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_enrich_error text,
  ADD COLUMN IF NOT EXISTS auto_enrich_steps jsonb;

CREATE INDEX IF NOT EXISTS leads_auto_enrich_status_idx
  ON public.leads (auto_enrich_status)
  WHERE auto_enrich_status IS NOT NULL;
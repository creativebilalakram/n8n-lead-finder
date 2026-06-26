ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS owner_update_age_days integer;

UPDATE public.leads
SET owner_update_age_days = NULLIF(raw->>'ownerUpdateAgeDays', '')::integer
WHERE owner_update_age_days IS NULL
  AND raw ? 'ownerUpdateAgeDays'
  AND NULLIF(raw->>'ownerUpdateAgeDays', '') ~ '^[0-9]+$';

CREATE INDEX IF NOT EXISTS idx_leads_search_run_id ON public.leads(search_run_id);
CREATE INDEX IF NOT EXISTS idx_leads_lead_score ON public.leads(lead_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_owner_update_age_days ON public.leads(owner_update_age_days);
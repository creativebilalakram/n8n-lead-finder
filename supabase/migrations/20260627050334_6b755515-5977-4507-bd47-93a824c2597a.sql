
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS brand_dna_score integer,
  ADD COLUMN IF NOT EXISTS brand_dna_label text,
  ADD COLUMN IF NOT EXISTS brand_dna_summary text,
  ADD COLUMN IF NOT EXISTS brand_dna_screenshot_url text,
  ADD COLUMN IF NOT EXISTS brand_dna_raw jsonb,
  ADD COLUMN IF NOT EXISTS brand_dna_analyzed_at timestamptz;

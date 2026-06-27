ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website_screenshot_url text,
  ADD COLUMN IF NOT EXISTS website_modern_score integer,
  ADD COLUMN IF NOT EXISTS website_label text,
  ADD COLUMN IF NOT EXISTS website_analysis text,
  ADD COLUMN IF NOT EXISTS website_analyzed_at timestamp with time zone;
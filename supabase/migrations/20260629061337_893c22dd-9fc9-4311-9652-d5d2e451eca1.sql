
ALTER TABLE public.business_channels
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_synced_at timestamptz;

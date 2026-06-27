ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS website_package jsonb,
  ADD COLUMN IF NOT EXISTS website_package_overrides jsonb,
  ADD COLUMN IF NOT EXISTS website_package_version integer,
  ADD COLUMN IF NOT EXISTS website_package_built_at timestamptz;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS instagram_username text,
  ADD COLUMN IF NOT EXISTS instagram_followers integer,
  ADD COLUMN IF NOT EXISTS instagram_following integer,
  ADD COLUMN IF NOT EXISTS instagram_posts_count integer,
  ADD COLUMN IF NOT EXISTS instagram_verified boolean,
  ADD COLUMN IF NOT EXISTS instagram_is_business boolean,
  ADD COLUMN IF NOT EXISTS instagram_bio text,
  ADD COLUMN IF NOT EXISTS instagram_full_name text,
  ADD COLUMN IF NOT EXISTS instagram_profile_pic_url text,
  ADD COLUMN IF NOT EXISTS instagram_label text,
  ADD COLUMN IF NOT EXISTS instagram_analysis text,
  ADD COLUMN IF NOT EXISTS instagram_score integer,
  ADD COLUMN IF NOT EXISTS instagram_raw jsonb,
  ADD COLUMN IF NOT EXISTS instagram_analyzed_at timestamptz;

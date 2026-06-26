DROP POLICY IF EXISTS "Public app can manage settings" ON public.app_settings;

REVOKE INSERT, DELETE ON public.app_settings FROM anon;
REVOKE INSERT, DELETE ON public.app_settings FROM authenticated;

CREATE POLICY "Public app can update filter settings"
ON public.app_settings
FOR UPDATE
TO anon, authenticated
USING (key = 'filter_settings')
WITH CHECK (key = 'filter_settings');
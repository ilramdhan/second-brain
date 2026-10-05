CREATE TABLE public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL
);
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
-- Tidak ada policy: hanya service_role / postgres (cron) yang bisa membaca.
INSERT INTO public.app_config (key, value) VALUES ('cron_token', gen_random_uuid()::text);
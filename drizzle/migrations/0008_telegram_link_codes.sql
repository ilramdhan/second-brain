-- One-time codes for linking a Telegram chat to an account (`/link <code>`), replacing `/link <email>`.
-- Only the SHA-256 hash of a code is stored. Clients may insert and read their own codes, but only
-- `user_id` and `code_hash` are insertable, so `expires_at`/`created_at`/`used_at` always come from
-- the defaults (10-minute TTL). Codes are invalidated and redeemed by the server (service role).
CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_codes_user_idx ON public.telegram_link_codes (user_id) WHERE used_at IS NULL;
GRANT SELECT ON public.telegram_link_codes TO authenticated;
GRANT INSERT (user_id, code_hash) ON public.telegram_link_codes TO authenticated;
GRANT ALL ON public.telegram_link_codes TO service_role;
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "telegram_link_codes_select_own" ON public.telegram_link_codes;
CREATE POLICY "telegram_link_codes_select_own" ON public.telegram_link_codes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "telegram_link_codes_insert_own" ON public.telegram_link_codes;
CREATE POLICY "telegram_link_codes_insert_own" ON public.telegram_link_codes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Backend support for the n8n integration endpoints (/api/public/n8n/*, plan Phase 6).
--
-- 1. `n8n_events`: idempotency ledger keyed by (source, external_id), e.g. ('telegram', update_id)
--    or ('email', '<message-id>'). n8n retries a failed HTTP node; the first request claims the
--    key with INSERT ... ON CONFLICT DO NOTHING and stores its response so a retry returns the same
--    result instead of creating a duplicate. Service role only (RLS on, no policies).
-- 2. `inbox_items.source` accepts the new capture sources email, google_calendar and webhook.
-- 3. `n8n_user_id_by_email`: maps a capture's sender email to an account without listing
--    auth.users through the Admin API. Service role only.
-- 4. `consume_rate_limit_for`: the per-user AI budget of migration 0011 for server code that acts
--    on behalf of a user without a user JWT (n8n bot /sum, capture summarize). Service role only;
--    `consume_rate_limit` (auth.uid()) stays the only entry point for signed-in clients.

CREATE TABLE IF NOT EXISTS public.n8n_events (
  source text NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 512),
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);
CREATE INDEX IF NOT EXISTS n8n_events_created_idx ON public.n8n_events (created_at);
ALTER TABLE public.n8n_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.n8n_events FROM anon, authenticated;
GRANT ALL ON public.n8n_events TO service_role;

ALTER TABLE public.inbox_items DROP CONSTRAINT IF EXISTS inbox_items_source_check;
ALTER TABLE public.inbox_items ADD CONSTRAINT inbox_items_source_check
  CHECK (source IN ('manual', 'telegram', 'voice', 'ocr', 'email', 'google_calendar', 'webhook'));

CREATE OR REPLACE FUNCTION public.n8n_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id FROM auth.users u
  WHERE _email IS NOT NULL AND lower(u.email) = lower(trim(_email))
  ORDER BY u.created_at
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.n8n_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.n8n_user_id_by_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_for(
  _user_id uuid,
  _bucket text,
  _max integer,
  _window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _count integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user id required' USING ERRCODE = '22023';
  END IF;
  IF _bucket IS NULL OR length(_bucket) NOT BETWEEN 1 AND 64
     OR _max IS NULL OR _max < 1 OR _max > 10000
     OR _window_seconds IS NULL OR _window_seconds < 1 OR _window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limits AS r (user_id, bucket, window_start, count)
  VALUES (_user_id, _bucket, now(), 1)
  ON CONFLICT (user_id, bucket) DO UPDATE
    SET window_start = CASE
          WHEN r.window_start <= now() - make_interval(secs => _window_seconds) THEN now()
          ELSE r.window_start
        END,
        count = CASE
          WHEN r.window_start <= now() - make_interval(secs => _window_seconds) THEN 1
          ELSE r.count + 1
        END
  RETURNING count INTO _count;

  RETURN _count <= _max;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit_for(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit_for(uuid, text, integer, integer) TO service_role;

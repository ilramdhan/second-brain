-- Per-user rate limiting for expensive server functions (AI gateway calls; plan item 1.7,
-- ANALYSIS S8).
--
-- `public.rate_limits` stores one fixed-window counter per (user, bucket). It has RLS enabled
-- and no policies, and `authenticated` has no table privileges, so clients can neither read nor
-- reset their counters. The only entry point is `consume_rate_limit`, a SECURITY DEFINER
-- function that always uses `auth.uid()` (a caller cannot spend someone else's quota), creates
-- or resets the window atomically with INSERT ... ON CONFLICT, and returns whether the call is
-- allowed. Server functions call it through the per-user (RLS) Supabase client.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
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
  _uid uuid := (SELECT auth.uid());
  _count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _bucket IS NULL OR length(_bucket) NOT BETWEEN 1 AND 64
     OR _max IS NULL OR _max < 1 OR _max > 10000
     OR _window_seconds IS NULL OR _window_seconds < 1 OR _window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid rate limit arguments' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.rate_limits AS r (user_id, bucket, window_start, count)
  VALUES (_uid, _bucket, now(), 1)
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

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO authenticated, service_role;

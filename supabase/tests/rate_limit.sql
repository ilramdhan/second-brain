-- Checks for migration 0011 (public.consume_rate_limit, plan item 1.7).
-- Run as a superuser after all migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rate_limit.sql
-- Runs in one transaction that is rolled back; success ends with "rate_limit: all checks passed".

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'rl-a@example.test'),
  ('00000000-0000-0000-0000-00000000c002', 'rl-b@example.test');

CREATE FUNCTION pg_temp.login(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;

DO $$
DECLARE
  a uuid := '00000000-0000-0000-0000-00000000c001';
  b uuid := '00000000-0000-0000-0000-00000000c002';
  ok boolean;
  denied boolean;
BEGIN
  -- Budget of 3: three calls pass, the fourth is refused.
  PERFORM pg_temp.login(a);
  FOR i IN 1..3 LOOP
    IF NOT public.consume_rate_limit('ai', 3, 600) THEN
      RAISE EXCEPTION 'FAIL call % should be allowed', i;
    END IF;
  END LOOP;
  IF public.consume_rate_limit('ai', 3, 600) THEN
    RAISE EXCEPTION 'FAIL 4th call should be refused';
  END IF;
  RAISE NOTICE 'ok   budget enforced';

  -- Buckets are independent.
  IF NOT public.consume_rate_limit('other', 3, 600) THEN
    RAISE EXCEPTION 'FAIL separate bucket should be allowed';
  END IF;
  RAISE NOTICE 'ok   buckets independent';

  -- The table is not readable or writable by clients.
  denied := false;
  BEGIN
    PERFORM count(*) FROM public.rate_limits;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL authenticated can read rate_limits'; END IF;
  denied := false;
  BEGIN
    DELETE FROM public.rate_limits;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL authenticated can reset rate_limits'; END IF;
  RAISE NOTICE 'ok   table not accessible to clients';

  -- Another user has their own budget.
  PERFORM pg_temp.login(b);
  IF NOT public.consume_rate_limit('ai', 3, 600) THEN
    RAISE EXCEPTION 'FAIL user b should have a separate budget';
  END IF;
  RAISE NOTICE 'ok   per-user budgets';

  -- Invalid arguments are rejected.
  denied := false;
  BEGIN
    PERFORM public.consume_rate_limit('ai', 0, 600);
  EXCEPTION WHEN invalid_parameter_value THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL invalid max accepted'; END IF;
  RAISE NOTICE 'ok   invalid arguments rejected';

  -- Expired window resets the counter.
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.rate_limits SET window_start = now() - interval '1 hour' WHERE user_id = a;
  PERFORM pg_temp.login(a);
  IF NOT public.consume_rate_limit('ai', 3, 600) THEN
    RAISE EXCEPTION 'FAIL expired window should reset';
  END IF;
  RAISE NOTICE 'ok   window resets';

  -- anon cannot call it at all.
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  denied := false;
  BEGIN
    PERFORM public.consume_rate_limit('ai', 3, 600);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL anon can call consume_rate_limit'; END IF;
  RAISE NOTICE 'ok   anon denied';
  PERFORM set_config('role', 'postgres', true);
END $$;

SELECT 'rate_limit: all checks passed' AS result;

ROLLBACK;

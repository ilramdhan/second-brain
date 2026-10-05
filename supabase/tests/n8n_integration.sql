-- Checks for migration 0012 (n8n integration: n8n_events, inbox sources, service-role helpers).
-- Run as a superuser after all migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/n8n_integration.sql
-- Runs in one transaction that is rolled back; success ends with "n8n_integration: all checks passed".

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000d001', 'N8N-A@example.test'),
  ('00000000-0000-0000-0000-00000000d002', 'n8n-b@example.test');

CREATE FUNCTION pg_temp.as_role(_role text, _uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', _role)::text, true),
         set_config('role', _role, true);
$$;

DO $$
DECLARE ok boolean; uid uuid; n int;
BEGIN
  -- New inbox sources are accepted, unknown ones rejected.
  INSERT INTO public.inbox_items (user_id, content, source) VALUES
    ('00000000-0000-0000-0000-00000000d001', 'mail', 'email'),
    ('00000000-0000-0000-0000-00000000d001', 'cal', 'google_calendar'),
    ('00000000-0000-0000-0000-00000000d001', 'hook', 'webhook');
  BEGIN
    INSERT INTO public.inbox_items (user_id, content, source) VALUES ('00000000-0000-0000-0000-00000000d001', 'x', 'sms');
    RAISE EXCEPTION 'FAIL: inbox source sms accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Idempotency key is unique per (source, external_id).
  INSERT INTO public.n8n_events (source, external_id) VALUES ('telegram', '1');
  INSERT INTO public.n8n_events (source, external_id) VALUES ('telegram', '1') ON CONFLICT DO NOTHING;
  INSERT INTO public.n8n_events (source, external_id) VALUES ('email', '1');
  SELECT count(*) INTO n FROM public.n8n_events;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 n8n_events, got %', n; END IF;

  -- Email lookup is case-insensitive.
  SELECT public.n8n_user_id_by_email(' n8n-a@EXAMPLE.test ') INTO uid;
  IF uid IS DISTINCT FROM '00000000-0000-0000-0000-00000000d001' THEN RAISE EXCEPTION 'FAIL: email lookup %', uid; END IF;
  IF public.n8n_user_id_by_email('nobody@example.test') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: unknown email resolved'; END IF;

  -- Rate limit for a given user (service role path).
  SELECT public.consume_rate_limit_for('00000000-0000-0000-0000-00000000d002', 'ai', 2, 600) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: first call denied'; END IF;
  SELECT public.consume_rate_limit_for('00000000-0000-0000-0000-00000000d002', 'ai', 2, 600) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: second call denied'; END IF;
  SELECT public.consume_rate_limit_for('00000000-0000-0000-0000-00000000d002', 'ai', 2, 600) INTO ok;
  IF ok THEN RAISE EXCEPTION 'FAIL: third call allowed'; END IF;
END
$$;

-- Signed-in users cannot touch the ledger or call the service-role helpers.
SELECT pg_temp.as_role('authenticated', '00000000-0000-0000-0000-00000000d001');
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.n8n_events;
    RAISE EXCEPTION 'FAIL: authenticated can read n8n_events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.n8n_user_id_by_email('n8n-b@example.test');
    RAISE EXCEPTION 'FAIL: authenticated can resolve emails';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.consume_rate_limit_for('00000000-0000-0000-0000-00000000d002', 'ai', 5, 600);
    RAISE EXCEPTION 'FAIL: authenticated can spend another user''s budget';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
SELECT pg_temp.as_role('anon', NULL);
DO $$
BEGIN
  BEGIN
    PERFORM public.n8n_user_id_by_email('n8n-b@example.test');
    RAISE EXCEPTION 'FAIL: anon can resolve emails';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
SELECT set_config('role', 'postgres', true);

SELECT 'n8n_integration: all checks passed' AS result;
ROLLBACK;

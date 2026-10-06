-- Demo-mode row limits, text-size caps, a per-user write quota and demo account protection
-- (Phase 10, PR2).
--
-- The public demo (demo-2ndbrain.ilramdhan.dev) shares one account between all visitors and runs
-- on a free Supabase project. The app hides risky features (PR1), but the anon/publishable key
-- lets anyone talk to PostgREST directly, so the database itself must stop a visitor from
-- filling the project, writing huge blobs or locking everybody out of the demo account.
--
-- Everything here is switched off unless `public.app_config` has the row
-- `('demo_mode', 'on')`. No migration inserts that row, so production behaves exactly as
-- before: every trigger returns immediately after one primary-key lookup.
--
-- app_config keys (service role only, see 0001; all optional except demo_mode):
--   demo_mode          'on' enables everything below.
--   demo_limit:<table> per-user row limit for <table>, overrides the default trigger argument.
--   demo_write_max     writes (statements) per window, default 600 (1..10000).
--   demo_write_window  window in seconds, default 3600 (1..86400).
--   demo_user_email    the shared demo account protected on auth.users.
--
-- Who is limited: only requests with a signed-in user, i.e. `auth.uid()` is set and the JWT role
-- is not `service_role`. The service role (supabaseAdmin: seed, daily reset, n8n), direct
-- database connections and SECURITY DEFINER jobs without a JWT are never limited.
--
-- Errors are raised with ERRCODE P0001 and a message that starts with "Batas demo: ", which the
-- client shows as-is (src/lib/errors.ts).

-- 1. Settings ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.demo_setting(_key text, _default text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT c.value FROM public.app_config c WHERE c.key = _key), _default);
$$;

CREATE OR REPLACE FUNCTION public.demo_mode_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(lower(public.demo_setting('demo_mode', 'off')) = 'on', false);
$$;

-- Integer setting with a fallback for missing or malformed values, clamped to [_min, _max].
CREATE OR REPLACE FUNCTION public.demo_int_setting(_key text, _default integer, _min integer, _max integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _raw text := btrim(public.demo_setting(_key, NULL));
  _value integer := _default;
BEGIN
  IF _raw ~ '^[0-9]{1,9}$' THEN
    _value := _raw::integer;
  END IF;
  RETURN greatest(_min, least(_max, _value));
END;
$$;

-- True when the current request must be limited: demo on, a signed-in user, not the service role.
-- The JWT role is read from both the current (`request.jwt.claims`) and the legacy
-- (`request.jwt.claim.role`) settings, because auth.role() reads only one of them on older images.
CREATE OR REPLACE FUNCTION public.demo_enforced()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _claims text := nullif(current_setting('request.jwt.claims', true), '');
  _role text;
BEGIN
  IF NOT public.demo_mode_enabled() THEN
    RETURN false;
  END IF;
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;
  _role := coalesce(
    CASE WHEN _claims IS NOT NULL THEN _claims::jsonb ->> 'role' END,
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  );
  RETURN _role <> 'service_role';
END;
$$;

-- 2. Row limits and text sizes (BEFORE INSERT OR UPDATE, FOR EACH ROW) ---------------------------
--
-- Trigger arguments: TG_ARGV[0] default row limit, TG_ARGV[1] how rows are attributed to the
-- caller ('user_id', 'invited_by' or 'project_owner' = rows of projects the caller owns),
-- TG_ARGV[2] Indonesian label for the error message.
-- Soft-deleted and archived rows are counted too, otherwise trash-and-recreate would bypass the
-- limit; restoring from the trash does not insert, so it is never blocked.

CREATE OR REPLACE FUNCTION public.demo_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid;
  _limit integer;
  _owner text := coalesce(TG_ARGV[1], 'user_id');
  _label text := coalesce(TG_ARGV[2], TG_TABLE_NAME);
  _count bigint;
  _new jsonb;
  _old jsonb;
  _field record;
BEGIN
  IF NOT public.demo_enforced() THEN
    RETURN NEW;
  END IF;
  _uid := (SELECT auth.uid());

  IF TG_OP = 'INSERT' THEN
    _limit := public.demo_int_setting(
      'demo_limit:' || TG_TABLE_NAME,
      coalesce(nullif(TG_ARGV[0], '')::integer, 0),
      0,
      100000
    );
    IF _limit = 0 THEN
      RAISE EXCEPTION 'Batas demo: % tidak tersedia di demo.', _label USING ERRCODE = 'P0001';
    END IF;

    -- Serialise concurrent inserts of the same user into the same table so the count is exact.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(TG_TABLE_NAME || ':' || _uid::text));

    IF _owner = 'project_owner' THEN
      EXECUTE format(
        'SELECT count(*) FROM %I.%I t WHERE t.project_id IN (SELECT p.id FROM public.projects p WHERE p.user_id = $1)',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
      ) INTO _count USING _uid;
    ELSE
      EXECUTE format('SELECT count(*) FROM %I.%I t WHERE t.%I = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME, _owner)
        INTO _count USING _uid;
    END IF;

    IF _count >= _limit THEN
      RAISE EXCEPTION 'Batas demo: maksimal % % per akun. Hapus permanen sebagian di Arsip atau tunggu reset harian pukul 00.00 WIB.',
        _limit, _label USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Size caps; on UPDATE only for values that changed, so seeded rows stay editable.
  _new := to_jsonb(NEW);
  _old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  FOR _field IN
    SELECT * FROM (VALUES
      ('title', 200, 'judul'),
      ('name', 200, 'nama'),
      ('description', 4000, 'deskripsi'),
      ('content', 20000, 'isi')
    ) AS f(col, max_len, label)
  LOOP
    IF _new ? _field.col
       AND _new -> _field.col IS DISTINCT FROM _old -> _field.col
       AND length(_new ->> _field.col) > _field.max_len THEN
      RAISE EXCEPTION 'Batas demo: % maksimal % karakter.', _field.label, _field.max_len
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOR _field IN
    SELECT * FROM (VALUES ('blocks', 'isi catatan'), ('payload', 'isi template')) AS f(col, label)
  LOOP
    IF _new ? _field.col
       AND _new -> _field.col IS DISTINCT FROM _old -> _field.col
       AND pg_catalog.octet_length((_new -> _field.col)::text) > 65536 THEN
      RAISE EXCEPTION 'Batas demo: % maksimal 64 KB.', _field.label USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 3. Write quota (BEFORE INSERT OR UPDATE OR DELETE, FOR EACH STATEMENT) ------------------------
--
-- One unit per statement from the shared per-user limiter (0011), bucket 'demo_write'. A refused
-- statement rolls back its own increment, so the counter stays at the maximum until the window
-- resets. Mirrored as DEMO_WRITE_LIMIT in src/server/rateLimit.server.ts.

CREATE OR REPLACE FUNCTION public.demo_write_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _max integer;
  _window integer;
BEGIN
  IF NOT public.demo_enforced() THEN
    RETURN NULL;
  END IF;
  _max := public.demo_int_setting('demo_write_max', 600, 1, 10000);
  _window := public.demo_int_setting('demo_write_window', 3600, 1, 86400);
  IF NOT public.consume_rate_limit('demo_write', _max, _window) THEN
    RAISE EXCEPTION 'Batas demo: kuota tulis tercapai (% perubahan per % menit). Coba lagi nanti.',
      _max, greatest(1, _window / 60) USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$;

-- 4. Attach the triggers ------------------------------------------------------------------------
-- Not limited: note_versions, activity_logs, automation_runs (written by triggers/the server as a
-- side effect of the writes above), rate_limits, n8n_events and other service-role tables.

DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('tasks', 300, 'user_id', 'tugas'),
      ('notes', 150, 'user_id', 'catatan'),
      ('projects', 20, 'user_id', 'proyek'),
      ('inbox_items', 100, 'user_id', 'item inbox'),
      ('milestones', 60, 'user_id', 'milestone'),
      ('task_comments', 300, 'user_id', 'komentar'),
      ('task_dependencies', 200, 'user_id', 'dependensi'),
      ('automations', 20, 'user_id', 'otomasi'),
      ('canvas_boards', 10, 'user_id', 'papan kanvas'),
      ('canvas_nodes', 300, 'user_id', 'node kanvas'),
      ('canvas_edges', 300, 'user_id', 'garis kanvas'),
      ('templates', 30, 'user_id', 'template'),
      ('time_entries', 300, 'user_id', 'catatan waktu'),
      ('project_members', 10, 'project_owner', 'anggota proyek'),
      ('project_invites', 0, 'invited_by', 'undangan proyek')
    ) AS v(tbl, lim, owner_col, label)
  LOOP
    IF to_regclass('public.' || _t.tbl) IS NULL THEN
      RAISE NOTICE 'demo limits: table public.% not found, skipped', _t.tbl;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_demo_guard ON public.%I', _t.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_demo_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.demo_guard(%L, %L, %L)',
      _t.tbl, _t.lim::text, _t.owner_col, _t.label
    );
    EXECUTE format('DROP TRIGGER IF EXISTS zz_demo_write ON public.%I', _t.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_demo_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.demo_write_quota()',
      _t.tbl
    );
  END LOOP;
END;
$$;

-- 5. Demo account protection on auth.users -------------------------------------------------------
--
-- Visitors share the demo login, so nobody may change its password or email or delete it (the
-- Auth API would otherwise let any visitor lock everyone else out). Sign-ins still update
-- last_sign_in_at, tokens and metadata, which is allowed. GoTrue writes auth.users as
-- supabase_auth_admin without a JWT, so this cannot tell a visitor from the admin API: to rotate
-- the demo password or delete the account, remove the demo_mode row (or change
-- demo_user_email) first.

CREATE OR REPLACE FUNCTION public.demo_protect_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _email text;
BEGIN
  IF NOT public.demo_mode_enabled() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  _email := lower(btrim(public.demo_setting('demo_user_email', '')));
  IF _email = '' OR lower(OLD.email) IS DISTINCT FROM _email THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Batas demo: akun demo tidak bisa dihapus.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
     OR NEW.email IS DISTINCT FROM OLD.email
     OR (NEW.email_change IS DISTINCT FROM OLD.email_change AND coalesce(NEW.email_change, '') <> '') THEN
    RAISE EXCEPTION 'Batas demo: email dan kata sandi akun demo tidak bisa diubah.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_demo_protect_user ON auth.users;
CREATE TRIGGER zz_demo_protect_user BEFORE UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.demo_protect_user();

-- 6. Privileges --------------------------------------------------------------------------------
-- Only the triggers call these (trigger functions are not checked for EXECUTE when they fire).

REVOKE ALL ON FUNCTION public.demo_setting(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_mode_enabled() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_int_setting(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_enforced() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_write_quota() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.demo_protect_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.demo_setting(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.demo_mode_enabled() TO service_role;

-- Checks for migration 0018 (notes.links / refs / excerpt, GIN indexes, backfill and the
-- note_backlinks RPC). Plan item 4.2.
--
-- Run with psql (it uses \ir to re-apply the migration, which also checks it is idempotent) as a
-- superuser against a database with all migrations applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/note_links.sql
-- Everything runs in one transaction that is rolled back; success ends with
-- "note_links: all checks passed".

BEGIN;

CREATE FUNCTION pg_temp.login(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', _uid::text, true),
         set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true);
$$;
CREATE FUNCTION pg_temp.logout() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('role', 'postgres', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claims', '', true);
$$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-00000000d1a1', 'nl-owner@example.test'),
  ('00000000-0000-0000-0000-00000000d1b2', 'nl-stranger@example.test');

-- Rows written "outside the app" (columns at their defaults) to exercise the backfill.
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('40000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d1a1', 'Target',
   'Intro line ^tgtblk01'),
  ('40000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000d1a1', 'Linker',
   E'- See [[ Target | alias ]] and [[TARGET]]\n{{embed ((tgtblk01))}}\nref ((abc12345)) ((bad)) [[]]'),
  ('40000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000d1a1', 'Mention',
   'plain mention of target without a link'),
  ('40000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000d1a1', 'Long',
   repeat('x', 500)),
  ('40000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d1b2', 'Stranger',
   'secret [[target]]');

-- Re-apply the migration: backfills the rows above and must be idempotent.
\ir ../../drizzle/migrations/0018_note_links_refs_excerpt.sql
\ir ../../drizzle/migrations/0018_note_links_refs_excerpt.sql

DO $$
BEGIN
  IF to_regclass('public.notes_links_gin_idx') IS NULL OR to_regclass('public.notes_refs_gin_idx') IS NULL THEN
    RAISE EXCEPTION 'FAIL GIN indexes missing';
  END IF;
  IF (SELECT links FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a2') <> ARRAY['target'] THEN
    RAISE EXCEPTION 'FAIL backfilled links: %', (SELECT links FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a2');
  END IF;
  IF (SELECT array(SELECT unnest(refs) ORDER BY 1) FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a2')
     <> ARRAY['abc12345', 'tgtblk01'] THEN
    RAISE EXCEPTION 'FAIL backfilled refs';
  END IF;
  IF (SELECT excerpt FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a4') <> repeat('x', 200)
     OR (SELECT excerpt FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a1') <> 'Intro line ^tgtblk01' THEN
    RAISE EXCEPTION 'FAIL backfilled excerpt';
  END IF;
  -- The backfill must not create note_versions snapshots or activity rows.
  IF EXISTS (SELECT 1 FROM public.note_versions WHERE note_id::text LIKE '40000000-%')
     OR EXISTS (SELECT 1 FROM public.activity_logs WHERE entity_id::text LIKE '40000000-%' AND action = 'update') THEN
    RAISE EXCEPTION 'FAIL backfill fired user triggers';
  END IF;
  -- The excerpt is bounded.
  BEGIN
    UPDATE public.notes SET excerpt = repeat('y', 201) WHERE id = '40000000-0000-0000-0000-0000000000a4';
    RAISE EXCEPTION 'FAIL excerpt longer than 200 accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok   columns, GIN indexes, backfill';
END $$;

-- App-indexed rows are left alone by a re-run of the backfill.
UPDATE public.notes SET links = ARRAY['kept'], excerpt = 'kept'
WHERE id = '40000000-0000-0000-0000-0000000000a3';
\ir ../../drizzle/migrations/0018_note_links_refs_excerpt.sql
DO $$
BEGIN
  IF (SELECT excerpt FROM public.notes WHERE id = '40000000-0000-0000-0000-0000000000a3') <> 'kept' THEN
    RAISE EXCEPTION 'FAIL backfill overwrote app-indexed row';
  END IF;
  UPDATE public.notes SET links = '{}', excerpt = 'plain mention of target without a link'
  WHERE id = '40000000-0000-0000-0000-0000000000a3';
END $$;

-- note_backlinks under RLS --------------------------------------------------------------------
DO $$
DECLARE
  owner constant uuid := '00000000-0000-0000-0000-00000000d1a1';
  target constant uuid := '40000000-0000-0000-0000-0000000000a1';
  n int;
BEGIN
  PERFORM pg_temp.login(owner);

  -- By title: Linker (linked, with blocks/content) and Mention (unlinked). Stranger's note is
  -- invisible under RLS; Target itself is excluded.
  SELECT count(*) INTO n FROM public.note_backlinks(target, 'target', ARRAY[]::text[]) WHERE linked;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL linked by title: %', n; END IF;
  IF (SELECT count(*) FROM public.note_backlinks(target, 'target', ARRAY[]::text[]) WHERE NOT linked) <> 1 THEN
    RAISE EXCEPTION 'FAIL unlinked mentions';
  END IF;
  IF EXISTS (SELECT 1 FROM public.note_backlinks(target, 'target', ARRAY[]::text[])
             WHERE id IN (target, '40000000-0000-0000-0000-0000000000b1')) THEN
    RAISE EXCEPTION 'FAIL backlinks include self or an invisible note';
  END IF;
  IF (SELECT content FROM public.note_backlinks(target, 'target', ARRAY[]::text[]) WHERE linked)
     NOT LIKE '%[[ Target | alias ]]%' THEN
    RAISE EXCEPTION 'FAIL legacy linked note without blocks returns no content';
  END IF;

  -- By block ref only (title that nobody links to).
  SELECT count(*) INTO n FROM public.note_backlinks(target, 'nobody-links-this', ARRAY['tgtblk01']) WHERE linked;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL linked by block ref: %', n; END IF;

  -- LIKE wildcards in the title are literal.
  SELECT count(*) INTO n FROM public.note_backlinks(target, '%%%', ARRAY[]::text[]);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL wildcard title matched % rows', n; END IF;

  -- Trashed/archived notes are not backlinks.
  UPDATE public.notes SET archived_at = now() WHERE id = '40000000-0000-0000-0000-0000000000a2';
  IF EXISTS (SELECT 1 FROM public.note_backlinks(target, 'target', ARRAY['tgtblk01']) WHERE linked) THEN
    RAISE EXCEPTION 'FAIL archived note listed as backlink';
  END IF;
  PERFORM pg_temp.logout();

  -- anon may not call it.
  IF has_function_privilege('anon', 'public.note_backlinks(uuid, text, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL anon can execute note_backlinks';
  END IF;
  RAISE NOTICE 'ok   note_backlinks respects RLS, refs, wildcards, archive';
END $$;

SELECT 'note_links: all checks passed' AS result;

ROLLBACK;

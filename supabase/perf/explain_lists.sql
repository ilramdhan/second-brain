-- EXPLAIN ANALYZE for the main list queries (plan items 0.4 / 2.6, docs/perf-baseline.md §4).
--
-- Seeds a synthetic workload (200 users, 40 000 tasks, 10 000 notes, 400 projects, shared
-- memberships), runs ANALYZE and prints the plans of the queries the app sends through PostgREST
-- as the `authenticated` role. Run as a superuser against a throwaway database with all
-- migrations applied:
--   psql "$DATABASE_URL" -f supabase/perf/explain_lists.sql
-- Everything is rolled back. Timings depend on the machine; compare plan shapes and buffers
-- between runs on the same machine.

BEGIN;

SET LOCAL client_min_messages = warning;

-- Fixtures (as superuser) -----------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT ('00000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid, 'perf' || g || '@example.test'
FROM generate_series(1, 200) g;

-- Two projects per user.
INSERT INTO public.projects (id, user_id, name)
SELECT ('10000000-0000-0000-0000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(to_hex((g - 1) % 200 + 1), 12, '0'))::uuid,
       'Project ' || g
FROM generate_series(1, 400) g;

-- Every user is a member of three other users' (task-bearing) projects.
INSERT INTO public.project_members (project_id, user_id)
SELECT ('10000000-0000-0000-0000-' || lpad(to_hex(((u + k * 37) % 200) + 1), 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(to_hex(u), 12, '0'))::uuid
FROM generate_series(1, 200) u, generate_series(1, 3) k
ON CONFLICT DO NOTHING;

-- 200 tasks per user, half in their first project; 10 % trashed, 10 % archived.
INSERT INTO public.tasks (user_id, project_id, title, status, position, deleted_at, archived_at, due_date)
SELECT ('00000000-0000-0000-0000-' || lpad(to_hex((g - 1) % 200 + 1), 12, '0'))::uuid,
       CASE WHEN g % 2 = 0 THEN ('10000000-0000-0000-0000-' || lpad(to_hex((g - 1) % 200 + 1), 12, '0'))::uuid END,
       'Task ' || g,
       (ARRAY['todo','in_progress','review','done'])[g % 4 + 1],
       g,
       CASE WHEN g % 10 = 3 THEN now() END,
       CASE WHEN g % 10 = 7 THEN now() END,
       now() + make_interval(days => g % 60)
FROM generate_series(1, 40000) g;

-- 50 notes per user, a third in a project.
INSERT INTO public.notes (user_id, project_id, title, content, pinned, updated_at, deleted_at, archived_at)
SELECT ('00000000-0000-0000-0000-' || lpad(to_hex((g - 1) % 200 + 1), 12, '0'))::uuid,
       CASE WHEN g % 3 = 0 THEN ('10000000-0000-0000-0000-' || lpad(to_hex((g - 1) % 200 + 1), 12, '0'))::uuid END,
       'Note ' || g, repeat('lorem ipsum ', 20), g % 25 = 0,
       now() - make_interval(mins => g),
       CASE WHEN g % 10 = 3 THEN now() END,
       CASE WHEN g % 10 = 7 THEN now() END
FROM generate_series(1, 10000) g;

ANALYZE auth.users, public.projects, public.project_members, public.tasks, public.notes;

-- Act as user #42 through PostgREST's settings.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000002a', true),
       set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000002a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

\echo '=== Q1 tasks list (useTasks) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT * FROM public.tasks
WHERE deleted_at IS NULL AND archived_at IS NULL
ORDER BY position, created_at;

\echo '=== Q2 tasks of one project (project page) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT * FROM public.tasks
WHERE project_id = '10000000-0000-0000-0000-00000000002a' AND deleted_at IS NULL AND archived_at IS NULL
ORDER BY position, created_at;

\echo '=== Q3 notes list (useNotes) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT * FROM public.notes
WHERE deleted_at IS NULL AND archived_at IS NULL
ORDER BY pinned DESC, updated_at DESC;

RESET ROLE;

\echo '=== Q4 tasks by user (service role, n8n) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT * FROM public.tasks
WHERE user_id = '00000000-0000-0000-0000-00000000002a' AND deleted_at IS NULL AND archived_at IS NULL
ORDER BY position, created_at;

ROLLBACK;

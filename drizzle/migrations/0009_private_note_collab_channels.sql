-- Realtime Authorization for note collaboration (ANALYSIS S3, plan item 1.3).
-- `src/hooks/use-note-collaboration.ts` joins the private channel `note-collab:<noteId>`. Supabase
-- Realtime checks private channels against RLS on `realtime.messages`: a SELECT policy decides who
-- may join and receive broadcast/presence, an INSERT policy who may broadcast or track presence.
-- Both only allow the note's owner and members of the note's project.

-- Parses `note-collab:<uuid>` into the note id. Returns NULL for any other topic (wrong prefix,
-- malformed or non-canonical uuid), so policies never raise on a hostile topic name.
CREATE OR REPLACE FUNCTION public.note_collab_topic_note_id(_topic text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _topic ~ '^note-collab:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN substr(_topic, 13)::uuid
  END
$$;

-- True when the current user owns the note or is a member of its project. Trashed notes are
-- excluded. SECURITY DEFINER so the check does not depend on the caller's RLS on `notes`.
CREATE OR REPLACE FUNCTION public.can_access_note(_note_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _note_id IS NOT NULL AND (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = _note_id
      AND n.deleted_at IS NULL
      AND (n.user_id = (SELECT auth.uid()) OR public.is_project_member(n.project_id, (SELECT auth.uid())))
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_note(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_note(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.note_collab_topic_note_id(text) TO authenticated, service_role;

-- `realtime.messages` is created by the Realtime service. Skip (with a notice) on databases
-- without it, such as a plain Postgres used for local checks.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE 'realtime.messages not found; note collaboration policies not created';
    RETURN;
  END IF;

  -- Supabase already enables RLS here (and the table is owned by the Realtime admin role).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'realtime.messages'::regclass) THEN
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
  END IF;

  DROP POLICY IF EXISTS note_collab_receive ON realtime.messages;
  CREATE POLICY note_collab_receive ON realtime.messages FOR SELECT TO authenticated
    USING (
      realtime.messages.extension IN ('broadcast', 'presence')
      AND public.can_access_note(public.note_collab_topic_note_id((SELECT realtime.topic())))
    );

  DROP POLICY IF EXISTS note_collab_send ON realtime.messages;
  CREATE POLICY note_collab_send ON realtime.messages FOR INSERT TO authenticated
    WITH CHECK (
      realtime.messages.extension IN ('broadcast', 'presence')
      AND public.can_access_note(public.note_collab_topic_note_id((SELECT realtime.topic())))
    );
END
$$;

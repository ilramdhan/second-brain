-- Two-way Google Calendar sync (plan item 9.3).
--
-- Until now the sync was one-way (app → Google): `tasks.google_event_id` linked a task to the
-- event the app created. The Google → app direction pulls changed events incrementally with the
-- Calendar API `syncToken` (src/server/googleCalendarPull.server.ts) and needs a little state:
--
--   * `app_user_connections.sync_token`: the `nextSyncToken` of the last complete events.list
--     (null = next pull is a full sync; also reset on reconnect and after a 410 GONE).
--     It is not a credential (useless without the user's access token) and the table stays
--     service-role only (no grants to anon/authenticated, RLS without policies, see 0004).
--   * `app_user_connections.last_pulled_at`: shown in Settings.
--   * `app_user_connections.import_events`: per-connection opt-in "Impor acara Google sebagai
--     tugas" (default off). Off = only events already linked to a task are pulled.
--   * `tasks.google_etag`: etag of the event as the app last wrote or read it. A pulled event with
--     the same etag is the app's own write coming back (echo) and is skipped.
--   * `tasks.google_synced_at`: the task `updated_at` that was last pushed to or pulled from
--     Google. A task is pushed again only when `updated_at` moved past it, so a change that just
--     came from Google is never re-pushed. Conflicts are last-write-wins (Google `updated` vs
--     task `updated_at`).
--
-- `audit_row_change` (0013) skipped UPDATEs that changed nothing but `updated_at`; it now also
-- ignores the two sync bookkeeping columns, so recording an etag after a push does not add an
-- empty "update" to the activity log. The function body is otherwise unchanged.
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.app_user_connections
  ADD COLUMN IF NOT EXISTS sync_token text,
  ADD COLUMN IF NOT EXISTS last_pulled_at timestamptz,
  ADD COLUMN IF NOT EXISTS import_events boolean NOT NULL DEFAULT false;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS google_etag text,
  ADD COLUMN IF NOT EXISTS google_synced_at timestamptz;

-- The pull looks tasks up by event id (only linked tasks, so a small partial index).
CREATE INDEX IF NOT EXISTS tasks_google_event_idx ON public.tasks (google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _row jsonb; _entity_id uuid; _owner uuid; _metadata jsonb; _changed text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(k), '{}')
      INTO _changed
      FROM jsonb_object_keys(to_jsonb(NEW)) k
     WHERE to_jsonb(NEW) -> k IS DISTINCT FROM to_jsonb(OLD) -> k;
    IF _changed <@ ARRAY['updated_at', 'google_etag', 'google_synced_at'] THEN
      RETURN NEW;
    END IF;
  END IF;

  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _entity_id := CASE WHEN (_row->>'id') ~* '^[0-9a-f-]{36}$' THEN (_row->>'id')::uuid ELSE NULL END;
  _owner := auth.uid();
  IF _owner IS NULL AND (_row->>'user_id') ~* '^[0-9a-f-]{36}$' THEN _owner := (_row->>'user_id')::uuid; END IF;
  IF TG_OP = 'DELETE' AND _owner IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _owner) THEN
    RETURN OLD;
  END IF;
  _metadata := jsonb_build_object('table', TG_TABLE_NAME);
  IF TG_OP = 'UPDATE' THEN
    _metadata := _metadata || jsonb_build_object('changed_fields', (
      SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
      FROM unnest(_changed) k
      WHERE k NOT IN ('content','description','blocks','connection_key_ciphertext',
                    'google_etag','google_synced_at')
    ));
  END IF;
  INSERT INTO public.activity_logs(user_id, action, entity_type, entity_id, metadata, source)
  VALUES (_owner, lower(TG_OP), TG_TABLE_NAME, _entity_id, _metadata, 'database');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

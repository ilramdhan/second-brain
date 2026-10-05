-- One audit trigger per table (plan item 2.1, ANALYSIS §2.10 / §6.2).
--
-- 0004 created `<t>_audit` on 15 tables. 0006 meant to replace it but dropped and recreated a
-- trigger with a different name (`audit_<t>_changes`), so every insert/update/delete on those
-- tables wrote two identical `activity_logs` rows. Both triggers are
-- `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW EXECUTE FUNCTION audit_row_change()`, so
-- dropping the 0004 one loses no events. `audit_<t>_changes` is kept because 0006 also covers
-- `profiles`, which 0004 did not. The 0007 trigger on `templates` is renamed to the same scheme.
--
-- `audit_row_change` now also skips no-op UPDATEs (nothing but `updated_at` changed, e.g. a save
-- that rewrote identical values), which only produced empty `changed_fields` entries. Changes to
-- `content`/`description`/`blocks` still count as changes; they are only left out of the logged
-- `changed_fields` list, as before.
--
-- It also skips DELETEs whose owner no longer exists in auth.users. Those come from an account
-- deletion cascading into the user's rows (0016 adds the ON DELETE CASCADE FKs) and would
-- otherwise leave orphaned activity_logs rows for a deleted account. One primary-key lookup,
-- only on DELETE.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'inbox_items', 'tasks', 'notes', 'milestones', 'project_invites',
    'project_members', 'task_comments', 'task_dependencies', 'automations', 'time_entries',
    'canvas_boards', 'canvas_nodes', 'canvas_edges', 'calendar_connections'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_audit', t);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.templates'::regclass AND tgname = 'audit_templates'
  ) THEN
    ALTER TRIGGER audit_templates ON public.templates RENAME TO audit_templates_changes;
  END IF;
END
$$;

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
    IF _changed <@ ARRAY['updated_at'] THEN
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
      WHERE k NOT IN ('content','description','blocks','connection_key_ciphertext')
    ));
  END IF;
  INSERT INTO public.activity_logs(user_id, action, entity_type, entity_id, metadata, source)
  VALUES (_owner, lower(TG_OP), TG_TABLE_NAME, _entity_id, _metadata, 'database');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

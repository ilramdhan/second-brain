CREATE OR REPLACE FUNCTION public.snapshot_note_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_snapshot timestamptz;
  next_version integer;
BEGIN
  IF OLD.title IS NOT DISTINCT FROM NEW.title
     AND OLD.content IS NOT DISTINCT FROM NEW.content
     AND OLD.blocks IS NOT DISTINCT FROM NEW.blocks THEN
    RETURN NEW;
  END IF;

  SELECT max(created_at), coalesce(max(version_number), 0) + 1
    INTO latest_snapshot, next_version
  FROM public.note_versions
  WHERE note_id = OLD.id;

  IF latest_snapshot IS NULL OR latest_snapshot <= now() - interval '10 minutes' THEN
    INSERT INTO public.note_versions (note_id, user_id, title, content, blocks, version_number)
    VALUES (OLD.id, OLD.user_id, OLD.title, OLD.content, OLD.blocks, next_version);
  END IF;

  RETURN NEW;
END;
$$;
-- Stored link index and list excerpt for notes (plan item 4.2).
--
-- Before this migration the note page downloaded every note's `blocks` and parsed all of them on
-- each keystroke to find backlinks, and the notes list selected the whole markdown `content` only
-- to show a few lines of preview. Now every writer stores, next to `blocks`/`content`:
--
--   links   text[]  lower-cased, trimmed `[[title]]` / `[[title|alias]]` targets
--   refs    text[]  block ids referenced as `((id))` or embedded (`embed` blocks)
--   excerpt text    left(content, 200), the list/card preview
--
-- They are computed in the app (src/lib/blocks.ts `noteIndexFields` / `withNoteIndex`, used by
-- `useNoteActions`, the inbox, backup restore and the n8n note writer). Backlinks become
-- `links @> ARRAY[lower(title)]` and `refs && ARRAY[block ids]`, served by the GIN indexes below.
-- RLS is unchanged: the new columns live on `notes` and follow its existing policies.
--
-- Backfill (best effort, SQL only, from `content`, which mirrors `toMarkdown(blocks)`):
--   * links: regexp `\[\[([^]\n]+?)\]\]` over content, split_part(.., '|', 1), trimmed of
--     whitespace, lower(). Same as WIKI_RE + linksOf, except that Postgres `lower()` follows the
--     database collation (identical for ASCII; Unicode case folding may differ slightly) and the
--     trim only strips regex `\s` (JS `trim()` also strips a few Unicode spaces such as U+FEFF).
--   * refs: regexp `\(\(([a-z0-9]{6,10})\)\)` over content. Embed blocks are mirrored as
--     `{{embed ((id))}}`, so they are matched by the same pattern, like linksOf.
--   * Rows whose `content` is out of sync with `blocks` (only possible for rows written outside
--     the app) get the index of their content; the next save from the editor rewrites all three.
-- The backfill only touches rows whose columns are still at their defaults, so re-running it is a
-- no-op for rows already indexed by the app.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS links text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS refs text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excerpt text NOT NULL DEFAULT '';

-- Bounded so a client can not store an unbounded index (the app writes at most 200 chars).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_excerpt_length') THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_excerpt_length CHECK (char_length(excerpt) <= 200);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS notes_links_gin_idx ON public.notes USING gin (links);
CREATE INDEX IF NOT EXISTS notes_refs_gin_idx ON public.notes USING gin (refs);

-- Backfill ------------------------------------------------------------------------------------
-- Disable the user triggers for the backfill: it must not create note_versions snapshots,
-- activity_logs rows or bump anything; it only adds derived columns.
ALTER TABLE public.notes DISABLE TRIGGER USER;

UPDATE public.notes n
SET links = COALESCE((
      SELECT array_agg(DISTINCT t)
      FROM (
        SELECT lower(regexp_replace(split_part(m[1], '|', 1), '^\s+|\s+$', '', 'g')) AS t
        FROM regexp_matches(n.content, '\[\[([^]\n]+?)\]\]', 'g') AS m
      ) s
      WHERE t <> ''
    ), '{}'),
    refs = COALESCE((
      SELECT array_agg(DISTINCT m[1])
      FROM regexp_matches(n.content, '\(\(([a-z0-9]{6,10})\)\)', 'g') AS m
    ), '{}'),
    excerpt = left(n.content, 200)
WHERE n.links = '{}' AND n.refs = '{}' AND n.excerpt = '' AND n.content <> '';

ALTER TABLE public.notes ENABLE TRIGGER USER;

-- Backlinks in one round-trip -------------------------------------------------------------------
-- Notes that link to `_title` (already trimmed + lower-cased by the client, the same way the
-- stored `links` are) or reference one of `_block_ids`, plus up to 50 notes that mention the
-- title in their text without linking it ("unlinked mentions", only for titles longer than 2
-- characters). SECURITY INVOKER: the caller's RLS on `notes` decides what is visible, so no new
-- policy is needed. `blocks` is only returned for linked notes (the client renders snippets),
-- `content` only for linked legacy notes without blocks (loadBlocks falls back to it).
CREATE OR REPLACE FUNCTION public.note_backlinks(_note_id uuid, _title text, _block_ids text[])
RETURNS TABLE (id uuid, title text, blocks jsonb, content text, linked boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH linked AS (
    SELECT n.id, n.title, n.blocks,
           CASE WHEN n.blocks = '[]'::jsonb THEN n.content ELSE '' END AS content, n.updated_at
    FROM public.notes n
    WHERE n.id <> _note_id
      AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND ((_title <> '' AND n.links @> ARRAY[_title])
           OR n.refs && COALESCE(_block_ids, '{}'::text[]))
    ORDER BY n.updated_at DESC
    LIMIT 200
  )
  (SELECT l.id, l.title, l.blocks, l.content, true FROM linked l ORDER BY l.updated_at DESC)
  UNION ALL
  (SELECT n.id, n.title, NULL::jsonb, NULL::text, false
   FROM public.notes n
   WHERE char_length(_title) > 2
     AND n.id <> _note_id
     AND n.deleted_at IS NULL AND n.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM linked l WHERE l.id = n.id)
     AND n.content ILIKE '%' || replace(replace(replace(_title, '\', '\\'), '%', '\%'), '_', '\_') || '%'
   ORDER BY n.updated_at DESC
   LIMIT 50)
$$;

REVOKE ALL ON FUNCTION public.note_backlinks(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.note_backlinks(uuid, text, text[]) TO authenticated, service_role;

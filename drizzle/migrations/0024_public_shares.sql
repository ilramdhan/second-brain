-- Phase 9.5: revocable, tokenized, read-only public links for notes and projects.
--
-- A share is one row in `public.public_shares`. The browser never sees the token after creation:
-- the server function that issues a link (src/lib/shares.functions.ts) generates 32 random bytes,
-- shows the base64url token once and stores only its SHA-256 (`token_hash`, hex). The public page
-- `/s/<token>` hashes the token again and looks the row up with the service role
-- (src/server/publicShare.server.ts), so anonymous visitors never talk to PostgREST and no
-- `anon` policy exists.
--
-- Who may share:
--   note    - its creator, or the owner of the note's project (a member who did not write the
--             note may not publish it), and only while the note is neither trashed nor archived;
--   project - its owner only (members see the board but do not decide to publish it).
-- `can_share_resource()` (SECURITY DEFINER, uses auth.uid()) encodes this, so the policies never
-- query `notes`/`projects` directly. Ownership is checked again at read time, so a share stops
-- working when its creator loses the right to publish (e.g. the note moves to someone else's
-- project).
--
-- Rows are owned by their creator (`user_id`, immutable): they can list, revoke, regenerate the
-- token and change the expiry. A revoked row is frozen (it keeps the history but can never be
-- re-activated; issue a new link instead). `view_count`/`last_viewed_at` are written only by the
-- service role through `record_public_share_view()`. Hard-deleting a note or project deletes its
-- shares. Idempotent.

-- 1. Table ------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.public_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  resource_type text NOT NULL CONSTRAINT public_shares_resource_type_check
    CHECK (resource_type IN ('note', 'project')),
  resource_id uuid NOT NULL,
  token_hash text NOT NULL CONSTRAINT public_shares_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer NOT NULL DEFAULT 0 CONSTRAINT public_shares_view_count_check
    CHECK (view_count >= 0),
  last_viewed_at timestamptz,
  allow_indexing boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS public_shares_token_hash_key ON public.public_shares (token_hash);
-- At most one active link per creator and resource; "regenerate" rotates the token of that row.
CREATE UNIQUE INDEX IF NOT EXISTS public_shares_active_resource_key
  ON public.public_shares (user_id, resource_type, resource_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS public_shares_resource_idx
  ON public.public_shares (resource_type, resource_id);

-- 2. Who may share a resource -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_share_resource(_resource_type text, _resource_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND _resource_id IS NOT NULL AND CASE _resource_type
    WHEN 'note' THEN EXISTS (
      SELECT 1 FROM public.notes n
       WHERE n.id = _resource_id
         AND n.deleted_at IS NULL
         AND n.archived_at IS NULL
         AND (n.user_id = (SELECT auth.uid())
              OR (n.project_id IS NOT NULL AND public.is_project_owner(n.project_id, (SELECT auth.uid()))))
    )
    WHEN 'project' THEN EXISTS (
      SELECT 1 FROM public.projects p
       WHERE p.id = _resource_id
         AND p.deleted_at IS NULL
         AND p.user_id = (SELECT auth.uid())
    )
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION public.can_share_resource(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_share_resource(text, uuid) TO authenticated, service_role;

-- 3. Row guard ---------------------------------------------------------------------------------
-- End-user updates: user_id and the resource are fixed (also covered by the column grants), a
-- revoked link stays revoked, and rotating the token needs the right to share (so a former
-- project owner cannot re-publish). Revoking and shortening the expiry never need it.

CREATE OR REPLACE FUNCTION public.guard_public_share_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id THEN
    RAISE EXCEPTION 'the owner and resource of a share cannot change' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked share cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     AND NOT public.can_share_resource(NEW.resource_type, NEW.resource_id) THEN
    RAISE EXCEPTION 'only the creator or the project owner can share this item' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS a_public_shares_guard ON public.public_shares;
CREATE TRIGGER a_public_shares_guard BEFORE UPDATE ON public.public_shares
  FOR EACH ROW EXECUTE FUNCTION public.guard_public_share_update();

-- 4. RLS ---------------------------------------------------------------------------------------

ALTER TABLE public.public_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_shares_select ON public.public_shares;
DROP POLICY IF EXISTS public_shares_insert ON public.public_shares;
DROP POLICY IF EXISTS public_shares_update ON public.public_shares;
DROP POLICY IF EXISTS public_shares_delete ON public.public_shares;
CREATE POLICY public_shares_select ON public.public_shares FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY public_shares_insert ON public.public_shares FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
    AND public.can_share_resource(resource_type, resource_id));
CREATE POLICY public_shares_update ON public.public_shares FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY public_shares_delete ON public.public_shares FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Two-factor (migration 0022): an aal1 session of a user with a verified factor sees nothing.
DROP POLICY IF EXISTS mfa_aal2 ON public.public_shares;
CREATE POLICY mfa_aal2 ON public.public_shares AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

-- Column grants: the counters and the identity columns are not writable by end users.
REVOKE ALL ON public.public_shares FROM anon, authenticated;
GRANT SELECT, DELETE ON public.public_shares TO authenticated;
GRANT INSERT (user_id, resource_type, resource_id, token_hash, expires_at, allow_indexing)
  ON public.public_shares TO authenticated;
GRANT UPDATE (token_hash, expires_at, revoked_at, allow_indexing)
  ON public.public_shares TO authenticated;
GRANT ALL ON public.public_shares TO service_role;

-- 5. Views (service role only) -----------------------------------------------------------------
-- Atomic increment for the public page; the caller throttles per visitor.

CREATE OR REPLACE FUNCTION public.record_public_share_view(_share_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.public_shares
     SET view_count = view_count + 1, last_viewed_at = now()
   WHERE id = _share_id AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.record_public_share_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_public_share_view(uuid) TO service_role;

-- 6. Cleanup when a note or project is purged ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_public_shares_of_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.public_shares
   WHERE resource_type = TG_ARGV[0] AND resource_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_public_shares_of_row() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notes_delete_public_shares ON public.notes;
CREATE TRIGGER notes_delete_public_shares AFTER DELETE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.delete_public_shares_of_row('note');
DROP TRIGGER IF EXISTS projects_delete_public_shares ON public.projects;
CREATE TRIGGER projects_delete_public_shares AFTER DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.delete_public_shares_of_row('project');

-- 7. Activity log -------------------------------------------------------------------------------
-- Created, revoked, rotated, expiry/indexing changed and deleted. View counter updates are not
-- logged (UPDATE OF lists only the columns an owner changes).

DROP TRIGGER IF EXISTS audit_public_shares_changes ON public.public_shares;
CREATE TRIGGER audit_public_shares_changes
  AFTER INSERT OR DELETE OR UPDATE OF token_hash, expires_at, revoked_at, allow_indexing
  ON public.public_shares
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- 8. Demo limits (migration 0019) ----------------------------------------------------------------
-- Sharing is harmless in the demo, but rows are capped (`demo_limit:public_shares` overrides 10).

DROP TRIGGER IF EXISTS zz_demo_guard ON public.public_shares;
CREATE TRIGGER zz_demo_guard BEFORE INSERT OR UPDATE ON public.public_shares
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard('10', 'user_id', 'tautan publik');
DROP TRIGGER IF EXISTS zz_demo_write ON public.public_shares;
CREATE TRIGGER zz_demo_write BEFORE INSERT OR UPDATE OR DELETE ON public.public_shares
  FOR EACH STATEMENT EXECUTE FUNCTION public.demo_write_quota();

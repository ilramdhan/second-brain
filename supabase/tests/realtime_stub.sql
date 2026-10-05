-- Minimal stand-in for the Realtime service's `realtime.messages` table and `realtime.topic()`,
-- for running supabase/tests/rls_phase1.sql against a Supabase Postgres image without the
-- Realtime service. Apply BEFORE the migrations (0009 creates its policies only when the table
-- exists). Never apply this to a real Supabase project.
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE TABLE IF NOT EXISTS realtime.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  extension text NOT NULL,
  payload jsonb,
  event text,
  private boolean DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(),
  inserted_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (id, inserted_at)
);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('realtime.topic', true), '')::text
$$;
GRANT USAGE ON SCHEMA realtime TO authenticated;
GRANT SELECT, INSERT ON realtime.messages TO authenticated;
GRANT EXECUTE ON FUNCTION realtime.topic() TO authenticated;

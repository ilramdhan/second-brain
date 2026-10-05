DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'projects', 'project_members', 'project_invites',
    'tasks', 'task_comments', 'task_dependencies', 'milestones',
    'notes', 'inbox_items', 'automations', 'calendar_connections',
    'canvas_boards', 'canvas_nodes', 'canvas_edges', 'time_entries'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I_changes ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER audit_%I_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', table_name, table_name);
  END LOOP;
END
$$;
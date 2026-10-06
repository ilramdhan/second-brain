export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
          source: string;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
          source?: string;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
          source?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      app_config: {
        Row: {
          key: string;
          value: string;
        };
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      app_user_connections: {
        Row: {
          connection_key_ciphertext: string;
          connector_id: string;
          created_at: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connection_key_ciphertext: string;
          connector_id: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connection_key_ciphertext?: string;
          connector_id?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      automation_runs: {
        Row: {
          automation_id: string | null;
          created_at: string;
          detail: string | null;
          id: string;
          ok: boolean;
          task_id: string | null;
          user_id: string;
        };
        Insert: {
          automation_id?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          ok?: boolean;
          task_id?: string | null;
          user_id: string;
        };
        Update: {
          automation_id?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          ok?: boolean;
          task_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
        ];
      };
      automations: {
        Row: {
          actions: Json;
          conditions: Json;
          created_at: string;
          enabled: boolean;
          id: string;
          last_run_at: string | null;
          name: string;
          run_count: number;
          trigger: Json;
          user_id: string;
        };
        Insert: {
          actions?: Json;
          conditions?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name: string;
          run_count?: number;
          trigger?: Json;
          user_id: string;
        };
        Update: {
          actions?: Json;
          conditions?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          last_run_at?: string | null;
          name?: string;
          run_count?: number;
          trigger?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      calendar_connections: {
        Row: {
          calendar_id: string;
          created_at: string;
          id: string;
          last_synced_at: string | null;
          reconnect_required: boolean;
          sync_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          calendar_id?: string;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          reconnect_required?: boolean;
          sync_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          calendar_id?: string;
          created_at?: string;
          id?: string;
          last_synced_at?: string | null;
          reconnect_required?: boolean;
          sync_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      canvas_boards: {
        Row: {
          created_at: string;
          id: string;
          project_id: string | null;
          title: string;
          updated_at: string;
          user_id: string;
          viewport: Json;
        };
        Insert: {
          created_at?: string;
          id?: string;
          project_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id: string;
          viewport?: Json;
        };
        Update: {
          created_at?: string;
          id?: string;
          project_id?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
          viewport?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "canvas_boards_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      canvas_edges: {
        Row: {
          board_id: string;
          created_at: string;
          id: string;
          label: string;
          source_id: string;
          target_id: string;
          user_id: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          id?: string;
          label?: string;
          source_id: string;
          target_id: string;
          user_id: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          id?: string;
          label?: string;
          source_id?: string;
          target_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "canvas_edges_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "canvas_boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "canvas_edges_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "canvas_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "canvas_edges_target_id_fkey";
            columns: ["target_id"];
            isOneToOne: false;
            referencedRelation: "canvas_nodes";
            referencedColumns: ["id"];
          },
        ];
      };
      canvas_nodes: {
        Row: {
          board_id: string;
          color: string;
          content: string;
          created_at: string;
          height: number;
          id: string;
          node_type: string;
          ref_id: string | null;
          ref_type: string | null;
          title: string;
          updated_at: string;
          url: string | null;
          user_id: string;
          width: number;
          x: number;
          y: number;
        };
        Insert: {
          board_id: string;
          color?: string;
          content?: string;
          created_at?: string;
          height?: number;
          id?: string;
          node_type?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          title?: string;
          updated_at?: string;
          url?: string | null;
          user_id: string;
          width?: number;
          x?: number;
          y?: number;
        };
        Update: {
          board_id?: string;
          color?: string;
          content?: string;
          created_at?: string;
          height?: number;
          id?: string;
          node_type?: string;
          ref_id?: string | null;
          ref_type?: string | null;
          title?: string;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
          width?: number;
          x?: number;
          y?: number;
        };
        Relationships: [
          {
            foreignKeyName: "canvas_nodes_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "canvas_boards";
            referencedColumns: ["id"];
          },
        ];
      };
      inbox_items: {
        Row: {
          ai_summary: string | null;
          content: string;
          created_at: string;
          id: string;
          source: string;
          status: string;
          user_id: string;
        };
        Insert: {
          ai_summary?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          source?: string;
          status?: string;
          user_id: string;
        };
        Update: {
          ai_summary?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          source?: string;
          status?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      milestones: {
        Row: {
          created_at: string;
          description: string | null;
          done: boolean;
          due_date: string | null;
          id: string;
          project_id: string;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          project_id: string;
          title: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          done?: boolean;
          due_date?: string | null;
          id?: string;
          project_id?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      n8n_events: {
        Row: {
          created_at: string;
          external_id: string;
          response: Json | null;
          source: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          external_id: string;
          response?: Json | null;
          source: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          external_id?: string;
          response?: Json | null;
          source?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      note_versions: {
        Row: {
          blocks: Json;
          content: string;
          created_at: string;
          id: string;
          note_id: string;
          title: string;
          user_id: string;
          version_number: number;
        };
        Insert: {
          blocks?: Json;
          content?: string;
          created_at?: string;
          id?: string;
          note_id: string;
          title: string;
          user_id: string;
          version_number?: number;
        };
        Update: {
          blocks?: Json;
          content?: string;
          created_at?: string;
          id?: string;
          note_id?: string;
          title?: string;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "note_versions_note_id_fkey";
            columns: ["note_id"];
            isOneToOne: false;
            referencedRelation: "notes";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          archived_at: string | null;
          blocks: Json;
          content: string;
          created_at: string;
          deleted_at: string | null;
          excerpt: string;
          id: string;
          links: string[];
          pinned: boolean;
          position: number;
          project_id: string | null;
          properties: Json;
          refs: string[];
          status: string;
          tags: string[];
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          blocks?: Json;
          content?: string;
          created_at?: string;
          deleted_at?: string | null;
          excerpt?: string;
          id?: string;
          links?: string[];
          pinned?: boolean;
          position?: number;
          project_id?: string | null;
          properties?: Json;
          refs?: string[];
          status?: string;
          tags?: string[];
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          blocks?: Json;
          content?: string;
          created_at?: string;
          deleted_at?: string | null;
          excerpt?: string;
          id?: string;
          links?: string[];
          pinned?: boolean;
          position?: number;
          project_id?: string | null;
          properties?: Json;
          refs?: string[];
          status?: string;
          tags?: string[];
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          telegram_chat_id: string | null;
          telegram_username: string | null;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          telegram_chat_id?: string | null;
          telegram_username?: string | null;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          telegram_chat_id?: string | null;
          telegram_username?: string | null;
        };
        Relationships: [];
      };
      project_invites: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          invited_by: string;
          project_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          invited_by: string;
          project_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          invited_by?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_invites_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          created_at: string;
          id: string;
          project_id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          project_id: string;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          project_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          color: string;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          due_date: string | null;
          id: string;
          launch_date: string | null;
          name: string;
          para_type: string;
          parent_id: string | null;
          position: number;
          start_date: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          launch_date?: string | null;
          name: string;
          para_type?: string;
          parent_id?: string | null;
          position?: number;
          start_date?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          launch_date?: string | null;
          name?: string;
          para_type?: string;
          parent_id?: string | null;
          position?: number;
          start_date?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          bucket: string;
          count: number;
          user_id: string;
          window_start: string;
        };
        Insert: {
          bucket: string;
          count?: number;
          user_id: string;
          window_start?: string;
        };
        Update: {
          bucket?: string;
          count?: number;
          user_id?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      semantic_documents: {
        Row: {
          content_hash: string | null;
          embedding: string | null;
          entity_id: string;
          entity_type: string;
          id: string;
          model: string | null;
          project_id: string | null;
          search_text: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          content_hash?: string | null;
          embedding?: string | null;
          entity_id: string;
          entity_type: string;
          id?: string;
          model?: string | null;
          project_id?: string | null;
          search_text?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          content_hash?: string | null;
          embedding?: string | null;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          model?: string | null;
          project_id?: string | null;
          search_text?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      task_comments: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_dependencies: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_dependencies_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_dependencies_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          archived_at: string | null;
          assignee_id: string | null;
          assignee_name: string | null;
          completed_at: string | null;
          created_at: string;
          deleted_at: string | null;
          description: string | null;
          due_date: string | null;
          estimate_minutes: number;
          google_event_id: string | null;
          id: string;
          milestone_id: string | null;
          parent_id: string | null;
          position: number;
          priority: string;
          project_id: string | null;
          recurrence: string | null;
          reminded: boolean;
          start_date: string | null;
          status: string;
          tags: string[];
          time_block_end: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          assignee_id?: string | null;
          assignee_name?: string | null;
          completed_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          estimate_minutes?: number;
          google_event_id?: string | null;
          id?: string;
          milestone_id?: string | null;
          parent_id?: string | null;
          position?: number;
          priority?: string;
          project_id?: string | null;
          recurrence?: string | null;
          reminded?: boolean;
          start_date?: string | null;
          status?: string;
          tags?: string[];
          time_block_end?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          archived_at?: string | null;
          assignee_id?: string | null;
          assignee_name?: string | null;
          completed_at?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          description?: string | null;
          due_date?: string | null;
          estimate_minutes?: number;
          google_event_id?: string | null;
          id?: string;
          milestone_id?: string | null;
          parent_id?: string | null;
          position?: number;
          priority?: string;
          project_id?: string | null;
          recurrence?: string | null;
          reminded?: boolean;
          start_date?: string | null;
          status?: string;
          tags?: string[];
          time_block_end?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_milestone_id_fkey";
            columns: ["milestone_id"];
            isOneToOne: false;
            referencedRelation: "milestones";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      telegram_link_codes: {
        Row: {
          code_hash: string;
          created_at: string;
          expires_at: string;
          id: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          code_hash: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          code_hash?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      templates: {
        Row: {
          created_at: string;
          id: string;
          kind: string;
          name: string;
          payload: Json;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: string;
          name: string;
          payload?: Json;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          payload?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      time_entries: {
        Row: {
          created_at: string;
          duration_seconds: number;
          ended_at: string | null;
          id: string;
          mode: string;
          project_id: string | null;
          started_at: string;
          task_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          duration_seconds?: number;
          ended_at?: string | null;
          id?: string;
          mode?: string;
          project_id?: string | null;
          started_at: string;
          task_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          duration_seconds?: number;
          ended_at?: string | null;
          id?: string;
          mode?: string;
          project_id?: string | null;
          started_at?: string;
          task_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_project_invites: { Args: never; Returns: number };
      can_access_canvas_board: { Args: { _board_id: string }; Returns: boolean };
      can_access_note: { Args: { _note_id: string }; Returns: boolean };
      can_access_task: {
        Args: { _task_id: string; _user_id: string };
        Returns: boolean;
      };
      complete_task: {
        Args: { _task_id: string; _tz?: string; _user_id?: string };
        Returns: Json;
      };
      consume_rate_limit: {
        Args: { _bucket: string; _max: number; _window_seconds: number };
        Returns: boolean;
      };
      consume_rate_limit_for: {
        Args: { _bucket: string; _max: number; _user_id: string; _window_seconds: number };
        Returns: boolean;
      };
      demo_enforced: { Args: never; Returns: boolean };
      demo_int_setting: {
        Args: { _default: number; _key: string; _max: number; _min: number };
        Returns: number;
      };
      demo_mode_enabled: { Args: never; Returns: boolean };
      demo_setting: { Args: { _default?: string; _key: string }; Returns: string };
      is_canvas_board_owner: { Args: { _board_id: string }; Returns: boolean };
      is_project_member: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      is_project_owner: {
        Args: { _project_id: string; _user_id: string };
        Returns: boolean;
      };
      list_project_people: {
        Args: { _project_id: string };
        Returns: {
          display_name: string;
          email: string;
          role: string;
          user_id: string;
        }[];
      };
      log_activity: {
        Args: {
          _action: string;
          _entity_id?: string;
          _entity_type: string;
          _metadata?: Json;
          _source?: string;
        };
        Returns: string;
      };
      match_semantic_documents: {
        Args: {
          _limit?: number;
          _min_similarity?: number;
          _model: string;
          _query_embedding: string;
        };
        Returns: {
          entity_id: string;
          entity_type: string;
          project_id: string | null;
          similarity: number;
          snippet: string;
          title: string;
        }[];
      };
      my_project_ids: { Args: never; Returns: string[] };
      n8n_user_id_by_email: { Args: { _email: string }; Returns: string };
      note_backlinks: {
        Args: { _block_ids: string[]; _note_id: string; _title: string };
        Returns: {
          blocks: Json | null;
          content: string | null;
          id: string;
          linked: boolean;
          title: string;
        }[];
      };
      note_collab_topic_note_id: { Args: { _topic: string }; Returns: string };
      semantic_note_text: {
        Args: { _content: string; _tags: string[]; _title: string };
        Returns: string;
      };
      semantic_pending: {
        Args: { _limit?: number; _model: string; _user_id?: string };
        Returns: {
          body: string;
          content_hash: string;
          entity_id: string;
          entity_type: string;
          user_id: string;
        }[];
      };
      semantic_task_text: {
        Args: { _description: string; _tags: string[]; _title: string };
        Returns: string;
      };
      semantic_upsert: { Args: { _docs: Json; _model: string }; Returns: number };
      shift_task_dependents: {
        Args: { _delta_ms: number; _task_id: string; _user_id?: string };
        Returns: {
          due_date: string;
          id: string;
          start_date: string;
          updated_at: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

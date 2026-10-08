export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          admin_identity: string
          admin_user_id: string | null
          created_at: string
          id: string
          metadata: Json
          reason: string
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          admin_identity?: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          admin_identity?: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_identities: {
        Row: {
          color: string
          created_at: string
          display_name: string
          emoji: string
          id: string
          legacy_ghost_id: string | null
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          display_name: string
          emoji?: string
          id?: string
          legacy_ghost_id?: string | null
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          display_name?: string
          emoji?: string
          id?: string
          legacy_ghost_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bookmarks: {
        Row: {
          created_at: string
          post_public_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_public_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_public_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
          {
            foreignKeyName: "bookmarks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          actor_id: string | null
          author_emoji: string
          author_name: string
          body: string
          created_at: string
          id: string
          owner_user_id: string | null
          post_public_id: string
          public_id: string
          status: Database["public"]["Enums"]["post_moderation_status"]
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          author_emoji?: string
          author_name?: string
          body: string
          created_at?: string
          id?: string
          owner_user_id?: string | null
          post_public_id: string
          public_id?: string
          status?: Database["public"]["Enums"]["post_moderation_status"]
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          author_emoji?: string
          author_name?: string
          body?: string
          created_at?: string
          id?: string
          owner_user_id?: string | null
          post_public_id?: string
          public_id?: string
          status?: Database["public"]["Enums"]["post_moderation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
        ]
      }
      crush_reactions: {
        Row: {
          actor_id: string
          created_at: string
          crush_public_id: string
          kind: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          crush_public_id: string
          kind: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          crush_public_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "crush_reactions_crush_public_id_fkey"
            columns: ["crush_public_id"]
            isOneToOne: false
            referencedRelation: "crushes"
            referencedColumns: ["public_id"]
          },
        ]
      }
      crushes: {
        Row: {
          author_color: string
          author_emoji: string
          author_name: string
          blushes_count: number
          created_at: string
          expires_at: string
          id: string
          identity_id: string | null
          location: string | null
          message: string | null
          owner_user_id: string | null
          public_id: string
          recipient: string
          ships_count: number
        }
        Insert: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          blushes_count?: number
          created_at?: string
          expires_at?: string
          id?: string
          identity_id?: string | null
          location?: string | null
          message?: string | null
          owner_user_id?: string | null
          public_id?: string
          recipient: string
          ships_count?: number
        }
        Update: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          blushes_count?: number
          created_at?: string
          expires_at?: string
          id?: string
          identity_id?: string | null
          location?: string | null
          message?: string | null
          owner_user_id?: string | null
          public_id?: string
          recipient?: string
          ships_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "crushes_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "anonymous_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crushes_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_post_usage: {
        Row: {
          post_count: number
          updated_at: string
          usage_day: string
          user_id: string
        }
        Insert: {
          post_count?: number
          updated_at?: string
          usage_day: string
          user_id: string
        }
        Update: {
          post_count?: number
          updated_at?: string
          usage_day?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_post_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_codes: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          code_digest: string
          created_at: string
          created_by: string | null
          digest_algorithm: string
          id: string
          status: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          code_digest: string
          created_at?: string
          created_by?: string | null
          digest_algorithm?: string
          id?: string
          status?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          code_digest?: string
          created_at?: string
          created_by?: string | null
          digest_algorithm?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_codes_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      likes: {
        Row: {
          actor_key: string
          created_at: string
          post_public_id: string
          user_id: string | null
        }
        Insert: {
          actor_key: string
          created_at?: string
          post_public_id: string
          user_id?: string | null
        }
        Update: {
          actor_key?: string
          created_at?: string
          post_public_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "likes_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
        ]
      }
      media: {
        Row: {
          created_at: string
          file_size_bytes: number
          height: number | null
          id: string
          mime_type: string
          owner_user_id: string
          post_public_id: string | null
          public_id: string
          storage_path: string
          width: number | null
        }
        Insert: {
          created_at?: string
          file_size_bytes: number
          height?: number | null
          id?: string
          mime_type: string
          owner_user_id: string
          post_public_id?: string | null
          public_id?: string
          storage_path: string
          width?: number | null
        }
        Update: {
          created_at?: string
          file_size_bytes?: number
          height?: number | null
          id?: string
          mime_type?: string
          owner_user_id?: string
          post_public_id?: string | null
          public_id?: string
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          account_id: string | null
          action: string
          admin_user_id: string | null
          created_at: string
          id: string
          post_public_id: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          post_public_id?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          admin_user_id?: string | null
          created_at?: string
          id?: string
          post_public_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_actions_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
        ]
      }
      poll_options: {
        Row: {
          color: string | null
          emoji: string | null
          id: string
          label: string
          poll_public_id: string
          position: number
          vote_count: number
        }
        Insert: {
          color?: string | null
          emoji?: string | null
          id?: string
          label: string
          poll_public_id: string
          position: number
          vote_count?: number
        }
        Update: {
          color?: string | null
          emoji?: string | null
          id?: string
          label?: string
          poll_public_id?: string
          position?: number
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_poll_public_id_fkey"
            columns: ["poll_public_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["public_id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          actor_id: string | null
          actor_key: string
          created_at: string
          option_id: string
          poll_public_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_key: string
          created_at?: string
          option_id: string
          poll_public_id: string
        }
        Update: {
          actor_id?: string | null
          actor_key?: string
          created_at?: string
          option_id?: string
          poll_public_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_option_id_poll_public_id_fkey"
            columns: ["option_id", "poll_public_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id", "poll_public_id"]
          },
          {
            foreignKeyName: "poll_votes_poll_public_id_fkey"
            columns: ["poll_public_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["public_id"]
          },
        ]
      }
      polls: {
        Row: {
          author_color: string
          author_emoji: string
          author_name: string
          created_at: string
          expires_at: string
          id: string
          identity_id: string | null
          owner_user_id: string | null
          public_id: string
          question: string
          status: Database["public"]["Enums"]["poll_status"]
          tag: string
          total_votes: number
          updated_at: string
        }
        Insert: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          created_at?: string
          expires_at?: string
          id?: string
          identity_id?: string | null
          owner_user_id?: string | null
          public_id?: string
          question: string
          status?: Database["public"]["Enums"]["poll_status"]
          tag?: string
          total_votes?: number
          updated_at?: string
        }
        Update: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          created_at?: string
          expires_at?: string
          id?: string
          identity_id?: string | null
          owner_user_id?: string | null
          public_id?: string
          question?: string
          status?: Database["public"]["Enums"]["poll_status"]
          tag?: string
          total_votes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polls_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "anonymous_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polls_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_color: string
          author_emoji: string
          author_name: string
          body: string
          branch: string | null
          category: Database["public"]["Enums"]["post_category"]
          comments_count: number
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          expires_at: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          identity_id: string | null
          likes_count: number
          location: string | null
          owner_user_id: string | null
          public_id: string
          reports_count: number
          status: Database["public"]["Enums"]["post_moderation_status"]
          updated_at: string
        }
        Insert: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          body: string
          branch?: string | null
          category: Database["public"]["Enums"]["post_category"]
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          expires_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          identity_id?: string | null
          likes_count?: number
          location?: string | null
          owner_user_id?: string | null
          public_id?: string
          reports_count?: number
          status?: Database["public"]["Enums"]["post_moderation_status"]
          updated_at?: string
        }
        Update: {
          author_color?: string
          author_emoji?: string
          author_name?: string
          body?: string
          branch?: string | null
          category?: Database["public"]["Enums"]["post_category"]
          comments_count?: number
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          expires_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          identity_id?: string | null
          likes_count?: number
          location?: string | null
          owner_user_id?: string | null
          public_id?: string
          reports_count?: number
          status?: Database["public"]["Enums"]["post_moderation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "anonymous_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          moderation_reason: string | null
          moderation_status: Database["public"]["Enums"]["account_moderation_status"]
          role: Database["public"]["Enums"]["account_role"]
          suspended_at: string | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          moderation_reason?: string | null
          moderation_status?: Database["public"]["Enums"]["account_moderation_status"]
          role?: Database["public"]["Enums"]["account_role"]
          suspended_at?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          moderation_reason?: string | null
          moderation_status?: Database["public"]["Enums"]["account_moderation_status"]
          role?: Database["public"]["Enums"]["account_role"]
          suspended_at?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          comment_id: string | null
          created_at: string
          detail: string | null
          id: string
          moderation_action: string | null
          post_public_id: string | null
          reason: string
          reported_user_id: string | null
          reporter_auth_id: string | null
          reporter_user_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["report_status"]
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at: string
        }
        Insert: {
          comment_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          moderation_action?: string | null
          post_public_id?: string | null
          reason: string
          reported_user_id?: string | null
          reporter_auth_id?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_type: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Update: {
          comment_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          moderation_action?: string | null
          post_public_id?: string | null
          reason?: string
          reported_user_id?: string | null
          reporter_auth_id?: string | null
          reporter_user_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          target_type?: Database["public"]["Enums"]["report_target_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_post_public_id_fkey"
            columns: ["post_public_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["public_id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_read_comment: {
        Args: { p_comment_public_id: string }
        Returns: boolean
      }
      can_read_media: { Args: { object_path: string }; Returns: boolean }
      can_read_post: { Args: { p_public_id: string }; Returns: boolean }
      claim_invited_account: {
        Args: {
          p_code_digest: string
          p_color: string
          p_display_name: string
          p_emoji: string
          p_ghost_id: string
          p_user_id: string
          p_username: string
        }
        Returns: {
          color: string
          display_name: string
          emoji: string
          ghost_id: string
          username: string
        }[]
      }
      create_comment: {
        Args: { p_body: string; p_post_public_id: string }
        Returns: {
          author_emoji: string
          author_name: string
          body: string
          created_at: string
          post_public_id: string
          public_id: string
        }[]
      }
      create_crush: {
        Args: { p_location: string; p_message: string; p_recipient: string }
        Returns: {
          public_id: string
          usage_count: number
        }[]
      }
      create_poll: {
        Args: { p_options: Json; p_question: string; p_tag: string }
        Returns: {
          public_id: string
          usage_count: number
        }[]
      }
      create_post: {
        Args: {
          p_body: string
          p_branch?: string
          p_category: Database["public"]["Enums"]["post_category"]
          p_location?: string
          p_media_public_id?: string
        }
        Returns: {
          public_id: string
          usage_count: number
        }[]
      }
      delete_comment: {
        Args: { p_comment_public_id: string }
        Returns: boolean
      }
      delete_expired_content: { Args: never; Returns: number }
      delete_own_post: { Args: { p_post_public_id: string }; Returns: boolean }
      ensure_anonymous_identity: {
        Args: never
        Returns: {
          color: string
          display_name: string
          emoji: string
          ghost_id: string
        }[]
      }
      feed_comments_page: {
        Args: {
          p_before_created_at?: string
          p_limit?: number
          p_post_public_id: string
        }
        Returns: {
          author_emoji: string
          author_name: string
          body: string
          created_at: string
          mine: boolean
          public_id: string
        }[]
      }
      feed_polls_page: {
        Args: { p_limit?: number }
        Returns: {
          author_color: string
          author_emoji: string
          author_name: string
          created_at: string
          expires_at: string
          my_option_id: string
          options: Json
          public_id: string
          question: string
          tag: string
          total_votes: number
        }[]
      }
      feed_posts_page: {
        Args: {
          p_before_created_at?: string
          p_before_public_id?: string
          p_category?: Database["public"]["Enums"]["post_category"]
          p_limit?: number
        }
        Returns: {
          author_color: string
          author_emoji: string
          author_name: string
          body: string
          branch: string
          category: Database["public"]["Enums"]["post_category"]
          comments_count: number
          created_at: string
          image_height: number
          image_width: number
          likes_count: number
          location: string
          mime_type: string
          public_id: string
          storage_path: string
          viewer_bookmarked: boolean
          viewer_liked: boolean
          viewer_owned: boolean
        }[]
      }
      feed_pulse_stats: {
        Args: never
        Returns: {
          confessions: number
          memes: number
          rants: number
          secrets_today: number
          spotted: number
          total_secrets: number
        }[]
      }
      get_my_profile: {
        Args: never
        Returns: {
          color: string
          display_name: string
          emoji: string
          ghost_id: string
          moderation_status: Database["public"]["Enums"]["account_moderation_status"]
          role: Database["public"]["Enums"]["account_role"]
          username: string
        }[]
      }
      get_post_usage: {
        Args: never
        Returns: {
          daily_limit: number
          remaining: number
          usage_day: string
          used: number
        }[]
      }
      has_liked_post: { Args: { p_post_public_id: string }; Returns: boolean }
      increment_crush_reaction: {
        Args: { p_crush_public_id: string; p_kind: string }
        Returns: {
          blushes: number
          ships: number
        }[]
      }
      is_active_member: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_public_poll: { Args: { p_public_id: string }; Returns: boolean }
      is_public_post: { Args: { p_public_id: string }; Returns: boolean }
      is_valid_voter: { Args: never; Returns: boolean }
      my_poll_vote: { Args: { p_poll_public_id: string }; Returns: string }
      owns_uploaded_media_object: {
        Args: { object_path: string }
        Returns: boolean
      }
      set_poll_vote: {
        Args: { p_option_id: string; p_poll_public_id: string }
        Returns: {
          selected_option_id: string
          total_votes: number
        }[]
      }
      set_post_like: {
        Args: { p_liked: boolean; p_post_public_id: string }
        Returns: {
          liked: boolean
          likes_count: number
        }[]
      }
      submit_report: {
        Args: {
          p_comment_public_id: string
          p_detail?: string
          p_post_public_id: string
          p_reason: string
          p_target_type: Database["public"]["Enums"]["report_target_type"]
        }
        Returns: string
      }
      take_auth_attempt: {
        Args: { p_attempt_key: string; p_max_attempts?: number }
        Returns: boolean
      }
    }
    Enums: {
      account_moderation_status: "ACTIVE" | "SUSPENDED" | "BANNED"
      account_role: "USER" | "ADMIN"
      poll_status: "published" | "hidden" | "removed"
      post_category:
        | "Confessions"
        | "Memes"
        | "Rants"
        | "Spotted"
      post_moderation_status:
        | "pending"
        | "approved"
        | "hidden"
        | "removed"
        | "deleted"
      report_status: "open" | "resolved" | "dismissed"
      report_target_type: "post" | "comment" | "account"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_moderation_status: ["ACTIVE", "SUSPENDED", "BANNED"],
      account_role: ["USER", "ADMIN"],
      poll_status: ["published", "hidden", "removed"],
      post_category: ["Confessions", "Memes", "Rants", "Spotted"],
      post_moderation_status: [
        "pending",
        "approved",
        "hidden",
        "removed",
        "deleted",
      ],
      report_status: ["open", "resolved", "dismissed"],
      report_target_type: ["post", "comment", "account"],
    },
  },
} as const

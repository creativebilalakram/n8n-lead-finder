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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      leads: {
        Row: {
          address: string | null
          apify_run_id: string | null
          brand_dna_analyzed_at: string | null
          brand_dna_label: string | null
          brand_dna_raw: Json | null
          brand_dna_score: number | null
          brand_dna_screenshot_url: string | null
          brand_dna_summary: string | null
          category: string | null
          city: string | null
          country_code: string | null
          created_at: string
          email: string | null
          emails: Json | null
          id: string
          instagram_analysis: string | null
          instagram_analyzed_at: string | null
          instagram_bio: string | null
          instagram_followers: number | null
          instagram_following: number | null
          instagram_full_name: string | null
          instagram_is_business: boolean | null
          instagram_label: string | null
          instagram_posts_count: number | null
          instagram_profile_pic_url: string | null
          instagram_raw: Json | null
          instagram_score: number | null
          instagram_url: string | null
          instagram_username: string | null
          instagram_verified: boolean | null
          lead_score: number | null
          lead_tier: string | null
          lovable_url: string | null
          opened_at: string | null
          owner_update_age_days: number | null
          passed: boolean
          phone: string | null
          phones: Json | null
          place_id: string | null
          rating: number | null
          raw: Json | null
          red_flags: Json | null
          rejection_reasons: Json | null
          reviews_count: number | null
          search_run_id: string
          title: string | null
          website: string | null
          website_analysis: string | null
          website_analyzed_at: string | null
          website_label: string | null
          website_modern_score: number | null
          website_raw: Json | null
          website_screenshot_url: string | null
        }
        Insert: {
          address?: string | null
          apify_run_id?: string | null
          brand_dna_analyzed_at?: string | null
          brand_dna_label?: string | null
          brand_dna_raw?: Json | null
          brand_dna_score?: number | null
          brand_dna_screenshot_url?: string | null
          brand_dna_summary?: string | null
          category?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          emails?: Json | null
          id?: string
          instagram_analysis?: string | null
          instagram_analyzed_at?: string | null
          instagram_bio?: string | null
          instagram_followers?: number | null
          instagram_following?: number | null
          instagram_full_name?: string | null
          instagram_is_business?: boolean | null
          instagram_label?: string | null
          instagram_posts_count?: number | null
          instagram_profile_pic_url?: string | null
          instagram_raw?: Json | null
          instagram_score?: number | null
          instagram_url?: string | null
          instagram_username?: string | null
          instagram_verified?: boolean | null
          lead_score?: number | null
          lead_tier?: string | null
          lovable_url?: string | null
          opened_at?: string | null
          owner_update_age_days?: number | null
          passed?: boolean
          phone?: string | null
          phones?: Json | null
          place_id?: string | null
          rating?: number | null
          raw?: Json | null
          red_flags?: Json | null
          rejection_reasons?: Json | null
          reviews_count?: number | null
          search_run_id: string
          title?: string | null
          website?: string | null
          website_analysis?: string | null
          website_analyzed_at?: string | null
          website_label?: string | null
          website_modern_score?: number | null
          website_raw?: Json | null
          website_screenshot_url?: string | null
        }
        Update: {
          address?: string | null
          apify_run_id?: string | null
          brand_dna_analyzed_at?: string | null
          brand_dna_label?: string | null
          brand_dna_raw?: Json | null
          brand_dna_score?: number | null
          brand_dna_screenshot_url?: string | null
          brand_dna_summary?: string | null
          category?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          emails?: Json | null
          id?: string
          instagram_analysis?: string | null
          instagram_analyzed_at?: string | null
          instagram_bio?: string | null
          instagram_followers?: number | null
          instagram_following?: number | null
          instagram_full_name?: string | null
          instagram_is_business?: boolean | null
          instagram_label?: string | null
          instagram_posts_count?: number | null
          instagram_profile_pic_url?: string | null
          instagram_raw?: Json | null
          instagram_score?: number | null
          instagram_url?: string | null
          instagram_username?: string | null
          instagram_verified?: boolean | null
          lead_score?: number | null
          lead_tier?: string | null
          lovable_url?: string | null
          opened_at?: string | null
          owner_update_age_days?: number | null
          passed?: boolean
          phone?: string | null
          phones?: Json | null
          place_id?: string | null
          rating?: number | null
          raw?: Json | null
          red_flags?: Json | null
          rejection_reasons?: Json | null
          reviews_count?: number | null
          search_run_id?: string
          title?: string | null
          website?: string | null
          website_analysis?: string | null
          website_analyzed_at?: string | null
          website_label?: string | null
          website_modern_score?: number | null
          website_raw?: Json | null
          website_screenshot_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_search_run_id_fkey"
            columns: ["search_run_id"]
            isOneToOne: false
            referencedRelation: "search_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      search_runs: {
        Row: {
          apify_finished_at: string | null
          apify_run_id: string | null
          apify_started_at: string | null
          created_at: string
          filtered_count: number
          id: string
          params: Json
          qualified_count: number
          source: string
          total_count: number
        }
        Insert: {
          apify_finished_at?: string | null
          apify_run_id?: string | null
          apify_started_at?: string | null
          created_at?: string
          filtered_count?: number
          id?: string
          params?: Json
          qualified_count?: number
          source?: string
          total_count?: number
        }
        Update: {
          apify_finished_at?: string | null
          apify_run_id?: string | null
          apify_started_at?: string | null
          created_at?: string
          filtered_count?: number
          id?: string
          params?: Json
          qualified_count?: number
          source?: string
          total_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

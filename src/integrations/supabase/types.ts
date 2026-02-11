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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      cmo_reports: {
        Row: {
          accuracy_score: number | null
          cmo_name: string
          created_at: string
          error_count: number | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          notes: string | null
          page_count: number | null
          processed_at: string | null
          report_period: string | null
          status: string
          total_revenue: number | null
          transaction_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accuracy_score?: number | null
          cmo_name: string
          created_at?: string
          error_count?: number | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          notes?: string | null
          page_count?: number | null
          processed_at?: string | null
          report_period?: string | null
          status?: string
          total_revenue?: number | null
          transaction_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accuracy_score?: number | null
          cmo_name?: string
          created_at?: string
          error_count?: number | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          notes?: string | null
          page_count?: number | null
          processed_at?: string | null
          report_period?: string | null
          status?: string
          total_revenue?: number | null
          transaction_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_ai_report_items: {
        Row: {
          amount_in_original_currency: string | null
          amount_in_reporting_currency: string | null
          channel: string | null
          config_type: string | null
          country: string | null
          created_at: string
          exchange_rate: string | null
          id: string
          isrc: string | null
          item_index: number
          label: string | null
          master_commission: string | null
          ocr_confidence: number | null
          original_currency: string | null
          quantity: string | null
          raw_entity: Json | null
          release_artist: string | null
          release_title: string | null
          release_upc: string | null
          report_date: string | null
          report_id: string
          report_item: string | null
          reporting_currency: string | null
          royalty_revenue: string | null
          sales_end: string | null
          sales_start: string | null
          source_page: number | null
          track_artist: string | null
          track_title: string | null
          unit: string | null
          user_id: string
        }
        Insert: {
          amount_in_original_currency?: string | null
          amount_in_reporting_currency?: string | null
          channel?: string | null
          config_type?: string | null
          country?: string | null
          created_at?: string
          exchange_rate?: string | null
          id?: string
          isrc?: string | null
          item_index: number
          label?: string | null
          master_commission?: string | null
          ocr_confidence?: number | null
          original_currency?: string | null
          quantity?: string | null
          raw_entity?: Json | null
          release_artist?: string | null
          release_title?: string | null
          release_upc?: string | null
          report_date?: string | null
          report_id: string
          report_item?: string | null
          reporting_currency?: string | null
          royalty_revenue?: string | null
          sales_end?: string | null
          sales_start?: string | null
          source_page?: number | null
          track_artist?: string | null
          track_title?: string | null
          unit?: string | null
          user_id: string
        }
        Update: {
          amount_in_original_currency?: string | null
          amount_in_reporting_currency?: string | null
          channel?: string | null
          config_type?: string | null
          country?: string | null
          created_at?: string
          exchange_rate?: string | null
          id?: string
          isrc?: string | null
          item_index?: number
          label?: string | null
          master_commission?: string | null
          ocr_confidence?: number | null
          original_currency?: string | null
          quantity?: string | null
          raw_entity?: Json | null
          release_artist?: string | null
          release_title?: string | null
          release_upc?: string | null
          report_date?: string | null
          report_id?: string
          report_item?: string | null
          reporting_currency?: string | null
          royalty_revenue?: string | null
          sales_end?: string | null
          sales_start?: string | null
          source_page?: number | null
          track_artist?: string | null
          track_title?: string | null
          unit?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_ai_report_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cmo_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      royalty_transactions: {
        Row: {
          artist_name: string | null
          bbox_height: number | null
          bbox_width: number | null
          bbox_x: number | null
          bbox_y: number | null
          commission: number | null
          created_at: string
          currency: string | null
          gross_revenue: number | null
          id: string
          isrc: string | null
          iswc: string | null
          net_revenue: number | null
          ocr_confidence: number | null
          period_end: string | null
          period_start: string | null
          platform: string | null
          quantity: number | null
          raw_data: Json | null
          report_id: string
          source_page: number | null
          source_row: number | null
          territory: string | null
          track_title: string | null
          usage_type: string | null
          user_id: string
          validation_status: string | null
        }
        Insert: {
          artist_name?: string | null
          bbox_height?: number | null
          bbox_width?: number | null
          bbox_x?: number | null
          bbox_y?: number | null
          commission?: number | null
          created_at?: string
          currency?: string | null
          gross_revenue?: number | null
          id?: string
          isrc?: string | null
          iswc?: string | null
          net_revenue?: number | null
          ocr_confidence?: number | null
          period_end?: string | null
          period_start?: string | null
          platform?: string | null
          quantity?: number | null
          raw_data?: Json | null
          report_id: string
          source_page?: number | null
          source_row?: number | null
          territory?: string | null
          track_title?: string | null
          usage_type?: string | null
          user_id: string
          validation_status?: string | null
        }
        Update: {
          artist_name?: string | null
          bbox_height?: number | null
          bbox_width?: number | null
          bbox_x?: number | null
          bbox_y?: number | null
          commission?: number | null
          created_at?: string
          currency?: string | null
          gross_revenue?: number | null
          id?: string
          isrc?: string | null
          iswc?: string | null
          net_revenue?: number | null
          ocr_confidence?: number | null
          period_end?: string | null
          period_start?: string | null
          platform?: string | null
          quantity?: number | null
          raw_data?: Json | null
          report_id?: string
          source_page?: number | null
          source_row?: number | null
          territory?: string | null
          track_title?: string | null
          usage_type?: string | null
          user_id?: string
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "royalty_transactions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cmo_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_errors: {
        Row: {
          actual_value: string | null
          created_at: string
          error_type: string
          expected_value: string | null
          field_name: string | null
          id: string
          message: string
          report_id: string
          resolved: boolean | null
          severity: string
          source_page: number | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          actual_value?: string | null
          created_at?: string
          error_type: string
          expected_value?: string | null
          field_name?: string | null
          id?: string
          message: string
          report_id: string
          resolved?: boolean | null
          severity?: string
          source_page?: number | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          actual_value?: string | null
          created_at?: string
          error_type?: string
          expected_value?: string | null
          field_name?: string | null
          id?: string
          message?: string
          report_id?: string
          resolved?: boolean | null
          severity?: string
          source_page?: number | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_errors_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "cmo_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_errors_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "royalty_transactions"
            referencedColumns: ["id"]
          },
        ]
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

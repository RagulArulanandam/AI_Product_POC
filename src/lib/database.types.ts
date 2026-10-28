
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "business_products": {
                  Row: {
                    "business_id": string,"config": NonNullable<Json>,"created_at": string,"enabled": boolean,"id": string,"product_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"config"?: NonNullable<Json>,"created_at"?: string,"enabled"?: boolean,"id"?: string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"config"?: NonNullable<Json>,"created_at"?: string,"enabled"?: boolean,"id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_products_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "business_products_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "business_hours": NonNullable<Json>,"created_at": string,"id": string,"name": string,"phone_e164": string,"status": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_hours"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name": string,"phone_e164": string,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_hours"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name"?: string,"phone_e164"?: string,"status"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"integration_secrets": {
                  Row: {
                    "business_id": string,"ciphertext": string,"created_at": string,"id": string,"integration_id": string,"key_version": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"ciphertext": string,"created_at"?: string,"id"?: string,"integration_id": string,"key_version"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"ciphertext"?: string,"created_at"?: string,"id"?: string,"integration_id"?: string,"key_version"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_secrets_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "integration_secrets_integration_id_fkey"
      columns: ["integration_id"]
isOneToOne: true
      referencedRelation: "integrations"
      referencedColumns: ["id"]
    }
                  ]
                },"integrations": {
                  Row: {
                    "account_label": string | null,"business_id": string,"created_at": string,"id": string,"last_error": string | null,"metadata": NonNullable<Json>,"provider": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_label"?: string | null,"business_id": string,"created_at"?: string,"id"?: string,"last_error"?: string | null,"metadata"?: NonNullable<Json>,"provider": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "account_label"?: string | null,"business_id"?: string,"created_at"?: string,"id"?: string,"last_error"?: string | null,"metadata"?: NonNullable<Json>,"provider"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "integrations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"role": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"role": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"role"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"products": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"key": string,"name": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string,"id"?: string,"key": string,"name": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"key"?: string,"name"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"subscriptions": {
                  Row: {
                    "business_id": string,"created_at": string,"current_period_end": string | null,"id": string,"notes": string,"plan": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string,"plan"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"current_period_end"?: string | null,"id"?: string,"notes"?: string,"plan"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: true
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "can_enable_product":
{ Args: { "b": string,"p": string }; Returns: boolean
                           },
"can_write":
{ Args: { "b": string }; Returns: boolean
                           },
"create_business":
{ Args: { "p_name": string,"p_phone": string,"p_timezone": string }; Returns: string
                           },
"is_member":
{ Args: { "b": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const


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
            "automation_logs": {
                  Row: {
                    "business_id": string,"conversation_id": string | null,"created_at": string,"details": NonNullable<Json>,"event_type": string,"id": string,"reason": string | null,"scheduled_action_id": string | null,"status": string,"step": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"conversation_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"event_type": string,"id"?: string,"reason"?: string | null,"scheduled_action_id"?: string | null,"status": string,"step": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"conversation_id"?: string | null,"created_at"?: string,"details"?: NonNullable<Json>,"event_type"?: string,"id"?: string,"reason"?: string | null,"scheduled_action_id"?: string | null,"status"?: string,"step"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_logs_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_logs_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_logs_scheduled_action_id_fkey"
      columns: ["scheduled_action_id"]
isOneToOne: false
      referencedRelation: "scheduled_actions"
      referencedColumns: ["id"]
    }
                  ]
                },"business_products": {
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
                },"conversations": {
                  Row: {
                    "booking_end": string | null,"booking_event_id": string | null,"booking_start": string | null,"business_id": string,"created_at": string,"customer_id": string,"escalated_at": string | null,"escalation_reason": string | null,"expires_at": string | null,"id": string,"last_inbound_at": string | null,"last_intent": string | null,"last_outbound_at": string | null,"offered_slots": NonNullable<Json>,"product_id": string,"started_at": string,"state": string,"trigger_call_sid": string | null,"turn_count": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_end"?: string | null,"booking_event_id"?: string | null,"booking_start"?: string | null,"business_id": string,"created_at"?: string,"customer_id": string,"escalated_at"?: string | null,"escalation_reason"?: string | null,"expires_at"?: string | null,"id"?: string,"last_inbound_at"?: string | null,"last_intent"?: string | null,"last_outbound_at"?: string | null,"offered_slots"?: NonNullable<Json>,"product_id": string,"started_at"?: string,"state"?: string,"trigger_call_sid"?: string | null,"turn_count"?: number,"updated_at"?: string
                  }
                  Update: {
                    "booking_end"?: string | null,"booking_event_id"?: string | null,"booking_start"?: string | null,"business_id"?: string,"created_at"?: string,"customer_id"?: string,"escalated_at"?: string | null,"escalation_reason"?: string | null,"expires_at"?: string | null,"id"?: string,"last_inbound_at"?: string | null,"last_intent"?: string | null,"last_outbound_at"?: string | null,"offered_slots"?: NonNullable<Json>,"product_id"?: string,"started_at"?: string,"state"?: string,"trigger_call_sid"?: string | null,"turn_count"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "business_id": string,"created_at": string,"id": string,"last_contacted_at": string | null,"name": string | null,"phone_e164": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"id"?: string,"last_contacted_at"?: string | null,"name"?: string | null,"phone_e164": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"id"?: string,"last_contacted_at"?: string | null,"name"?: string | null,"phone_e164"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
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
                },"messages": {
                  Row: {
                    "body": string,"business_id": string,"confidence": number | null,"conversation_id": string,"created_at": string,"direction": string,"error": string | null,"id": string,"intent": string | null,"provider_sid": string | null,"sender": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"business_id": string,"confidence"?: number | null,"conversation_id": string,"created_at"?: string,"direction": string,"error"?: string | null,"id"?: string,"intent"?: string | null,"provider_sid"?: string | null,"sender": string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"business_id"?: string,"confidence"?: number | null,"conversation_id"?: string,"created_at"?: string,"direction"?: string,"error"?: string | null,"id"?: string,"intent"?: string | null,"provider_sid"?: string | null,"sender"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"opt_outs": {
                  Row: {
                    "created_at": string,"id": string,"opted_out_at": string,"phone_e164": string,"source_business_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"opted_out_at"?: string,"phone_e164": string,"source_business_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"opted_out_at"?: string,"phone_e164"?: string,"source_business_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opt_outs_source_business_id_fkey"
      columns: ["source_business_id"]
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
                },"scheduled_actions": {
                  Row: {
                    "attempts": number,"business_id": string,"conversation_id": string | null,"created_at": string,"dedupe_key": string,"id": string,"last_error": string | null,"locked_at": string | null,"max_attempts": number,"payload": NonNullable<Json>,"run_at": string,"status": string,"type": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"business_id": string,"conversation_id"?: string | null,"created_at"?: string,"dedupe_key": string,"id"?: string,"last_error"?: string | null,"locked_at"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"run_at"?: string,"status"?: string,"type": string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"business_id"?: string,"conversation_id"?: string | null,"created_at"?: string,"dedupe_key"?: string,"id"?: string,"last_error"?: string | null,"locked_at"?: string | null,"max_attempts"?: number,"payload"?: NonNullable<Json>,"run_at"?: string,"status"?: string,"type"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "scheduled_actions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scheduled_actions_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
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
                },"webhook_events": {
                  Row: {
                    "business_id": string | null,"created_at": string,"id": string,"payload": NonNullable<Json>,"processed_at": string | null,"provider": string,"provider_event_id": string,"received_at": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id"?: string | null,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider": string,"provider_event_id": string,"received_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string | null,"created_at"?: string,"id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"provider"?: string,"provider_event_id"?: string,"received_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "webhook_events_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
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
            "call_worker":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"can_enable_product":
{ Args: { "b": string,"p": string }; Returns: boolean
                           },
"can_write":
{ Args: { "b": string }; Returns: boolean
                           },
"claim_due_actions":
{ Args: { "batch"?: number }; Returns: {
              "attempts": number,
"business_id": string,
"conversation_id": string | null,
"created_at": string,
"dedupe_key": string,
"id": string,
"last_error": string | null,
"locked_at": string | null,
"max_attempts": number,
"payload": NonNullable<Json>,
"run_at": string,
"status": string,
"type": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "scheduled_actions"
        isOneToOne: false
        isSetofReturn: true
      } },
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

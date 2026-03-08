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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          organization_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      actos: {
        Row: {
          afectacion_vivienda_familiar: boolean
          apoderado_cedula: string | null
          apoderado_nombre: string | null
          entidad_bancaria: string | null
          es_hipoteca: boolean
          id: string
          tipo_acto: string | null
          tramite_id: string
          valor_compraventa: string | null
          valor_hipoteca: string | null
        }
        Insert: {
          afectacion_vivienda_familiar?: boolean
          apoderado_cedula?: string | null
          apoderado_nombre?: string | null
          entidad_bancaria?: string | null
          es_hipoteca?: boolean
          id?: string
          tipo_acto?: string | null
          tramite_id: string
          valor_compraventa?: string | null
          valor_hipoteca?: string | null
        }
        Update: {
          afectacion_vivienda_familiar?: boolean
          apoderado_cedula?: string | null
          apoderado_nombre?: string | null
          entidad_bancaria?: string | null
          es_hipoteca?: boolean
          id?: string
          tipo_acto?: string | null
          tramite_id?: string
          valor_compraventa?: string | null
          valor_hipoteca?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actos_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      inmuebles: {
        Row: {
          area: string | null
          codigo_orip: string | null
          departamento: string | null
          direccion: string | null
          estrato: string | null
          id: string
          identificador_predial: string | null
          linderos: string | null
          matricula_inmobiliaria: string | null
          municipio: string | null
          tipo_identificador_predial: string | null
          tipo_predio: string | null
          tramite_id: string
          valorizacion: string | null
        }
        Insert: {
          area?: string | null
          codigo_orip?: string | null
          departamento?: string | null
          direccion?: string | null
          estrato?: string | null
          id?: string
          identificador_predial?: string | null
          linderos?: string | null
          matricula_inmobiliaria?: string | null
          municipio?: string | null
          tipo_identificador_predial?: string | null
          tipo_predio?: string | null
          tramite_id: string
          valorizacion?: string | null
        }
        Update: {
          area?: string | null
          codigo_orip?: string | null
          departamento?: string | null
          direccion?: string | null
          estrato?: string | null
          id?: string
          identificador_predial?: string | null
          linderos?: string | null
          matricula_inmobiliaria?: string | null
          municipio?: string | null
          tipo_identificador_predial?: string | null
          tipo_predio?: string | null
          tramite_id?: string
          valorizacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inmuebles_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string
          credit_balance: number
          id: string
          name: string
          nit: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          name: string
          nit?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          credit_balance?: number
          id?: string
          name?: string
          nit?: string | null
        }
        Relationships: []
      }
      personas: {
        Row: {
          direccion: string | null
          es_pep: boolean
          es_persona_juridica: boolean
          estado_civil: string | null
          id: string
          nit: string | null
          nombre_completo: string
          numero_cedula: string | null
          razon_social: string | null
          representante_legal_cedula: string | null
          representante_legal_nombre: string | null
          rol: Database["public"]["Enums"]["persona_rol"]
          tramite_id: string
        }
        Insert: {
          direccion?: string | null
          es_pep?: boolean
          es_persona_juridica?: boolean
          estado_civil?: string | null
          id?: string
          nit?: string | null
          nombre_completo?: string
          numero_cedula?: string | null
          razon_social?: string | null
          representante_legal_cedula?: string | null
          representante_legal_nombre?: string | null
          rol: Database["public"]["Enums"]["persona_rol"]
          tramite_id: string
        }
        Update: {
          direccion?: string | null
          es_pep?: boolean
          es_persona_juridica?: boolean
          estado_civil?: string | null
          id?: string
          nit?: string | null
          nombre_completo?: string
          numero_cedula?: string | null
          razon_social?: string | null
          representante_legal_cedula?: string | null
          representante_legal_nombre?: string | null
          rol?: Database["public"]["Enums"]["persona_rol"]
          tramite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personas_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["org_role"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["org_role"]
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["org_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tramites: {
        Row: {
          created_at: string
          created_by: string
          fecha: string | null
          id: string
          organization_id: string
          radicado: string | null
          status: Database["public"]["Enums"]["tramite_status"]
          tipo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          fecha?: string | null
          id?: string
          organization_id: string
          radicado?: string | null
          status?: Database["public"]["Enums"]["tramite_status"]
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          fecha?: string | null
          id?: string
          organization_id?: string
          radicado?: string | null
          status?: Database["public"]["Enums"]["tramite_status"]
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tramites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_update_credits: {
        Args: { new_balance: number; reason: string; target_org_id: string }
        Returns: undefined
      }
      admin_update_organization: {
        Args: {
          new_address: string
          new_name: string
          new_nit: string
          target_org_id: string
        }
        Returns: undefined
      }
      consume_credit: { Args: { org_id: string }; Returns: boolean }
      get_all_organizations: {
        Args: never
        Returns: {
          address: string
          created_at: string
          credit_balance: number
          id: string
          name: string
          nit: string
        }[]
      }
      get_user_org: { Args: { uid: string }; Returns: string }
      get_user_role: {
        Args: { uid: string }
        Returns: Database["public"]["Enums"]["org_role"]
      }
    }
    Enums: {
      org_role: "owner" | "admin" | "operator"
      persona_rol: "vendedor" | "comprador"
      tramite_status: "pendiente" | "validado" | "word_generado"
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
    Enums: {
      org_role: ["owner", "admin", "operator"],
      persona_rol: ["vendedor", "comprador"],
      tramite_status: ["pendiente", "validado", "word_generado"],
    },
  },
} as const

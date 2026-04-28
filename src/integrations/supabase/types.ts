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
          apoderado_email: string | null
          apoderado_escritura_poder: string | null
          apoderado_expedida_en: string | null
          apoderado_fecha_poder: string | null
          apoderado_nombre: string | null
          apoderado_notaria_ciudad: string | null
          apoderado_notaria_poder: string | null
          entidad_bancaria: string | null
          entidad_domicilio: string | null
          entidad_nit: string | null
          es_hipoteca: boolean
          fecha_credito: string | null
          id: string
          pago_inicial: string | null
          saldo_financiado: string | null
          tipo_acto: string | null
          tramite_id: string
          valor_compraventa: string | null
          valor_hipoteca: string | null
        }
        Insert: {
          afectacion_vivienda_familiar?: boolean
          apoderado_cedula?: string | null
          apoderado_email?: string | null
          apoderado_escritura_poder?: string | null
          apoderado_expedida_en?: string | null
          apoderado_fecha_poder?: string | null
          apoderado_nombre?: string | null
          apoderado_notaria_ciudad?: string | null
          apoderado_notaria_poder?: string | null
          entidad_bancaria?: string | null
          entidad_domicilio?: string | null
          entidad_nit?: string | null
          es_hipoteca?: boolean
          fecha_credito?: string | null
          id?: string
          pago_inicial?: string | null
          saldo_financiado?: string | null
          tipo_acto?: string | null
          tramite_id: string
          valor_compraventa?: string | null
          valor_hipoteca?: string | null
        }
        Update: {
          afectacion_vivienda_familiar?: boolean
          apoderado_cedula?: string | null
          apoderado_email?: string | null
          apoderado_escritura_poder?: string | null
          apoderado_expedida_en?: string | null
          apoderado_fecha_poder?: string | null
          apoderado_nombre?: string | null
          apoderado_notaria_ciudad?: string | null
          apoderado_notaria_poder?: string | null
          entidad_bancaria?: string | null
          entidad_domicilio?: string | null
          entidad_nit?: string | null
          es_hipoteca?: boolean
          fecha_credito?: string | null
          id?: string
          pago_inicial?: string | null
          saldo_financiado?: string | null
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
      config_tramites: {
        Row: {
          campos_obligatorios: Json
          created_at: string | null
          id: string
          tipo_acto: string
        }
        Insert: {
          campos_obligatorios?: Json
          created_at?: string | null
          id?: string
          tipo_acto: string
        }
        Update: {
          campos_obligatorios?: Json
          created_at?: string | null
          id?: string
          tipo_acto?: string
        }
        Relationships: []
      }
      configuracion_notaria: {
        Row: {
          activa: boolean | null
          circulo: string
          created_at: string | null
          decreto_nombramiento: string | null
          departamento: string
          formato_encabezado: string | null
          id: string
          nombre_notario: string | null
          numero_notaria: number
          organization_id: string | null
          reglas_especificas: Json | null
          tipo_notario: string | null
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          circulo: string
          created_at?: string | null
          decreto_nombramiento?: string | null
          departamento: string
          formato_encabezado?: string | null
          id?: string
          nombre_notario?: string | null
          numero_notaria: number
          organization_id?: string | null
          reglas_especificas?: Json | null
          tipo_notario?: string | null
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          circulo?: string
          created_at?: string | null
          decreto_nombramiento?: string | null
          departamento?: string
          formato_encabezado?: string | null
          id?: string
          nombre_notario?: string | null
          numero_notaria?: number
          organization_id?: string | null
          reglas_especificas?: Json | null
          tipo_notario?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_notaria_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_consumption: {
        Row: {
          action: string
          created_at: string
          credits: number
          id: string
          organization_id: string
          tipo_acto: string | null
          tramite_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          credits?: number
          id?: string
          organization_id: string
          tipo_acto?: string | null
          tramite_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          credits?: number
          id?: string
          organization_id?: string
          tipo_acto?: string | null
          tramite_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_consumption_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      historial_validaciones: {
        Row: {
          correcciones_aplicadas: Json | null
          costo_estimado_usd: number | null
          created_at: string | null
          datos_enviados: Json | null
          id: string
          momento: string
          organization_id: string | null
          puntuacion: number | null
          respuesta_claude: Json | null
          tab_origen: string | null
          tiempo_respuesta_ms: number | null
          tipo_acto: string | null
          tokens_input: number | null
          tokens_output: number | null
          total_advertencias: number | null
          total_errores: number | null
          total_sugerencias: number | null
          tramite_id: string
        }
        Insert: {
          correcciones_aplicadas?: Json | null
          costo_estimado_usd?: number | null
          created_at?: string | null
          datos_enviados?: Json | null
          id?: string
          momento: string
          organization_id?: string | null
          puntuacion?: number | null
          respuesta_claude?: Json | null
          tab_origen?: string | null
          tiempo_respuesta_ms?: number | null
          tipo_acto?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          total_advertencias?: number | null
          total_errores?: number | null
          total_sugerencias?: number | null
          tramite_id: string
        }
        Update: {
          correcciones_aplicadas?: Json | null
          costo_estimado_usd?: number | null
          created_at?: string | null
          datos_enviados?: Json | null
          id?: string
          momento?: string
          organization_id?: string | null
          puntuacion?: number | null
          respuesta_claude?: Json | null
          tab_origen?: string | null
          tiempo_respuesta_ms?: number | null
          tipo_acto?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          total_advertencias?: number | null
          total_errores?: number | null
          total_sugerencias?: number | null
          tramite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historial_validaciones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inmuebles: {
        Row: {
          area: string | null
          area_construida: string | null
          area_privada: string | null
          avaluo_catastral: string | null
          codigo_orip: string | null
          departamento: string | null
          direccion: string | null
          es_propiedad_horizontal: boolean | null
          escritura_ph: string | null
          estrato: string | null
          id: string
          identificador_predial: string | null
          linderos: string | null
          matricula_inmobiliaria: string | null
          matricula_matriz: string | null
          municipio: string | null
          nupre: string | null
          reformas_ph: string | null
          tipo_identificador_predial: string | null
          tipo_predio: string | null
          tramite_id: string
          valorizacion: string | null
        }
        Insert: {
          area?: string | null
          area_construida?: string | null
          area_privada?: string | null
          avaluo_catastral?: string | null
          codigo_orip?: string | null
          departamento?: string | null
          direccion?: string | null
          es_propiedad_horizontal?: boolean | null
          escritura_ph?: string | null
          estrato?: string | null
          id?: string
          identificador_predial?: string | null
          linderos?: string | null
          matricula_inmobiliaria?: string | null
          matricula_matriz?: string | null
          municipio?: string | null
          nupre?: string | null
          reformas_ph?: string | null
          tipo_identificador_predial?: string | null
          tipo_predio?: string | null
          tramite_id: string
          valorizacion?: string | null
        }
        Update: {
          area?: string | null
          area_construida?: string | null
          area_privada?: string | null
          avaluo_catastral?: string | null
          codigo_orip?: string | null
          departamento?: string | null
          direccion?: string | null
          es_propiedad_horizontal?: boolean | null
          escritura_ph?: string | null
          estrato?: string | null
          id?: string
          identificador_predial?: string | null
          linderos?: string | null
          matricula_inmobiliaria?: string | null
          matricula_matriz?: string | null
          municipio?: string | null
          nupre?: string | null
          reformas_ph?: string | null
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
      logs_extraccion: {
        Row: {
          created_at: string | null
          data_final: Json | null
          data_ia: Json
          id: string
          tramite_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data_final?: Json | null
          data_ia: Json
          id?: string
          tramite_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data_final?: Json | null
          data_ia?: Json
          id?: string
          tramite_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_extraccion_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          is_personal: boolean
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_personal?: boolean
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_personal?: boolean
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notaria_styles: {
        Row: {
          ciudad: string
          clausulas_personalizadas: Json | null
          created_at: string
          estilo_linderos: string
          formato_fecha: string
          id: string
          linderos_formato: string
          line_height_pt: number
          lineas_por_pagina: number
          margin_bottom_mm: number
          margin_left_mm: number
          margin_right_mm: number
          margin_top_mm: number
          nombre_notaria: string
          notario_titular: string
          organization_id: string
          precios_mayusculas: boolean
          updated_at: string
        }
        Insert: {
          ciudad?: string
          clausulas_personalizadas?: Json | null
          created_at?: string
          estilo_linderos?: string
          formato_fecha?: string
          id?: string
          linderos_formato?: string
          line_height_pt?: number
          lineas_por_pagina?: number
          margin_bottom_mm?: number
          margin_left_mm?: number
          margin_right_mm?: number
          margin_top_mm?: number
          nombre_notaria?: string
          notario_titular?: string
          organization_id: string
          precios_mayusculas?: boolean
          updated_at?: string
        }
        Update: {
          ciudad?: string
          clausulas_personalizadas?: Json | null
          created_at?: string
          estilo_linderos?: string
          formato_fecha?: string
          id?: string
          linderos_formato?: string
          line_height_pt?: number
          lineas_por_pagina?: number
          margin_bottom_mm?: number
          margin_left_mm?: number
          margin_right_mm?: number
          margin_top_mm?: number
          nombre_notaria?: string
          notario_titular?: string
          organization_id?: string
          precios_mayusculas?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notaria_styles_organization_id_fkey"
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
          actua_mediante_apoderado: boolean | null
          apoderado_persona_cedula: string | null
          apoderado_persona_municipio: string | null
          apoderado_persona_nombre: string | null
          direccion: string | null
          es_pep: boolean
          es_persona_juridica: boolean
          estado_civil: string | null
          id: string
          lugar_expedicion: string | null
          municipio_domicilio: string | null
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
          actua_mediante_apoderado?: boolean | null
          apoderado_persona_cedula?: string | null
          apoderado_persona_municipio?: string | null
          apoderado_persona_nombre?: string | null
          direccion?: string | null
          es_pep?: boolean
          es_persona_juridica?: boolean
          estado_civil?: string | null
          id?: string
          lugar_expedicion?: string | null
          municipio_domicilio?: string | null
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
          actua_mediante_apoderado?: boolean | null
          apoderado_persona_cedula?: string | null
          apoderado_persona_municipio?: string | null
          apoderado_persona_nombre?: string | null
          direccion?: string | null
          es_pep?: boolean
          es_persona_juridica?: boolean
          estado_civil?: string | null
          id?: string
          lugar_expedicion?: string | null
          municipio_domicilio?: string | null
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
      plantillas_validacion: {
        Row: {
          activa: boolean | null
          campos_opcionales: Json | null
          campos_requeridos: Json
          codigo_acto: string | null
          created_at: string | null
          id: string
          nombre_acto: string
          relaciones_entre_campos: Json | null
          tipo_acto: string
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          campos_opcionales?: Json | null
          campos_requeridos: Json
          codigo_acto?: string | null
          created_at?: string | null
          id?: string
          nombre_acto: string
          relaciones_entre_campos?: Json | null
          tipo_acto: string
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          campos_opcionales?: Json | null
          campos_requeridos?: Json
          codigo_acto?: string | null
          created_at?: string | null
          id?: string
          nombre_acto?: string
          relaciones_entre_campos?: Json | null
          tipo_acto?: string
          updated_at?: string | null
        }
        Relationships: []
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
      radicado_counters: {
        Row: {
          last_number: number
          organization_id: string
          year: number
        }
        Insert: {
          last_number?: number
          organization_id: string
          year: number
        }
        Update: {
          last_number?: number
          organization_id?: string
          year?: number
        }
        Relationships: []
      }
      reglas_validacion: {
        Row: {
          activa: boolean | null
          aplica_a_momento: string[] | null
          auto_corregible: boolean | null
          campo_aplicable: string | null
          categoria: string
          codigo: string
          created_at: string | null
          descripcion: string
          id: string
          nivel_severidad: string
          regla_detalle: string
          tipo_acto: string[] | null
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          aplica_a_momento?: string[] | null
          auto_corregible?: boolean | null
          campo_aplicable?: string | null
          categoria: string
          codigo: string
          created_at?: string | null
          descripcion: string
          id?: string
          nivel_severidad: string
          regla_detalle: string
          tipo_acto?: string[] | null
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          aplica_a_momento?: string[] | null
          auto_corregible?: boolean | null
          campo_aplicable?: string | null
          categoria?: string
          codigo?: string
          created_at?: string | null
          descripcion?: string
          id?: string
          nivel_severidad?: string
          regla_detalle?: string
          tipo_acto?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      system_events: {
        Row: {
          categoria: string
          created_at: string | null
          detalle: Json | null
          evento: string
          id: string
          organization_id: string | null
          resultado: string
          tiempo_ms: number | null
          tramite_id: string | null
          user_id: string | null
        }
        Insert: {
          categoria: string
          created_at?: string | null
          detalle?: Json | null
          evento: string
          id?: string
          organization_id?: string | null
          resultado: string
          tiempo_ms?: number | null
          tramite_id?: string | null
          user_id?: string | null
        }
        Update: {
          categoria?: string
          created_at?: string | null
          detalle?: Json | null
          evento?: string
          id?: string
          organization_id?: string | null
          resultado?: string
          tiempo_ms?: number | null
          tramite_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      tramites: {
        Row: {
          created_at: string
          created_by: string
          docx_path: string | null
          fecha: string | null
          id: string
          is_unlocked: boolean
          metadata: Json | null
          notaria_style_id: string | null
          organization_id: string
          radicado: string | null
          status: Database["public"]["Enums"]["tramite_status"]
          tipo: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          docx_path?: string | null
          fecha?: string | null
          id?: string
          is_unlocked?: boolean
          metadata?: Json | null
          notaria_style_id?: string | null
          organization_id: string
          radicado?: string | null
          status?: Database["public"]["Enums"]["tramite_status"]
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          docx_path?: string | null
          fecha?: string | null
          id?: string
          is_unlocked?: boolean
          metadata?: Json | null
          notaria_style_id?: string | null
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
            foreignKeyName: "tramites_notaria_style_id_fkey"
            columns: ["notaria_style_id"]
            isOneToOne: false
            referencedRelation: "notaria_styles"
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
      user_active_context: {
        Row: {
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_context_organization_id_fkey"
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
      accept_invitation: { Args: { p_invitation_id: string }; Returns: string }
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
      consume_credit_v2: {
        Args: {
          p_action: string
          p_credits?: number
          p_org_id: string
          p_tipo_acto?: string
          p_tramite_id?: string
          p_user_id: string
        }
        Returns: boolean
      }
      create_organization_for_user: {
        Args: { p_org_name: string; p_org_nit: string; p_user_id: string }
        Returns: string
      }
      get_active_org: { Args: { uid: string }; Returns: string }
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
      next_radicado: { Args: { p_org_id: string }; Returns: string }
      purge_expired_drafts: { Args: never; Returns: undefined }
      restore_credit: { Args: { org_id: string }; Returns: undefined }
      set_active_context: { Args: { p_org_id: string }; Returns: undefined }
      tramite_org_from_path: { Args: { p_path: string }; Returns: string }
      unlock_expediente: {
        Args: { p_org_id: string; p_tramite_id: string; p_user_id: string }
        Returns: boolean
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

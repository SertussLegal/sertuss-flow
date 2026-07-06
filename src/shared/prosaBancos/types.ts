// ============================================================================
// prosaBancos/types — Contrato canónico ISOMÓRFICO para templates de prosa.
//
// 🛡️ BLINDAJE DE TIPOS (v2.1):
//   Este archivo se ejecuta tanto en Deno (edge `procesar-cancelacion`) como
//   en Vite/Vitest (cliente `ProsaLiveRenderer` + tests).
//   PROHIBIDO importar:
//     - Database / Row / Tables<> de @/integrations/supabase/types
//     - Clientes de infraestructura (SupabaseClient, PostgrestResponse)
//     - Tipos de React (ReactNode, FC)
//     - APIs de Deno (Deno.*) o de navegador (window, document)
//     - Módulos npm:… o URLs deno.land
//   Solo tipos primitivos de TypeScript y interfaces puras.
//   El test `__contract__/purity.test.ts` bloquea cualquier regresión.
// ============================================================================

export type TipoApoderado = "natural" | "juridica" | null;

/**
 * Payload del apoderado — declarado localmente (no se importa de
 * apoderadoClassifier.ts para preservar el isomorfismo). Es estructuralmente
 * compatible con el `ApoderadoPayload` de Deno y del cliente.
 */
export interface ApoderadoPayload {
  tipo?: TipoApoderado | string;
  nombre?: string | null;
  cargo?: string | null;
  cedula?: string | null;
  sociedad_razon_social?: string | null;
  sociedad_nit?: string | null;
  sociedad_constitucion?: {
    tipo_documento?: string | null;
    numero?: string | null;
    fecha?: string | null;
    fecha_texto?: string | null;
    camara_comercio_ciudad?: string | null;
    camara_comercio_fecha?: string | null;
    camara_comercio_numero?: string | null;
    libro?: string | null;
    razon_social_anterior?: string | null;
    reforma_acta_numero?: string | null;
    reforma_acta_fecha_texto?: string | null;
    reforma_camara_fecha_texto?: string | null;
  } | null;
  representantes?: Array<{
    nombre?: string;
    cedula?: string;
    cargo?: string;
    email?: string;
    es_firmante?: boolean;
  }>;
  tipo_override?: TipoApoderado | string;
  escritura_poder_num?: string | null;
  escritura_poder_fecha?: string | null;
  escritura_poder_notaria_num?: string | null;
  _confianza_tipo?: "alta" | "media" | "baja" | null;
}

export interface PoderdantePayload {
  entidad_nombre?: string | null;
  entidad_nit?: string | null;
  entidad_constitucion_escritura?: string | null;
  representante_legal_nombre?: string | null;
  representante_legal_cedula?: string | null;
  representante_legal_cargo?: string | null;
  representante_legal_cedula_expedida_en?: string | null;
}

export interface InstrumentoPoderPayload {
  escritura_num?: string | null;
  fecha?: string | null;
  fecha_texto?: string | null;
  notaria_numero?: string | null;
  notaria_ciudad?: string | null;
}

export interface ProsaContext {
  apoderado: ApoderadoPayload;
  poderdante: PoderdantePayload;
  instrumento: InstrumentoPoderPayload;
  ciudad_firma?: string | null;
  /**
   * Notas adicionales del usuario (Modal Híbrido v5). Se anexan al final
   * de la cláusula PRIMERO. Sanitizadas por `overrideSchema.ts` antes de
   * llegar aquí.
   */
  notas_adicionales?: string | null;
}

/**
 * Override editable por trámite (persistido en cancelaciones.prosa_apoderado_override).
 * Solo campos que la política jurídica permite ajustar sin romper el núcleo canónico.
 */
export interface ProsaApoderadoOverride {
  notas_adicionales?: string | null;
  campos_editados?: {
    sociedad_constitucion?: {
      reforma_acta_numero?: string | null;
      razon_social_anterior?: string | null;
    };
    representante_legal_cargo?: string | null;
    representante_legal_cedula_expedida_en?: string | null;
  } | null;
  fuente_referencia?: "estilo" | "datos" | "manual" | null;
  actualizado_en?: string | null;
}

export interface ProsaBancoTemplate {
  nitBanco: string;
  nitAliases: string[];
  nombreBanco: string;
  renderComparecencia: (ctx: ProsaContext) => string;
  renderAntefirma: (ctx: ProsaContext) => string;
  renderNotaAutorizacion: (ctx: ProsaContext) => string;
}

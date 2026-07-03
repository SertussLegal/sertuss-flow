// ============================================================================
// prosaBancos/types — Contrato canónico para templates de prosa por banco.
//
// Cada banco acreedor (Davivienda, Bancolombia, Bogotá, ...) implementa este
// contrato en su propio archivo. El registro central en `./index.ts` resuelve
// por NIT y delega. Esto convierte a Sertuss en plataforma multi-banco sin
// tocar `procesar-cancelacion/index.ts`.
// ============================================================================

import type { ApoderadoPayload } from "../apoderadoClassifier.ts";

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
  /** Ciudad de firma del acto (para prosa que la referencia). */
  ciudad_firma?: string | null;
}

export interface ProsaBancoTemplate {
  /** NIT con guion de DV. Ej: "860.034.313-7". */
  nitBanco: string;
  /** Alias adicionales para lookup por NIT sin puntos, sin guiones. */
  nitAliases: string[];
  /** Razón social canónica. Ej: "BANCO DAVIVIENDA S.A." */
  nombreBanco: string;
  /** Cláusula PRIMERO de comparecencia. */
  renderComparecencia: (ctx: ProsaContext) => string;
  /** Antefirma que va bajo la firma del compareciente. */
  renderAntefirma: (ctx: ProsaContext) => string;
  /** Nota de autorización de firma fuera de despacho. */
  renderNotaAutorizacion: (ctx: ProsaContext) => string;
}

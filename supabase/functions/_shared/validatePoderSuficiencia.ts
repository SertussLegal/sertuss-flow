// ============================================================================
// validatePoderSuficiencia — Módulo determinista de validación legal del
// Poder General del Banco. Plan v5 sección Q (corrige L2 de v4).
//
// Reemplaza el skill regex `validar-poder-general-banco` con lógica TS
// pura, sin dependencia de IA. Devuelve:
//   - apoderado_valido: boolean (suficiente para cancelación)
//   - motivos: string[] (códigos estables, no texto libre)
//   - vigencia: estado y advertencias
//
// REGLAS DE FECHA (CRÍTICAS):
// Toda comparación entre fechas se hace sobre strings "YYYY-MM-DD" en
// zona Bogotá (UTC-5), normalizadas por `toLocalDateBogota()`. Esto
// elimina falsos positivos por desfase TZ del servidor.
// ============================================================================

import { toLocalDateBogota, addDaysBogota, yearsBetweenIsoDates } from "./dateBogota.ts";

/** Forma mínima del JSON v3 que produce el OCR del poder. */
export interface PoderEstructurado {
  has_apoderado_banco?: boolean | null;
  facultades?: {
    cancela_total?: boolean;
    cancela_parcial?: boolean;
    cancela_hipotecas?: boolean;
    libera_gravamenes?: boolean;
    texto_literal?: string;
  };
  vigencia?: {
    tipo?: "indefinida" | "hasta_fecha" | "hasta_terminacion_contrato" | null;
    fecha_limite?: string | null; // "YYYY-MM-DD" o ISO
  };
  instrumento_poder?: {
    fecha?: string | null;
    escritura_num?: string | null;
    notaria?: string | null;
  };
  apoderado?: {
    tipo?: "natural" | "juridica" | null;
    sociedad_nit?: string | null;
    representantes?: Array<{ nombre?: string; cedula?: string; cargo?: string }>;
  };
  poderdante?: {
    entidad_nombre?: string | null;
    entidad_nit?: string | null;
  };
  sustitucion_permitida?: boolean;
}

export interface ValidacionResultado {
  apoderado_valido: boolean;
  motivos: string[];                  // códigos: "facultad_cancelacion_ausente", etc.
  advertencias: string[];             // ámbar, no bloquean
  vigente: boolean;
  vigencia_detalle: {
    estado: "vigente" | "expirado" | "atado_a_contrato" | "desconocido";
    fecha_eval: string;               // "YYYY-MM-DD" usado para la comparación
    fecha_limite_normalizada?: string;
    fecha_estimada: boolean;          // true si no había fecha_otorgamiento real
  };
  requiere_captura_humana: boolean;   // K3: ambigüedad de firma
}

export interface ValidacionInput {
  poder: PoderEstructurado | null | undefined;
  /** Fecha planeada para firmar la nueva escritura. Si no hay, se estima +30 días. */
  fechaOtorgamientoProyectada?: string | Date | null;
  /** Si el usuario no adjuntó poder, la validación es no-op. */
  poderAdjuntado: boolean;
}

const AÑOS_LIMITE_PODER = 5;
const DIAS_FALLBACK_OTORGAMIENTO = 30;

export function validatePoderSuficiencia(input: ValidacionInput): ValidacionResultado {
  const { poder, poderAdjuntado, fechaOtorgamientoProyectada } = input;

  // Sin poder adjunto: el banco firma directo (caso legítimo) o el usuario
  // omitió el documento. No bloqueamos — la UI ya pinta los campos como
  // críticos opcionales. Devolvemos resultado neutro.
  if (!poderAdjuntado || !poder) {
    return neutroSinPoder();
  }

  const motivos: string[] = [];
  const advertencias: string[] = [];

  // ── K3: ambigüedad de firma. has_apoderado_banco === null bloquea hasta
  //        que el usuario resuelva manualmente.
  const requiere_captura_humana = poder.has_apoderado_banco === null;
  if (requiere_captura_humana) {
    motivos.push("ambiguedad_firma_requiere_captura_humana");
  }

  // ── Facultades de cancelación
  const fac = poder.facultades ?? {};
  const tieneFacultadCancelacion =
    !!(fac.cancela_total || fac.cancela_parcial || fac.cancela_hipotecas || fac.libera_gravamenes);

  if (!tieneFacultadCancelacion) {
    motivos.push("facultad_cancelacion_ausente");
  }

  // ── Vigencia (con normalización Bogotá obligatoria)
  const vigencia_detalle = evaluarVigencia(poder, fechaOtorgamientoProyectada);
  if (vigencia_detalle.estado === "expirado") {
    motivos.push("poder_expirado_en_fecha_otorgamiento");
  }
  if (vigencia_detalle.estado === "atado_a_contrato") {
    advertencias.push("vigencia_atada_a_contrato_verificar_manualmente");
  }

  // ── Antigüedad > 5 años (advertencia ámbar, no bloquea)
  const fechaInstrumento = toLocalDateBogota(poder.instrumento_poder?.fecha ?? "");
  if (fechaInstrumento) {
    const anios = yearsBetweenIsoDates(fechaInstrumento, vigencia_detalle.fecha_eval);
    if (anios > AÑOS_LIMITE_PODER) {
      advertencias.push(
        vigencia_detalle.fecha_estimada
          ? "poder_supera_5_anios_y_fecha_otorgamiento_estimada"
          : "poder_supera_5_anios_a_la_fecha_de_otorgamiento",
      );
    }
  }

  // ── Coherencia jurídica: si el apoderado es sociedad, debe tener NIT
  if (poder.apoderado?.tipo === "juridica" && !poder.apoderado?.sociedad_nit) {
    advertencias.push("apoderado_juridico_sin_nit");
  }
  if (poder.apoderado?.tipo === "juridica" && (poder.apoderado.representantes ?? []).length === 0) {
    motivos.push("apoderado_juridico_sin_representantes");
  }

  const apoderado_valido = motivos.length === 0;

  return {
    apoderado_valido,
    motivos,
    advertencias,
    vigente: vigencia_detalle.estado === "vigente" || vigencia_detalle.estado === "atado_a_contrato",
    vigencia_detalle,
    requiere_captura_humana,
  };
}

function evaluarVigencia(
  poder: PoderEstructurado,
  fechaOtorgamientoProyectada?: string | Date | null,
): ValidacionResultado["vigencia_detalle"] {
  const fechaEstimada = !fechaOtorgamientoProyectada;
  const fechaEval = fechaOtorgamientoProyectada
    ? toLocalDateBogota(fechaOtorgamientoProyectada)
    : addDaysBogota(new Date(), DIAS_FALLBACK_OTORGAMIENTO);

  const vig = poder.vigencia ?? {};
  if (vig.tipo === "hasta_fecha" && vig.fecha_limite) {
    const limite = toLocalDateBogota(vig.fecha_limite);
    // Comparación lexicográfica de strings "YYYY-MM-DD" === orden cronológico.
    // Q2 caso límite: igualdad estricta → NO expirado (vence ese mismo día).
    if (limite && limite < fechaEval) {
      return {
        estado: "expirado",
        fecha_eval: fechaEval,
        fecha_limite_normalizada: limite,
        fecha_estimada: fechaEstimada,
      };
    }
    return {
      estado: "vigente",
      fecha_eval: fechaEval,
      fecha_limite_normalizada: limite,
      fecha_estimada: fechaEstimada,
    };
  }
  if (vig.tipo === "hasta_terminacion_contrato") {
    return { estado: "atado_a_contrato", fecha_eval: fechaEval, fecha_estimada: fechaEstimada };
  }
  if (vig.tipo === "indefinida") {
    return { estado: "vigente", fecha_eval: fechaEval, fecha_estimada: fechaEstimada };
  }
  return { estado: "desconocido", fecha_eval: fechaEval, fecha_estimada: fechaEstimada };
}

function neutroSinPoder(): ValidacionResultado {
  return {
    apoderado_valido: true,
    motivos: [],
    advertencias: [],
    vigente: true,
    vigencia_detalle: {
      estado: "vigente",
      fecha_eval: toLocalDateBogota(new Date()),
      fecha_estimada: true,
    },
    requiere_captura_humana: false,
  };
}

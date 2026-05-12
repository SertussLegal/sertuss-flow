/**
 * docxConsolidation — Fuente única de verdad para llenar el `.docx`.
 *
 * Construye el objeto `structuredData` que consume `docxtemplater` (descarga)
 * y `DocxPreview.buildReplacements` (visor). Garantiza que ambos caminos
 * vean los mismos valores: lo que se ve en pantalla es lo que se descarga.
 *
 * Orden de prioridad:
 *   1. manualFieldOverrides
 *   2. Estado de UI actual (vendedores, compradores, inmueble, actos)
 *   3. templateData devuelto por process-expediente
 *   4. Carta de crédito (solo campos bancarios/hipotecarios)
 *   5. metadata.extracted_*  (OCR)
 *   6. ___________  (placeholder)
 *
 * No hace fetch a Supabase: recibe todo por parámetro. Si en el futuro se
 * necesita re-fetch como fallback, debe inyectarse vía `dbFallback` SIN
 * pisar lo que la UI ya tiene.
 */

import type { Persona, Inmueble, Actos } from "@/lib/types";
import type { NotariaTramite } from "@/components/tramites/DocxPreview";
import {
  formatCedulaLegal,
  formatMonedaLegal,
  numeroNotariaToLetras,
  numeroToOrdinalAbbr,
  coeficienteToLetras,
  type FormatoOrdinal,
} from "@/lib/legalFormatters";
import { sanitizeDireccion, sanitizeEstadoCivil } from "@/lib/reconcileData";
import { lookupBank } from "@/lib/bankDirectory";

const PLACEHOLDER = "___________";

// ── Carta de crédito ───────────────────────────────────────────────────

export interface CartaCreditoData {
  entidad_bancaria?: string;
  entidad_nit?: string;
  entidad_domicilio?: string;
  valor_credito?: string;
  pago_inicial?: string;
  saldo_financiado?: string;
  fecha_credito?: string;
}

/**
 * Detecta carta de crédito en metadata.
 * Si existe, se considera la fuente autoritativa para datos bancarios e
 * hipotecarios vigentes. Cualquier banco mencionado en certificado de
 * tradición u otra fuente queda descartado.
 */
export function resolveCartaCredito(
  metadata: Record<string, unknown> | null | undefined,
): CartaCreditoData | null {
  if (!metadata) return null;
  const raw =
    (metadata as Record<string, unknown>)["extracted_carta_credito"] ||
    (metadata as Record<string, unknown>)["carta_credito"] ||
    null;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const str = (v: unknown): string => (v == null ? "" : String(v).trim());
  const banco = str(c.banco) || str(c.entidad) || str(c.entidad_bancaria);
  const nit = str(c.nit) || str(c.entidad_nit);
  if (!banco && !nit && !c.valor_aprobado && !c.valor) return null;
  return {
    entidad_bancaria: banco,
    entidad_nit: nit,
    entidad_domicilio: str(c.domicilio) || str(c.entidad_domicilio),
    valor_credito: str(c.valor_aprobado) || str(c.valor) || str(c.valor_credito),
    pago_inicial: str(c.pago_inicial) || str(c.cuota_inicial),
    saldo_financiado: str(c.saldo_financiado) || str(c.saldo),
    fecha_credito: str(c.fecha_aprobacion) || str(c.fecha) || str(c.fecha_credito),
  };
}

// ── Helpers internos ───────────────────────────────────────────────────

const safe = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = String(v).trim();
  if (!s) return "";
  s = s.replace(/_{3,}/g, "").trim();
  return s;
};
const orBlank = (v: unknown): string => safe(v) || PLACEHOLDER;

/** Toma el primer valor no vacío. */
const firstNonEmpty = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = safe(v);
    if (s) return s;
  }
  return "";
};

interface FechaParts {
  dia_letras: string;
  dia_num: string;
  mes: string;
  anio_letras: string;
  anio_num: string;
}
const emptyFecha: FechaParts = {
  dia_letras: PLACEHOLDER,
  dia_num: PLACEHOLDER,
  mes: PLACEHOLDER,
  anio_letras: PLACEHOLDER,
  anio_num: PLACEHOLDER,
};
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
function parseFechaParts(fecha: string): FechaParts {
  if (!fecha) return emptyFecha;
  const dmy = fecha.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
  const ymd = fecha.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  let d = 0, m = 0, y = 0;
  if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; }
  else if (ymd) { y = +ymd[1]; m = +ymd[2]; d = +ymd[3]; }
  else return emptyFecha;
  if (m < 1 || m > 12) return emptyFecha;
  return {
    dia_letras: PLACEHOLDER, // hidratado por docxProsaHydrator
    dia_num: String(d),
    mes: MESES[m - 1] || PLACEHOLDER,
    anio_letras: PLACEHOLDER,
    anio_num: String(y),
  };
}

function mapPersona(p: Persona): Record<string, unknown> {
  const cleanDir = sanitizeDireccion(p.direccion || "");
  const cleanEstado = sanitizeEstadoCivil(p.estado_civil || "", p.nombre_completo || "");
  return {
    nombre: p.nombre_completo || PLACEHOLDER,
    cedula: p.numero_cedula ? formatCedulaLegal(p.numero_cedula) : PLACEHOLDER,
    expedida_en: p.lugar_expedicion || PLACEHOLDER,
    estado_civil: cleanEstado || PLACEHOLDER,
    domicilio: p.municipio_domicilio || PLACEHOLDER,
    direccion_residencia: cleanDir || PLACEHOLDER,
    telefono: PLACEHOLDER,
    actividad_economica: PLACEHOLDER,
    email: PLACEHOLDER,
    es_pep: p.es_pep,
    acepta_notificaciones: true,
  };
}

// ── Input / Output ─────────────────────────────────────────────────────

export interface ConsolidationInput {
  manualFieldOverrides: Record<string, string>;
  ui: {
    vendedores: Persona[];
    compradores: Persona[];
    inmueble: Inmueble;
    actos: Actos;
    notariaTramite: NotariaTramite;
  };
  templateData?: Record<string, unknown> | null;
  cartaCredito?: CartaCreditoData | null;
  ocr: {
    extractedDocumento?: Record<string, unknown> | null;
    extractedPredial?: Record<string, unknown> | null;
  };
  formatoOrdinalNotaria?: FormatoOrdinal;
}

export type ConsolidatedDocxData = Record<string, unknown>;

/**
 * Construye el modelo consolidado. Salida lista para `doc.render()`
 * EXCEPTO por la prosa en letras, que la añade `hydrateProsa()` aparte.
 */
export function getConsolidatedDocxData(input: ConsolidationInput): ConsolidatedDocxData {
  const {
    ui: { vendedores, compradores, inmueble, actos, notariaTramite },
    templateData,
    cartaCredito,
    ocr,
    formatoOrdinalNotaria = "volada",
  } = input;

  // ── Linderos: priorizar campos separados ─────────────────────────────
  const linderosEspeciales = safe(inmueble.linderos_especiales) || safe(inmueble.linderos);
  const linderosGenerales = safe(inmueble.linderos_generales);

  // ── Banco: carta_credito > UI > templateData > directorio ────────────
  const bankInfo = lookupBank(actos.entidad_bancaria || "");
  const bankNit = firstNonEmpty(
    cartaCredito?.entidad_nit,
    actos.entidad_nit,
    (templateData as Record<string, unknown>)?.entidad_nit,
    bankInfo?.nit,
  );
  const bankDomicilio = firstNonEmpty(
    cartaCredito?.entidad_domicilio,
    actos.entidad_domicilio,
    (templateData as Record<string, unknown>)?.entidad_domicilio,
    bankInfo?.domicilio,
  );
  const bankNombre = firstNonEmpty(
    cartaCredito?.entidad_bancaria,
    actos.entidad_bancaria,
    (templateData as Record<string, unknown>)?.entidad_bancaria,
  );
  const valorCredito = firstNonEmpty(
    cartaCredito?.valor_credito,
    actos.valor_hipoteca,
  );
  const pagoInicial = firstNonEmpty(cartaCredito?.pago_inicial, actos.pago_inicial);
  const saldoFinanciado = firstNonEmpty(cartaCredito?.saldo_financiado, actos.saldo_financiado);
  const fechaCredito = firstNonEmpty(cartaCredito?.fecha_credito, actos.fecha_credito);

  // ── Fechas parseadas ─────────────────────────────────────────────────
  const ed = ocr.extractedDocumento ?? {};
  const titAnt = (ed["titulo_antecedente"] ?? {}) as Record<string, unknown>;
  const antFecha = parseFechaParts(
    String(titAnt.fecha_documento ?? ed.fecha_documento ?? ""),
  );
  const rphFecha = parseFechaParts(inmueble.escritura_ph_fecha || "");
  const creditoFecha = parseFechaParts(fechaCredito);

  // ── Coeficiente ──────────────────────────────────────────────────────
  const coefLetras = coeficienteToLetras(inmueble.coeficiente_copropiedad);

  // ── Notaría ──────────────────────────────────────────────────────────
  const notariaNumeroLetrasBase =
    notariaTramite.numero_notaria_letras ||
    (notariaTramite.numero_notaria
      ? numeroNotariaToLetras(notariaTramite.numero_notaria)
      : "");

  const data: ConsolidatedDocxData = {
    // ── Notaría ────────────────────────────────────────────────────
    escritura_numero: PLACEHOLDER,
    fecha_escritura_corta: new Date().toLocaleDateString("es-CO"),
    notario_nombre: orBlank(notariaTramite.nombre_notario),
    notario_decreto: orBlank(notariaTramite.decreto_nombramiento),
    notario_tipo: notariaTramite.tipo_notario || "",
    notaria_numero: orBlank(notariaTramite.numero_notaria),
    notaria_numero_letras: notariaNumeroLetrasBase || PLACEHOLDER,
    notaria_numero_letras_lower: notariaNumeroLetrasBase
      ? notariaNumeroLetrasBase.toLowerCase()
      : PLACEHOLDER,
    notaria_numero_letras_femenino: (() => {
      if (!notariaNumeroLetrasBase) return PLACEHOLDER;
      const upper = notariaNumeroLetrasBase.toUpperCase();
      return upper.endsWith("O") ? upper.slice(0, -1) + "A" : upper;
    })(),
    notaria_ordinal:
      notariaTramite.numero_ordinal ||
      (notariaTramite.numero_notaria
        ? numeroToOrdinalAbbr(notariaTramite.numero_notaria, formatoOrdinalNotaria)
        : PLACEHOLDER),
    notaria_circulo: orBlank(notariaTramite.circulo),
    notaria_circulo_proper: notariaTramite.circulo
      ? notariaTramite.circulo.toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase())
      : PLACEHOLDER,
    notaria_departamento: orBlank(notariaTramite.departamento),

    // ── Flags booleanos ────────────────────────────────────────────
    has_ph: !!inmueble.es_propiedad_horizontal,
    has_linderos: !!linderosEspeciales,
    has_linderos_especiales: !!linderosEspeciales,
    has_linderos_generales: !!linderosGenerales,
    has_hipoteca: !!actos.es_hipoteca,
    has_credito: !!(valorCredito || bankNombre),
    has_apoderado_banco: !!(actos.apoderado_nombre && actos.apoderado_cedula),
    has_antecedente: !!(titAnt.numero_documento || ed.numero_escritura),
    has_afectacion_familiar: !!actos.afectacion_vivienda_familiar,
    has_predial: !!ocr.extractedPredial?.numero_recibo,
    has_coeficiente: !!inmueble.coeficiente_copropiedad,
    has_carta_credito: !!cartaCredito,
    tiene_hipoteca: actos.es_hipoteca,
    afectacion_vivienda: actos.afectacion_vivienda_familiar || false,

    // ── Personas ───────────────────────────────────────────────────
    vendedores: vendedores.map(mapPersona),
    compradores: compradores.map(mapPersona),

    // ── Aliases root del inmueble ──────────────────────────────────
    ubicacion_predio: orBlank(inmueble.direccion),
    ubicacion_inmueble: orBlank(inmueble.direccion),
    direccion_inmueble: orBlank(inmueble.direccion),
    matricula_inmobiliaria: orBlank(inmueble.matricula_inmobiliaria),
    matricula: orBlank(inmueble.matricula_inmobiliaria),
    cedula_catastral: orBlank(inmueble.identificador_predial),
    chip: orBlank(inmueble.identificador_predial),
    identificador_predial: orBlank(inmueble.identificador_predial),
    inmueble_nombre: orBlank(inmueble.nombre_edificio_conjunto),
    nombre_edificio_conjunto: orBlank(inmueble.nombre_edificio_conjunto),
    linderos_especiales: linderosEspeciales || PLACEHOLDER,
    linderos_generales: linderosGenerales || PLACEHOLDER,
    coeficiente_letras: coefLetras || PLACEHOLDER,
    coeficiente_numero: orBlank(inmueble.coeficiente_copropiedad),
    coeficiente_copropiedad: orBlank(inmueble.coeficiente_copropiedad),
    municipio_inmueble: orBlank(inmueble.municipio),
    departamento_inmueble: orBlank(inmueble.departamento),
    orip_ciudad: orBlank(inmueble.codigo_orip),

    // ── Aliases root del banco ─────────────────────────────────────
    entidad_bancaria: orBlank(bankNombre),
    entidad_nit: orBlank(bankNit),
    entidad_domicilio: orBlank(bankDomicilio),
    banco_nombre: orBlank(bankNombre),
    banco_nit: orBlank(bankNit),

    // ── Inmueble nested ────────────────────────────────────────────
    inmueble: {
      matricula: orBlank(inmueble.matricula_inmobiliaria),
      matricula_inmobiliaria: orBlank(inmueble.matricula_inmobiliaria),
      cedula_catastral: orBlank(inmueble.identificador_predial),
      chip: orBlank(inmueble.identificador_predial),
      ubicacion: orBlank(inmueble.direccion),
      direccion: orBlank(inmueble.direccion),
      nombre_edificio_conjunto: orBlank(inmueble.nombre_edificio_conjunto),
      inmueble_nombre: orBlank(inmueble.nombre_edificio_conjunto),
      linderos_especiales: linderosEspeciales || PLACEHOLDER,
      linderos_generales: linderosGenerales || PLACEHOLDER,
      orip_ciudad: orBlank(inmueble.codigo_orip),
      orip_zona: PLACEHOLDER,
      coeficiente_letras: coefLetras || PLACEHOLDER,
      coeficiente_numero: orBlank(inmueble.coeficiente_copropiedad),
      nupre: orBlank(inmueble.nupre),
      estrato: orBlank(inmueble.estrato),
      es_rph: inmueble.es_propiedad_horizontal,
      municipio: orBlank(inmueble.municipio),
      departamento: orBlank(inmueble.departamento),
      predial_anio: orBlank(ocr.extractedPredial?.anio_gravable),
      predial_num: orBlank(ocr.extractedPredial?.numero_recibo),
      predial_valor: ocr.extractedPredial?.valor_pagado
        ? formatMonedaLegal(String(ocr.extractedPredial.valor_pagado))
        : PLACEHOLDER,
      idu_num: PLACEHOLDER, idu_fecha: PLACEHOLDER, idu_vigencia: PLACEHOLDER,
      admin_fecha: PLACEHOLDER, admin_vigencia: PLACEHOLDER,
    },

    // ── Actos nested ───────────────────────────────────────────────
    actos: {
      cuantia_compraventa_letras: actos.valor_compraventa
        ? formatMonedaLegal(actos.valor_compraventa).split("($")[0]?.trim() || PLACEHOLDER
        : PLACEHOLDER,
      cuantia_compraventa_numero: actos.valor_compraventa
        ? formatMonedaLegal(actos.valor_compraventa)
        : PLACEHOLDER,
      cuantia_hipoteca_letras: valorCredito
        ? formatMonedaLegal(valorCredito).split("($")[0]?.trim() || PLACEHOLDER
        : PLACEHOLDER,
      cuantia_hipoteca_numero: valorCredito ? formatMonedaLegal(valorCredito) : PLACEHOLDER,
      fecha_escritura_letras: PLACEHOLDER,
      entidad_bancaria: orBlank(bankNombre),
      entidad_nit: orBlank(bankNit),
      entidad_domicilio: orBlank(bankDomicilio),
      pago_inicial_letras: pagoInicial
        ? formatMonedaLegal(pagoInicial).split("($")[0]?.trim() || PLACEHOLDER
        : PLACEHOLDER,
      pago_inicial_numero: pagoInicial ? formatMonedaLegal(pagoInicial) : PLACEHOLDER,
      saldo_financiado_letras: saldoFinanciado
        ? formatMonedaLegal(saldoFinanciado).split("($")[0]?.trim() || PLACEHOLDER
        : PLACEHOLDER,
      saldo_financiado_numero: saldoFinanciado
        ? formatMonedaLegal(saldoFinanciado)
        : PLACEHOLDER,
      credito_dia_letras: creditoFecha.dia_letras,
      credito_dia_num: creditoFecha.dia_num,
      credito_mes: creditoFecha.mes,
      credito_anio_letras: creditoFecha.anio_letras,
      credito_anio_num: creditoFecha.anio_num,
      redam_resultado: PLACEHOLDER,
      afectacion_vivienda: actos.afectacion_vivienda_familiar || false,
    },

    // ── Antecedentes ───────────────────────────────────────────────
    antecedentes: {
      modo: orBlank(ed.modo_adquisicion),
      adquirido_de: orBlank(ed.adquirido_de),
      escritura_num_letras: PLACEHOLDER,
      escritura_num_numero: orBlank(titAnt.numero_documento || ed.numero_escritura),
      escritura_dia_letras: antFecha.dia_letras,
      escritura_dia_num: antFecha.dia_num,
      escritura_mes: antFecha.mes,
      escritura_anio_letras: antFecha.anio_letras,
      escritura_anio_num: antFecha.anio_num,
      notaria_previa_numero: orBlank(titAnt.notaria_documento || ed.notaria_origen),
      notaria_previa_circulo: orBlank(titAnt.ciudad_documento),
    },

    // ── RPH ────────────────────────────────────────────────────────
    rph: {
      escritura_num_letras: PLACEHOLDER,
      escritura_num_numero: orBlank(inmueble.escritura_ph_numero),
      escritura_dia_letras: rphFecha.dia_letras,
      escritura_dia_num: rphFecha.dia_num,
      escritura_mes: rphFecha.mes,
      escritura_anio_letras: rphFecha.anio_letras,
      escritura_anio_num: rphFecha.anio_num,
      notaria_numero: orBlank(inmueble.escritura_ph_notaria),
      notaria_ciudad: orBlank(inmueble.escritura_ph_ciudad),
      matricula_matriz: orBlank(inmueble.matricula_matriz),
    },

    // ── Apoderado banco ────────────────────────────────────────────
    apoderado_banco: {
      nombre: orBlank(actos.apoderado_nombre),
      cedula: actos.apoderado_cedula
        ? formatCedulaLegal(actos.apoderado_cedula)
        : PLACEHOLDER,
      expedida_en: orBlank(actos.apoderado_expedida_en),
      escritura_poder_num: orBlank(actos.apoderado_escritura_poder),
      poder_dia_letras: PLACEHOLDER,
      poder_dia_num: PLACEHOLDER,
      poder_mes: PLACEHOLDER,
      poder_anio_letras: PLACEHOLDER,
      poder_anio_num: PLACEHOLDER,
      notaria_poder_num: orBlank(actos.apoderado_notaria_poder),
      notaria_poder_ciudad: orBlank(actos.apoderado_notaria_ciudad),
      email: orBlank(actos.apoderado_email),
    },
  };

  return data;
}

// ── Manual overrides ───────────────────────────────────────────────────

/**
 * Aplica `manualFieldOverrides` SOBRE el modelo consolidado, propagando
 * cada override a TODOS sus alias declarados en `docxFieldMap`.
 */
export function applyManualOverrides(
  data: ConsolidatedDocxData,
  overrides: Record<string, string>,
  fieldAliases: ReadonlyMap<string, ReadonlyArray<string>>,
): ConsolidatedDocxData {
  if (!overrides) return data;
  const out = JSON.parse(JSON.stringify(data)) as ConsolidatedDocxData;

  const setPath = (target: ConsolidatedDocxData, path: string, value: string): void => {
    const parts = path.split(".");
    let cur = target as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]] = value;
  };

  for (const [field, raw] of Object.entries(overrides)) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    const targets = new Set<string>([field, ...(fieldAliases.get(field) ?? [])]);
    for (const t of targets) setPath(out, t, v);
  }
  return out;
}

// ── Audit metadata ─────────────────────────────────────────────────────

/**
 * Inyecta metadata invisible para trazabilidad. Se agrega como propiedades
 * de primer nivel con el prefijo `__sertuss_*` para que docxtemplater no
 * intente renderizarlas (ningún tag de plantilla las referencia) pero
 * queden incluidas en el snapshot guardado en `logs_extraccion.data_final`.
 */
export interface AuditCtx {
  tramiteId: string;
  ts: string;
  pipelineVersion: string;
}
export function injectAuditMetadata(
  data: ConsolidatedDocxData,
  ctx: AuditCtx,
): ConsolidatedDocxData {
  return {
    ...data,
    __sertuss_tramite_id: ctx.tramiteId,
    __sertuss_generated_at: ctx.ts,
    __sertuss_pipeline_version: ctx.pipelineVersion,
  };
}

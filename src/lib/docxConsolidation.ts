/**
 * docxConsolidation — Fuente única de verdad para llenar el `.docx`.
 *
 * Construye el objeto `structuredData` que consume `docxtemplater` (descarga)
 * y `DocxPreview.buildReplacements` (visor). Garantiza que ambos caminos
 * vean los mismos valores: lo que se ve en pantalla es lo que se descarga.
 *
 * Orden de prioridad:
 *   1. manualFieldOverrides (aplicado por `applyManualOverrides`)
 *   2. Estado de UI actual (vendedores, compradores, inmueble, actos)
 *   3. templateData devuelto por process-expediente
 *   4. Carta de crédito (solo campos bancarios/hipotecarios)
 *   5. metadata.extracted_*  (OCR)
 *   6. "" (cadena vacía) — se sustituye por `___________` en
 *      `ensurePlaceholders()`, ÚLTIMO paso del pipeline (post-prosa).
 *
 * Reglas:
 *   - `getConsolidatedDocxData` jamás escribe `___________`. Devuelve "" o
 *     `null` cuando no hay dato.
 *   - `applyManualOverrides` propaga cada override a TODOS sus alias usando
 *     `DOCX_FIELD_MAP` automáticamente.
 *   - `ensurePlaceholders(data)` se ejecuta al final, después de hidratar
 *     prosa, para que el Word no muestre cadenas vacías.
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
import { DOCX_FIELD_MAP } from "@/lib/docxFieldMap";

/** Placeholder visible en el Word cuando no hay dato. */
export const PLACEHOLDER = "___________";

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
 * Detecta carta de crédito en metadata. Si existe, se considera la fuente
 * autoritativa para datos bancarios e hipotecarios vigentes.
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

/** Toma el primer valor no vacío. Devuelve "" si todos están vacíos. */
const firstNonEmpty = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = safe(v);
    if (s) return s;
  }
  return "";
};

/** Sólo aplica formato de moneda si hay valor; si no, devuelve "". */
const moneyOrEmpty = (v: unknown): string => {
  const s = safe(v);
  return s ? formatMonedaLegal(s) : "";
};
const moneyLettersOrEmpty = (v: unknown): string => {
  const s = safe(v);
  if (!s) return "";
  const formatted = formatMonedaLegal(s);
  return formatted.split("($")[0]?.trim() || "";
};

interface FechaParts {
  dia_letras: string;
  dia_num: string;
  mes: string;
  anio_letras: string;
  anio_num: string;
}
const emptyFecha: FechaParts = {
  dia_letras: "",
  dia_num: "",
  mes: "",
  anio_letras: "",
  anio_num: "",
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
    dia_letras: "", // hidratado por docxProsaHydrator
    dia_num: String(d),
    mes: MESES[m - 1] || "",
    anio_letras: "",
    anio_num: String(y),
  };
}

export interface PersonaDocxData {
  nombre: string;
  cedula: string;
  expedida_en: string;
  estado_civil: string;
  domicilio: string;
  direccion_residencia: string;
  telefono: string;
  actividad_economica: string;
  email: string;
  es_pep: boolean;
  acepta_notificaciones: boolean;
}

function mapPersona(p: Persona): PersonaDocxData {
  const cleanDir = sanitizeDireccion(p.direccion || "");
  const cleanEstado = sanitizeEstadoCivil(p.estado_civil || "", p.nombre_completo || "");
  // Acceso defensivo para campos opcionales que pueden venir desde la UI.
  const pAny = p as Persona & Record<string, unknown>;
  return {
    nombre: safe(p.nombre_completo),
    cedula: p.numero_cedula ? formatCedulaLegal(p.numero_cedula) : "",
    expedida_en: safe(p.lugar_expedicion),
    estado_civil: safe(cleanEstado),
    domicilio: safe(p.municipio_domicilio),
    direccion_residencia: safe(cleanDir),
    telefono: safe(pAny.telefono),
    actividad_economica: safe(pAny.actividad_economica),
    email: safe(pAny.email),
    es_pep: !!p.es_pep,
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

export interface InmuebleDocxData {
  matricula: string;
  matricula_inmobiliaria: string;
  cedula_catastral: string;
  chip: string;
  ubicacion: string;
  direccion: string;
  nombre_edificio_conjunto: string;
  inmueble_nombre: string;
  linderos_especiales: string;
  linderos_generales: string;
  orip_ciudad: string;
  orip_zona: string;
  coeficiente_letras: string;
  coeficiente_numero: string;
  nupre: string;
  estrato: string;
  es_rph: boolean;
  municipio: string;
  departamento: string;
  predial_anio: string;
  predial_num: string;
  predial_valor: string;
  idu_num: string; idu_fecha: string; idu_vigencia: string;
  admin_fecha: string; admin_vigencia: string;
}

export interface ActosDocxData {
  cuantia_compraventa_letras: string;
  cuantia_compraventa_numero: string;
  cuantia_hipoteca_letras: string;
  cuantia_hipoteca_numero: string;
  fecha_escritura_letras: string;
  entidad_bancaria: string;
  entidad_nit: string;
  entidad_domicilio: string;
  pago_inicial_letras: string;
  pago_inicial_numero: string;
  saldo_financiado_letras: string;
  saldo_financiado_numero: string;
  credito_dia_letras: string;
  credito_dia_num: string;
  credito_mes: string;
  credito_anio_letras: string;
  credito_anio_num: string;
  redam_resultado: string;
  afectacion_vivienda: boolean;
}

/**
 * Modelo consolidado tipado. Extiende `Record<string, unknown>` para que
 * `applyManualOverrides` pueda escribir alias arbitrarios sin romper tipos.
 */
export interface ConsolidatedDocxData extends Record<string, unknown> {
  // Notaría
  escritura_numero: string;
  fecha_escritura_corta: string;
  notario_nombre: string;
  notario_decreto: string;
  notario_tipo: string;
  notaria_numero: string;
  notaria_numero_letras: string;
  notaria_numero_letras_lower: string;
  notaria_numero_letras_femenino: string;
  notaria_ordinal: string;
  notaria_circulo: string;
  notaria_circulo_proper: string;
  notaria_departamento: string;
  // Flags
  has_ph: boolean;
  has_linderos: boolean;
  has_linderos_especiales: boolean;
  has_linderos_generales: boolean;
  has_hipoteca: boolean;
  has_credito: boolean;
  has_apoderado_banco: boolean;
  has_antecedente: boolean;
  has_afectacion_familiar: boolean;
  has_predial: boolean;
  has_coeficiente: boolean;
  has_carta_credito: boolean;
  tiene_hipoteca: boolean;
  afectacion_vivienda: boolean;
  // Personas
  vendedores: PersonaDocxData[];
  compradores: PersonaDocxData[];
  // Sub-objetos
  inmueble: InmuebleDocxData;
  actos: ActosDocxData;
  antecedentes: Record<string, string>;
  rph: Record<string, string>;
  apoderado_banco: Record<string, string>;
}

/**
 * Construye el modelo consolidado, devolviendo "" cuando NO hay dato.
 *
 * IMPORTANTE: este modelo NO contiene placeholders (`___________`). El
 * pipeline debe aplicar `hydrateProsa()` y luego `ensurePlaceholders()` al
 * final para sustituir cadenas vacías por la línea visible en el Word.
 */
export function getConsolidatedDocxData(input: ConsolidationInput): ConsolidatedDocxData {
  const {
    ui: { vendedores, compradores, inmueble, actos, notariaTramite },
    templateData,
    cartaCredito,
    ocr,
    formatoOrdinalNotaria = "volada",
  } = input;

  const linderosEspeciales = safe(inmueble.linderos_especiales) || safe(inmueble.linderos);
  const linderosGenerales = safe(inmueble.linderos_generales);

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
  const valorCredito = firstNonEmpty(cartaCredito?.valor_credito, actos.valor_hipoteca);
  const pagoInicial = firstNonEmpty(cartaCredito?.pago_inicial, actos.pago_inicial);
  const saldoFinanciado = firstNonEmpty(cartaCredito?.saldo_financiado, actos.saldo_financiado);
  const fechaCredito = firstNonEmpty(cartaCredito?.fecha_credito, actos.fecha_credito);

  const ed = ocr.extractedDocumento ?? {};
  const titAnt = (ed["titulo_antecedente"] ?? {}) as Record<string, unknown>;
  const antFecha = parseFechaParts(String(titAnt.fecha_documento ?? ed.fecha_documento ?? ""));
  const rphFecha = parseFechaParts(inmueble.escritura_ph_fecha || "");
  const creditoFecha = parseFechaParts(fechaCredito);

  const coefLetras = coeficienteToLetras(inmueble.coeficiente_copropiedad);

  const notariaNumeroLetrasBase =
    notariaTramite.numero_notaria_letras ||
    (notariaTramite.numero_notaria
      ? numeroNotariaToLetras(notariaTramite.numero_notaria)
      : "");

  const data: ConsolidatedDocxData = {
    // Notaría
    escritura_numero: "",
    fecha_escritura_corta: new Date().toLocaleDateString("es-CO"),
    notario_nombre: safe(notariaTramite.nombre_notario),
    notario_decreto: safe(notariaTramite.decreto_nombramiento),
    notario_tipo: notariaTramite.tipo_notario || "",
    notaria_numero: safe(notariaTramite.numero_notaria),
    notaria_numero_letras: notariaNumeroLetrasBase,
    notaria_numero_letras_lower: notariaNumeroLetrasBase
      ? notariaNumeroLetrasBase.toLowerCase()
      : "",
    notaria_numero_letras_femenino: (() => {
      if (!notariaNumeroLetrasBase) return "";
      const upper = notariaNumeroLetrasBase.toUpperCase();
      return upper.endsWith("O") ? upper.slice(0, -1) + "A" : upper;
    })(),
    notaria_ordinal:
      notariaTramite.numero_ordinal ||
      (notariaTramite.numero_notaria
        ? numeroToOrdinalAbbr(notariaTramite.numero_notaria, formatoOrdinalNotaria)
        : ""),
    notaria_circulo: safe(notariaTramite.circulo),
    notaria_circulo_proper: notariaTramite.circulo
      ? notariaTramite.circulo.toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase())
      : "",
    notaria_departamento: safe(notariaTramite.departamento),

    // Flags
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
    tiene_hipoteca: !!actos.es_hipoteca,
    afectacion_vivienda: !!actos.afectacion_vivienda_familiar,

    // Personas
    vendedores: vendedores.map(mapPersona),
    compradores: compradores.map(mapPersona),

    // Aliases root inmueble
    ubicacion_predio: safe(inmueble.direccion),
    ubicacion_inmueble: safe(inmueble.direccion),
    direccion_inmueble: safe(inmueble.direccion),
    matricula_inmobiliaria: safe(inmueble.matricula_inmobiliaria),
    matricula: safe(inmueble.matricula_inmobiliaria),
    cedula_catastral: safe(inmueble.identificador_predial),
    chip: safe(inmueble.identificador_predial),
    identificador_predial: safe(inmueble.identificador_predial),
    inmueble_nombre: safe(inmueble.nombre_edificio_conjunto),
    nombre_edificio_conjunto: safe(inmueble.nombre_edificio_conjunto),
    linderos_especiales: linderosEspeciales,
    linderos_generales: linderosGenerales,
    coeficiente_letras: coefLetras || "",
    coeficiente_numero: safe(inmueble.coeficiente_copropiedad),
    coeficiente_copropiedad: safe(inmueble.coeficiente_copropiedad),
    municipio_inmueble: safe(inmueble.municipio),
    departamento_inmueble: safe(inmueble.departamento),
    orip_ciudad: safe(inmueble.codigo_orip),

    // Aliases root banco
    entidad_bancaria: safe(bankNombre),
    entidad_nit: safe(bankNit),
    entidad_domicilio: safe(bankDomicilio),
    banco_nombre: safe(bankNombre),
    banco_nit: safe(bankNit),

    inmueble: {
      matricula: safe(inmueble.matricula_inmobiliaria),
      matricula_inmobiliaria: safe(inmueble.matricula_inmobiliaria),
      cedula_catastral: safe(inmueble.identificador_predial),
      chip: safe(inmueble.identificador_predial),
      ubicacion: safe(inmueble.direccion),
      direccion: safe(inmueble.direccion),
      nombre_edificio_conjunto: safe(inmueble.nombre_edificio_conjunto),
      inmueble_nombre: safe(inmueble.nombre_edificio_conjunto),
      linderos_especiales: linderosEspeciales,
      linderos_generales: linderosGenerales,
      orip_ciudad: safe(inmueble.codigo_orip),
      orip_zona: "",
      coeficiente_letras: coefLetras || "",
      coeficiente_numero: safe(inmueble.coeficiente_copropiedad),
      nupre: safe(inmueble.nupre),
      estrato: safe(inmueble.estrato),
      es_rph: !!inmueble.es_propiedad_horizontal,
      municipio: safe(inmueble.municipio),
      departamento: safe(inmueble.departamento),
      predial_anio: safe(ocr.extractedPredial?.anio_gravable),
      predial_num: safe(ocr.extractedPredial?.numero_recibo),
      predial_valor: ocr.extractedPredial?.valor_pagado
        ? formatMonedaLegal(String(ocr.extractedPredial.valor_pagado))
        : "",
      idu_num: "", idu_fecha: "", idu_vigencia: "",
      admin_fecha: "", admin_vigencia: "",
    },

    actos: {
      cuantia_compraventa_letras: moneyLettersOrEmpty(actos.valor_compraventa),
      cuantia_compraventa_numero: moneyOrEmpty(actos.valor_compraventa),
      cuantia_hipoteca_letras: moneyLettersOrEmpty(valorCredito),
      cuantia_hipoteca_numero: moneyOrEmpty(valorCredito),
      fecha_escritura_letras: "",
      entidad_bancaria: safe(bankNombre),
      entidad_nit: safe(bankNit),
      entidad_domicilio: safe(bankDomicilio),
      pago_inicial_letras: moneyLettersOrEmpty(pagoInicial),
      pago_inicial_numero: moneyOrEmpty(pagoInicial),
      saldo_financiado_letras: moneyLettersOrEmpty(saldoFinanciado),
      saldo_financiado_numero: moneyOrEmpty(saldoFinanciado),
      credito_dia_letras: creditoFecha.dia_letras,
      credito_dia_num: creditoFecha.dia_num,
      credito_mes: creditoFecha.mes,
      credito_anio_letras: creditoFecha.anio_letras,
      credito_anio_num: creditoFecha.anio_num,
      redam_resultado: "",
      afectacion_vivienda: !!actos.afectacion_vivienda_familiar,
    },

    antecedentes: {
      modo: safe(ed.modo_adquisicion),
      adquirido_de: safe(ed.adquirido_de),
      escritura_num_letras: "",
      escritura_num_numero: safe(titAnt.numero_documento || ed.numero_escritura),
      escritura_dia_letras: antFecha.dia_letras,
      escritura_dia_num: antFecha.dia_num,
      escritura_mes: antFecha.mes,
      escritura_anio_letras: antFecha.anio_letras,
      escritura_anio_num: antFecha.anio_num,
      notaria_previa_numero: safe(titAnt.notaria_documento || ed.notaria_origen),
      notaria_previa_circulo: safe(titAnt.ciudad_documento),
    },

    rph: {
      escritura_num_letras: "",
      escritura_num_numero: safe(inmueble.escritura_ph_numero),
      escritura_dia_letras: rphFecha.dia_letras,
      escritura_dia_num: rphFecha.dia_num,
      escritura_mes: rphFecha.mes,
      escritura_anio_letras: rphFecha.anio_letras,
      escritura_anio_num: rphFecha.anio_num,
      notaria_numero: safe(inmueble.escritura_ph_notaria),
      notaria_ciudad: safe(inmueble.escritura_ph_ciudad),
      matricula_matriz: safe(inmueble.matricula_matriz),
    },

    apoderado_banco: {
      nombre: safe(actos.apoderado_nombre),
      cedula: actos.apoderado_cedula ? formatCedulaLegal(actos.apoderado_cedula) : "",
      expedida_en: safe(actos.apoderado_expedida_en),
      escritura_poder_num: safe(actos.apoderado_escritura_poder),
      poder_dia_letras: "",
      poder_dia_num: "",
      poder_mes: "",
      poder_anio_letras: "",
      poder_anio_num: "",
      notaria_poder_num: safe(actos.apoderado_notaria_poder),
      notaria_poder_ciudad: safe(actos.apoderado_notaria_ciudad),
      email: safe(actos.apoderado_email),
    },
  };

  return data;
}

// ── Alias map automático ───────────────────────────────────────────────

/**
 * Construye el mapa `tag → [aliases...]` derivado de `DOCX_FIELD_MAP`.
 * Bidireccional: cada clave del par también recibe las demás como alias.
 */
export function buildAliasMap(): ReadonlyMap<string, ReadonlyArray<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const desc of DOCX_FIELD_MAP) {
    const all = [desc.tag, ...desc.aliases];
    for (const k of all) for (const o of all) link(k, o);
  }
  const out = new Map<string, ReadonlyArray<string>>();
  for (const [k, v] of map.entries()) out.set(k, Array.from(v));
  return out;
}

/** Cache singleton del alias map. */
const ALIAS_MAP_CACHE: ReadonlyMap<string, ReadonlyArray<string>> = buildAliasMap();

// ── Manual overrides ───────────────────────────────────────────────────

/**
 * Aplica `manualFieldOverrides` SOBRE el modelo consolidado, propagando
 * cada override a TODOS sus alias declarados en `DOCX_FIELD_MAP`.
 *
 * `fieldAliases` es opcional: si se omite, se usa el mapa derivado del
 * `DOCX_FIELD_MAP` (recomendado). Pasar uno custom solo para tests.
 */
export function applyManualOverrides(
  data: ConsolidatedDocxData,
  overrides: Record<string, string>,
  fieldAliases: ReadonlyMap<string, ReadonlyArray<string>> = ALIAS_MAP_CACHE,
): ConsolidatedDocxData {
  if (!overrides) return data;
  const out = JSON.parse(JSON.stringify(data)) as ConsolidatedDocxData;

  const setPath = (target: Record<string, unknown>, path: string, value: string): void => {
    const parts = path.split(".");
    let cur = target;
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
    for (const t of targets) setPath(out as Record<string, unknown>, t, v);
  }
  return out;
}

// ── Placeholders (último paso del pipeline) ────────────────────────────

/**
 * Recorre el modelo y sustituye toda cadena vacía por `___________`.
 * Booleans, números y arrays se preservan. Debe ejecutarse DESPUÉS de
 * `hydrateProsa()` para no enmascarar valores que la prosa hidrata más
 * tarde (montos en letras, días en letras, etc.).
 *
 * Las claves con prefijo `__sertuss_` (audit metadata) se preservan tal cual.
 */
export function ensurePlaceholders<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return (value.trim() === "" ? PLACEHOLDER : value) as unknown as T;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => ensurePlaceholders(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.startsWith("__sertuss_")) {
      out[k] = v;
      continue;
    }
    out[k] = ensurePlaceholders(v);
  }
  return out as unknown as T;
}

// ── Audit metadata ─────────────────────────────────────────────────────

export interface AuditCtx {
  tramiteId: string;
  ts: string;
  pipelineVersion: string;
}

/**
 * Inyecta metadata invisible para trazabilidad. Las claves `__sertuss_*`
 * son ignoradas por `ensurePlaceholders` y por docxtemplater (ningún tag
 * las referencia), pero quedan en el snapshot `logs_extraccion.data_final`.
 */
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

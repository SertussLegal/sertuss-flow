// Procesa una cancelación de hipoteca Davivienda:
// 1) Cobra 2 créditos
// 2) Llama a Gemini 2.5 Pro (Lovable AI Gateway) con los 2 PDFs (cert. tradición + escritura)
// 3) Rellena 2 plantillas .docx con Docxtemplater
// 4) Sube minutas a Storage y persiste en cancelaciones
//
// Modo "regen": si se envía { cancelacionId, regen: true } solo re-mapea las plantillas
// usando data_final, sin cobrar créditos ni llamar a Gemini.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import PizZip from "https://esm.sh/pizzip@3.1.6";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import { fetchAiGateway, AiGatewayError, parseToolCallArguments } from "../_shared/aiFetch.ts";
import { deudorTokens, apoderadoTokens, bancoTokens, inferGeneroFromNombre } from "../_shared/genero.ts";

// Envelope helper: 200 OK con { ok:false, code, message } para errores de negocio
function biz(code: string, message: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, code, message, ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET_PLANTILLAS = "cancelaciones-plantillas";
const BUCKET_OUTPUT = "expediente-files";
const PREFIX_DAVIVIENDA = "davivienda/";
const TEMPLATE_MINUTA = "formato cancelacion hipoteca blanqueado.docx";
const TEMPLATE_CERT = "CERTIFICADO can hipo blanqueado.docx";

// NO hay apoderado hardcodeado. Si no se carga el Poder General, los campos
// quedan undefined → nullGetter pinta "___________" en la antefirma.

interface NotariaEmisora {
  notario_nombre?: string;
  notaria_emisora_titulo?: string;
  notaria_emisora_numero?: string;
  notaria_emisora_ciudad?: string;
  notaria_resolucion?: string;
  notaria_fecha_resolucion?: string;
  numero_escritura_nueva?: string;
  fecha_otorgamiento_nueva?: string;
  derechos_notariales?: string;
  superintendencia?: string;
  fondo_nacional?: string;
  iva?: string;
  valor_acto?: string;
}

interface PoderBanco {
  apoderado_nombre?: string;
  apoderado_cedula?: string;
  apoderado_escritura?: string;
  apoderado_fecha?: string;
  apoderado_fecha_dia?: string;
  apoderado_fecha_mes?: string;
  apoderado_fecha_anio?: string;
  apoderado_notaria_poder?: string;
}

interface CancelacionData {
  hipoteca_anterior: {
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
    valor_hipoteca_es_indeterminada?: boolean;
  };
  inmueble: {
    matricula_inmobiliaria: string;
    // Compatibilidad legacy
    direccion_completa?: string;
    descripcion?: string;
    // Nuevos campos atómicos (preferidos)
    descripcion_predio?: string;
    nomenclatura_predio?: string;
    ciudad: string;
  };
  partes: {
    deudor_nombre: string;
    deudor_identificacion: string;
    deudor_tipo_id: string;
    banco_acreedor: string;
    banco_nit: string;
    deudor_genero?: "M" | "F" | "";
    tratamiento_entidad?: "M" | "F" | "";
  };
  analisis_legal: {
    aplica_ley_546: boolean;
    explicacion_ley: string;
  };
  notaria_emisora?: NotariaEmisora;
  poder_banco?: PoderBanco & { apoderado_genero?: "M" | "F" | "" };
}

const tools = [
  {
    type: "function" as const,
    function: {
      name: "extract_cancelacion_hipoteca",
      description: "Extrae los datos de cancelación de hipoteca a partir del Certificado de Tradición y Libertad, la Escritura Pública de constitución de hipoteca y (opcionalmente) el Poder General del banco.",
      parameters: {
        type: "object",
        properties: {
          hipoteca_anterior: {
            type: "object",
            properties: {
              numero_escritura_hipoteca: { type: "string", description: "Número de escritura en LETRAS Y NÚMEROS, ej: 'CUATRO MIL CIENTO SESENTA Y CINCO (4165)'" },
              fecha_escritura_hipoteca: { type: "string", description: "Fecha en LETRAS Y NÚMEROS, ej: 'NUEVE (09) DE OCTUBRE DE DOS MIL VEINTE (2020)'" },
              notaria_hipoteca: { type: "string", description: "Notaría en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y OCHO (38) DE BOGOTA D.C.'" },
              valor_hipoteca_original: { type: "string", description: "Monto del CRÉDITO HIPOTECARIO original que la entidad financiera concedió al deudor. ANCLAJE SINTÁCTICO OBLIGATORIO: la cifra DEBE estar gobernada gramaticalmente por un verbo rector del gravamen ('constituye', 'grava', 'hipoteca', 'garantiza', 'otorga garantía hipotecaria', 'presta', 'concede', 'desembolsa') sobre el mismo inmueble. La proximidad física no basta. LISTA NEGRA DE CONCEPTOS — IGNORA toda cifra cuyo sujeto sintáctico sea: 'precio de venta', 'valor de la compraventa', 'avalúo catastral', 'avalúo comercial', 'liberación de gravamen', 'subrogación', 'abono', 'saldo pendiente', 'subsidio', 'cesantías'. Si el párrafo menciona estos conceptos como referencia descriptiva pero el verbo rector apunta al mutuo, EXTRAE únicamente la cifra anclada al crédito (no descartes el párrafo completo). JERARQUÍA DE BÚSQUEDA: (a) MUTUO — el banco 'presta/otorga/concede/desembolsa/entrega'; (b) PAGO — el saldo de la compraventa se cubre con 'el producto del crédito que le concede [BANCO]'; (c) LIQUIDACIÓN — casillas anexas tipo 'CUANTÍA DEL MUTUO', 'VALOR DEL CRÉDITO', 'MONTO DEL PRÉSTAMO'. FALLBACK DE CUERPO: si la carátula/hoja de calificación no está, recorre cláusulas del cuerpo buscando 'CUANTÍA', 'GARANTÍA HIPOTECARIA', 'MUTUO HIPOTECARIO', 'VALOR DEL CRÉDITO' ancladas a la misma hipoteca. FORMATO: '<MONTO EN LETRAS> DE PESOS ($<NÚMERO CON PUNTOS DE MILES>)' en MAYÚSCULAS. CASOS ESPECIALES — Cuantía indeterminada / hipoteca abierta / sin límite de cuantía: devuelve cadena vacía '' en este campo y marca valor_hipoteca_es_indeterminada=true. ANTI-ALUCINACIÓN: si dos cifras compiten sin desambiguación posible, devuelve '' y valor_hipoteca_es_indeterminada=false. NUNCA inyectes literales descriptivos en este campo numérico — solo monto formateado o ''." },
              valor_hipoteca_es_indeterminada: { type: "boolean", description: "true SOLO si la hipoteca es declarada expresamente ABIERTA, SIN LÍMITE DE CUANTÍA, o de CUANTÍA INDETERMINADA. En cualquier otro caso (incluyendo monto desconocido, ambigüedad o falta de evidencia) devuelve false." },
            },
            required: ["numero_escritura_hipoteca", "fecha_escritura_hipoteca", "notaria_hipoteca", "valor_hipoteca_original"],
            additionalProperties: false,
          },
          inmueble: {
            type: "object",
            properties: {
              matricula_inmobiliaria: { type: "string", description: "Matrícula ESTRICTAMENTE alfanumérica con guión, ej: '50C-2085432'. SIN palabras en letras, SIN paréntesis." },
              descripcion_predio: { type: "string", description: "Identificación ARQUITECTÓNICA del predio en formato notarial corto, MAYÚSCULAS, con números en LETRAS seguidos del número entre paréntesis. Ej EXACTO: 'APARTAMENTO NUMERO MIL CUATROCIENTOS DOS (1402) TORRE DOS (2) QUE HACE PARTE DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL'. PROHIBIDO incluir áreas privadas/construidas/totales, metros cuadrados (M2), coeficiente de copropiedad (%), linderos, puntos cardinales, dimensiones ni nomenclatura urbana. Si encuentras ese contenido en los PDFs, descártalo." },
              nomenclatura_predio: { type: "string", description: "Dirección postal urbana del predio en formato notarial, MAYÚSCULAS. Ej EXACTO: 'CALLE 66 C NUMERO 60-65'. PROHIBIDO incluir apartamento/torre, ciudad, ni el sufijo '(DIRECCION CATASTRAL)' — el backend los agrega automáticamente." },
              ciudad: { type: "string", description: "Ciudad del inmueble en mayúsculas, ej: 'BOGOTA D.C.'" },
            },
            required: ["matricula_inmobiliaria", "descripcion_predio", "nomenclatura_predio", "ciudad"],
            additionalProperties: false,
          },
          partes: {
            type: "object",
            properties: {
              deudor_nombre: { type: "string", description: "Nombre completo del deudor en mayúsculas" },
              deudor_identificacion: { type: "string", description: "Número de identificación ESTRICTAMENTE NUMÉRICO con puntos de miles, ej: '1.018.440.535'. SIN letras." },
              deudor_tipo_id: { type: "string", description: "Tipo de identificación, ej: 'CEDULA DE CIUDADANIA'" },
              banco_acreedor: { type: "string", description: "Razón social del banco, normalmente 'BANCO DAVIVIENDA S.A.'" },
              banco_nit: { type: "string", description: "NIT ESTRICTAMENTE NUMÉRICO con puntos y guión, ej: '860.034.313-7'. SIN letras." },
            },
            required: ["deudor_nombre", "deudor_identificacion", "deudor_tipo_id", "banco_acreedor", "banco_nit"],
            additionalProperties: false,
          },
          analisis_legal: {
            type: "object",
            properties: {
              aplica_ley_546: { type: "boolean", description: "true si la hipoteca se constituyó conjuntamente con la compraventa de vivienda (Ley 546 de 1999)" },
              explicacion_ley: { type: "string", description: "Explicación detallada del análisis" },
            },
            required: ["aplica_ley_546", "explicacion_ley"],
            additionalProperties: false,
          },
          poder_banco: {
            type: "object",
            description: "SOLO si se adjuntó el Poder General del banco. Si no se adjuntó, OMITE este objeto completamente. Los datos suelen estar en las cláusulas finales del PDF.",
            properties: {
              apoderado_nombre: { type: "string", description: "Nombre completo del apoderado / representante legal en MAYÚSCULAS." },
              apoderado_cedula: { type: "string", description: "Cédula del apoderado, estrictamente numérica con puntos de miles, ej: '79.123.456'." },
              apoderado_escritura: { type: "string", description: "Número de escritura del poder en LETRAS Y NÚMEROS, ej: 'DOS MIL CUATROCIENTOS QUINCE (2415)'." },
              apoderado_fecha: { type: "string", description: "Fecha del poder en FORMATO NOTARIAL COMPLETO: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'." },
              apoderado_notaria_poder: { type: "string", description: "Notaría donde se otorgó el poder en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y DOS (32) DE BOGOTA D.C.'." },
            },
            additionalProperties: false,
          },
        },
        required: ["hipoteca_anterior", "inmueble", "partes", "analisis_legal"],
        additionalProperties: false,
      },
    },
  },
];

const SYSTEM_PROMPT = `Eres un asistente jurídico experto en derecho notarial colombiano especializado EXCLUSIVAMENTE en CANCELACIONES DE HIPOTECA de BANCO DAVIVIENDA S.A. Estas reglas aplican SOLO a esta sección (Cancelaciones); NO son reglas globales del sistema — otras secciones como Escrituras tienen sus propias reglas.

Recibes hasta tres documentos:
1. Certificado de Tradición y Libertad del inmueble.
2. Escritura Pública de Constitución de Hipoteca.
3. (Opcional) Poder General del banco a su apoderado — PDF de hasta 25 páginas.

REGLAS ESTRICTAS DE FORMATO:
- Toda escritura, notaría, valor y fecha debe expresarse en DOBLE EXPRESIÓN: LETRAS y NÚMEROS entre paréntesis.
- Las identificaciones (deudor_identificacion, banco_nit, apoderado_cedula) son ESTRICTAMENTE NUMÉRICAS con puntos de miles. NUNCA letras.
- La matrícula inmobiliaria es ESTRICTAMENTE alfanumérica con guión (ej: '50C-2085432'). SIN letras en palabras, SIN paréntesis.
- Texto siempre en MAYÚSCULAS para nombres, ciudades, notarías.
- aplica_ley_546 = true cuando la constitución de la hipoteca se otorga en la misma escritura pública que la compraventa de vivienda de interés social/prioritario o vivienda financiada.

REGLAS DE INMUEBLE PARA CANCELACIÓN (CRÍTICAS — NO APLICAN A ESCRITURAS):
Las cancelaciones de Davivienda NO requieren ni admiten linderos técnicos, medidas, áreas ni coeficientes. La Cláusula Primera solo remite al cuadro superior del Formulario SNR. Por eso:

- 'descripcion_predio': SOLO la identificación arquitectónica corta en formato notarial.
  ✅ CORRECTO: "APARTAMENTO NUMERO MIL CUATROCIENTOS DOS (1402) TORRE DOS (2) QUE HACE PARTE DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL"
  ❌ INCORRECTO: "APARTAMENTO 1402, PISO 14, TORRE 2 DEL CONJUNTO RESIDENCIAL SALITRE LIVING – PROPIEDAD HORIZONTAL, CON UN ÁREA PRIVADA CONSTRUIDA DE VEINTISÉIS PUNTO CINCUENTA METROS CUADRADOS (26.50 M2) Y UN ÁREA TOTAL CONSTRUIDA DE TREINTA PUNTO CERO CERO METROS CUADRADOS (30.00 M2), AL QUE LE CORRESPONDE UN COEFICIENTE DE COPROPIEDAD DE 0.069220% SOBRE LOS BIENES COMUNES. LINDEROS HORIZONTALES: ENTRE LOS PUNTOS 1 Y 2: LÍNEA RECTA..."
  → Aunque el PDF de la escritura traiga linderos, áreas y coeficientes, DESCÁRTALOS por completo. Nunca los incluyas en 'descripcion_predio'.

- 'nomenclatura_predio': SOLO la dirección postal corta.
  ✅ CORRECTO: "CALLE 66 C NUMERO 60-65"
  ❌ INCORRECTO: "CALLE 66 C NUMERO 60-65, APARTAMENTO 1402 (DIRECCION CATASTRAL) DE LA CIUDAD Y/O MUNICIPIO DE BOGOTA D.C."
  → NO añadas '(DIRECCION CATASTRAL)', NO añadas la ciudad, NO añadas apartamento ni torre. El backend los inyecta una sola vez.

PODER GENERAL DEL BANCO (cuando se adjunte):
- ANALIZA TODAS LAS PÁGINAS del PDF, incluyendo las finales. La cláusula de designación del apoderado suele estar al final del documento.
- Palabras clave para localizar al apoderado: 'CONFIERE PODER', 'APODERADO', 'REPRESENTANTE LEGAL', 'OTORGA PODER GENERAL', 'FACULTA A', 'ESCRITURA PÚBLICA No.', 'NOTARÍA'.
- Devuelve la fecha del poder en formato notarial completo: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'.
- Si NO se adjuntó el Poder o no logras localizar los datos con certeza, OMITE COMPLETAMENTE el objeto 'poder_banco' (no lo devuelvas vacío).

REGLA CRÍTICA — VALOR DEL CRÉDITO HIPOTECARIO (anti-alucinación, lógica semántica + type safety):

Las escrituras notariales colombianas varían radicalmente de formato y posición. NO asumas que el valor aparece en la misma página, tabla o coordenada. Aplica análisis contextual basado en el SIGNIFICADO.

ANCLAJE SINTÁCTICO OBLIGATORIO: la cifra que extraigas DEBE estar gobernada gramaticalmente por un verbo rector del gravamen sobre el mismo inmueble: 'constituye', 'grava', 'hipoteca', 'garantiza', 'otorga garantía hipotecaria', 'presta', 'concede', 'desembolsa', 'entrega'. La proximidad física a la palabra 'hipoteca' NO basta — necesitas la relación verbo→monto.

LISTA NEGRA DE CONCEPTOS (ignora el monto, NO el párrafo completo): si la cifra está sintácticamente ligada a 'precio de venta', 'valor de la compraventa', 'avalúo catastral', 'avalúo comercial', 'liberación de gravamen', 'subrogación', 'abono', 'saldo pendiente', 'subsidio' o 'cesantías', DESCÁRTALA. Si el mismo párrafo trae además una cifra anclada al mutuo, extrae solo esa.

JERARQUÍA SEMÁNTICA (en orden):
  1. MUTUO: el banco "presta / otorga / concede / desembolsa / entrega" una suma al deudor.
  2. PAGO: "el saldo del precio se cubre con el producto del crédito que le concede [BANCO] por valor de …".
  3. LIQUIDACIÓN: casilla anexa "CUANTÍA DEL MUTUO", "VALOR DEL CRÉDITO", "MONTO DEL PRÉSTAMO".

FALLBACK DE CUERPO: si la carátula / hoja de calificación no aparece, recorre las cláusulas del cuerpo buscando los términos 'CUANTÍA', 'GARANTÍA HIPOTECARIA', 'MUTUO HIPOTECARIO', 'VALOR DEL CRÉDITO' ancladas a la misma hipoteca.

CONTRATO DE SALIDA (TYPE-SAFE — CRÍTICO):
- Si encuentras un monto válido anclado al mutuo → 'valor_hipoteca_original' = "<LETRAS> DE PESOS ($<NÚMEROS>)" y 'valor_hipoteca_es_indeterminada' = false.
- Si la hipoteca es ABIERTA / SIN LÍMITE DE CUANTÍA / DE CUANTÍA INDETERMINADA → 'valor_hipoteca_original' = "" (cadena vacía, NUNCA inyectes literales en el campo de monto) y 'valor_hipoteca_es_indeterminada' = true.
- Si hay dos cifras candidatas ambiguas y no puedes desambiguar → 'valor_hipoteca_original' = "" y 'valor_hipoteca_es_indeterminada' = false. Siempre es preferible que el notario complete manualmente a que el documento salga con cuantía incorrecta (rechazo de calificación registral).

PROHIBIDO ABSOLUTO: copiar el precio de la compraventa, el avalúo, el abono parcial, el saldo pendiente, o cualquier monto que no esté inequívocamente gobernado por un verbo rector del crédito.

Llama SIEMPRE a la herramienta extract_cancelacion_hipoteca.`;

// Helpers
function splitValor(valor: string): { letras: string; numeros: string } {
  if (!valor) return { letras: "", numeros: "" };
  const m = valor.match(/^(.*?)\s*\(\$?\s*([\d.,]+)\s*\)\s*$/);
  if (m) return { letras: m[1].trim(), numeros: m[2].trim() };
  return { letras: valor, numeros: "" };
}
function extractCorto(s: string): string {
  if (!s) return "";
  const m = s.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : s;
}
function extractCiudadFromNotaria(s: string): string {
  if (!s) return "";
  const m = s.match(/\bDE\s+(.+)$/i);
  return m ? m[1].trim() : "";
}
function extractAno(s: string): string {
  if (!s) return "";
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

const MESES_NUM: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", setiembre: "09",
  octubre: "10", noviembre: "11", diciembre: "12",
};

function parseFechaParts(s: string): { dia: string; mes: string; ano: string } {
  if (!s) return { dia: "", mes: "", ano: "" };
  const dia = (s.match(/\((\d{1,2})\)/)?.[1] ?? "").padStart(2, "0");
  let mes = "";
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(MESES_NUM)) {
    if (lower.includes(k)) { mes = v; break; }
  }
  const ano = extractAno(s);
  if (!dia || !mes) {
    const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      return {
        dia: m[1].padStart(2, "0"),
        mes: m[2].padStart(2, "0"),
        ano: m[3].length === 2 ? `20${m[3]}` : m[3],
      };
    }
  }
  return { dia, mes, ano };
}

function extractNotariaNumero(s: string): string {
  if (!s) return "";
  return s.match(/\((\d{1,3})\)/)?.[1] ?? s.match(/\b(\d{1,3})\b/)?.[1] ?? "";
}

// Formatea un valor numérico/letra a "$48.200.000,00" si detecta dígitos
function formatValorPesos(s: string): string {
  if (!s) return "";
  const numStr = (s.match(/[\d.,]+/g) || []).pop() || "";
  const digits = numStr.replace(/[^\d]/g, "");
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return `$${n.toLocaleString("es-CO").replace(/,/g, ".")},00`;
}

// Sanea la matrícula: deja solo dígitos, letras y guiones.
// Acepta "50C-2085432", "50-2085432". Si no encaja en formato esperado → undefined.
function sanitizeMatricula(raw?: string): string | undefined {
  if (!raw) return undefined;
  const clean = String(raw)
    .replace(/[()]/g, " ")
    .replace(/\bDOSCIENTOS\b|\bMIL\b|\bCINCUENTA\b|\bCIENTO\b|\bCUARENTA\b|\bSESENTA\b|\bSETENTA\b|\bOCHENTA\b|\bNOVENTA\b|\bTREINTA\b|\bVEINTE\b|\bDIEZ\b|\bUNO\b|\bDOS\b|\bTRES\b|\bCUATRO\b|\bCINCO\b|\bSEIS\b|\bSIETE\b|\bOCHO\b|\bNUEVE\b|\bQUINIENTOS\b|\bSEISCIENTOS\b|\bSETECIENTOS\b|\bOCHOCIENTOS\b|\bNOVECIENTOS\b|\bCUATROCIENTOS\b|\bTRESCIENTOS\b|\bMILLON(?:ES)?\b/gi, " ")
    .replace(/[^0-9A-Za-z-]/g, "")
    .toUpperCase();
  // Patrón esperado: opcional prefijo (1-3 digits + letra opcional) + guión + dígitos
  const m = clean.match(/(\d{1,4}[A-Z]?)-?(\d{3,})/);
  if (!m) return clean || undefined;
  return `${m[1]}-${m[2]}`;
}

// Anti-duplicación: si "haystack" ya contiene "needle" como palabra, no concatena.
function joinSinDuplicar(haystack: string, separador: string, needle: string): string {
  if (!needle) return haystack;
  if (!haystack) return needle;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
  if (re.test(haystack)) return haystack;
  return `${haystack}${separador}${needle}`;
}

// ──────────────────────────────────────────────────────────────────────
// FASE 2 — Helpers locales para Deno (réplica de src/lib/legalFormatters
// y legalProse, ya que Deno no puede importar de src/lib/...).
// ──────────────────────────────────────────────────────────────────────

// Corrige typos endémicos del OCR colombiano. Tabla extensible.
function fixOcrTypos(s: string): string {
  if (!s) return s;
  return s.replace(/\bCUNDINAMRCA\b/gi, "CUNDINAMARCA");
}

const _UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const _TEENS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const _TENS = ["", "diez", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const _HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function _convertGroupLegal(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  if (n < 10) return _UNITS[n];
  if (n < 20) return _TEENS[n - 10];
  if (n < 30) return n === 20 ? "veinte" : `veinti${_UNITS[n % 10]}`;
  if (n < 100) {
    const t = Math.floor(n / 10), u = n % 10;
    return u === 0 ? _TENS[t] : `${_TENS[t]} y ${_UNITS[u]}`;
  }
  const h = Math.floor(n / 100), rest = n % 100;
  if (h === 1 && rest === 0) return "cien";
  return rest === 0 ? _HUNDREDS[h] : `${_HUNDREDS[h]} ${_convertGroupLegal(rest)}`;
}

function numberToWordsLegal(num: number): string {
  if (num === 0) return "cero";
  const groups: [number, string, string][] = [
    [1_000_000_000, "mil millones", "mil millones"],
    [1_000_000, "millón", "millones"],
    [1_000, "mil", "mil"],
    [1, "", ""],
  ];
  let result = "";
  let remaining = num;
  for (const [divisor, singular, plural] of groups) {
    const q = Math.floor(remaining / divisor);
    remaining = remaining % divisor;
    if (q === 0) continue;
    if (divisor === 1) {
      result += ` ${_convertGroupLegal(q)}`;
    } else if (q === 1) {
      result += divisor === 1000 ? ` mil` : ` un ${singular}`;
    } else {
      result += ` ${_convertGroupLegal(q)} ${plural}`;
    }
  }
  return result.trim();
}

const _FEM_ORD_1_10: Record<number, string> = {
  1: "ÚNICA", 2: "SEGUNDA", 3: "TERCERA", 4: "CUARTA", 5: "QUINTA",
  6: "SEXTA", 7: "SÉPTIMA", 8: "OCTAVA", 9: "NOVENA", 10: "DÉCIMA",
};
function masculinoAFemenino(words: string): string {
  let out = words;
  out = out.replace(/\bveintiun[oó]?\b/gi, "veintiuna");
  out = out.replace(/\b(y)\s+un(o)?\b/gi, "$1 una");
  out = out.replace(/(^|\s)un(o)?$/i, "$1una");
  return out;
}

// Idempotencia: si ya viene "<algo> (NNN)" o "($NNN...)", no re-envolver.
const ALREADY_FORMATTED_RE = /\([\d.\s$,]+\)\s*$/;

function numeroConLetras(n: number | string, gender: "masculine" | "feminine" = "masculine"): string {
  if (typeof n === "string" && ALREADY_FORMATTED_RE.test(n.trim())) return n.trim();
  const num = typeof n === "string" ? parseInt(n.replace(/\D/g, ""), 10) : n;
  if (!Number.isFinite(num) || num <= 0) return "";
  if (gender === "feminine" && num >= 1 && num <= 10) {
    return `${_FEM_ORD_1_10[num]} (${num})`;
  }
  let words = numberToWordsLegal(num);
  if (gender === "feminine") words = masculinoAFemenino(words);
  return `${words.toLocaleUpperCase("es-CO")} (${num})`;
}

const _MESES_PROSA = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Fecha en prosa MAYÚSCULAS para protocolo. Idempotente.
function fechaProsaUpper(fecha: string): string {
  if (!fecha) return "";
  const trimmed = fecha.trim();
  if (ALREADY_FORMATTED_RE.test(trimmed) && /[A-Za-zÁÉÍÓÚáéíóú]/.test(trimmed)) {
    return trimmed.toLocaleUpperCase("es-CO");
  }
  let dia: number, mes: number, anio: number;
  const ymd = trimmed.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  const dmy = trimmed.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})$/);
  if (ymd) { anio = parseInt(ymd[1], 10); mes = parseInt(ymd[2], 10); dia = parseInt(ymd[3], 10); }
  else if (dmy) { dia = parseInt(dmy[1], 10); mes = parseInt(dmy[2], 10); anio = parseInt(dmy[3], 10); }
  else return "";
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return "";
  return `${numeroConLetras(dia)} DE ${_MESES_PROSA[mes - 1].toUpperCase()} DE ${numeroConLetras(anio)}`;
}

// formatMonedaLegal idéntica al frontend (preserva ",00" + "M/CTE").
function formatMonedaLegal(valor: string): string {
  if (!valor) return "";
  const cleaned = valor.replace(/[$.\s]/g, "").replace(/,\d{2}$/, "").replace(/,/g, "");
  const num = parseInt(cleaned, 10);
  if (!Number.isFinite(num) || num <= 0) return "";
  const words = numberToWordsLegal(num).toUpperCase();
  const formatted = num.toLocaleString("es-CO").replace(/,/g, ".");
  return `${words} DE PESOS M/CTE ($${formatted},00)`;
}

// Monto para protocolo: reusa formatMonedaLegal y elimina ",00)" si decimales = 0.
// Resultado: "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)". Idempotente.
function montoProsaProtocolo(valor: string | number | undefined | null): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const raw = typeof valor === "number" ? String(valor) : valor;
  if (typeof raw === "string" && /\(\$[\d.,]+\)\s*$/.test(raw.trim())) return raw.trim();
  const formateado = formatMonedaLegal(raw);
  if (!formateado) return "";
  // Escape correcto del paréntesis de cierre.
  return formateado.replace(/,00\)$/, ")");
}

// Inyección PH: cláusula intercalada ", bajo el régimen de PROPIEDAD HORIZONTAL,".
// Idempotente (no duplica si ya existe).
const _PH_TOKENS = /\b(APARTAMENTO|APTO|TORRE|CONJUNTO|GARAJE|DEP[OÓ]SITO|BLOQUE|CUARTO\s+[UÚ]TIL|UNIDAD\s+PRIVADA)\b/i;
function inyectarRegimenPH(descripcion: string): string {
  if (!descripcion) return descripcion;
  if (/PROPIEDAD\s+HORIZONTAL/i.test(descripcion)) return descripcion;
  if (!_PH_TOKENS.test(descripcion)) return descripcion;
  const limpio = descripcion.replace(/[\s.,;:–\-]+$/g, "");
  return `${limpio}, bajo el régimen de PROPIEDAD HORIZONTAL,`;
}

// Build the variable map sent to Docxtemplater
function buildDocxVars(data: CancelacionData) {
  const valorRaw = (data.hipoteca_anterior.valor_hipoteca_original || "").trim();
  const esIndeterminadaIA = data.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
  // Tolerancia retro: si una versión vieja inyectó el literal en el campo de monto, lo normalizamos al flag.
  const esIndeterminadaLegacy = /HIPOTECA\s+DE\s+CUANT[IÍ]A\s+INDETERMINADA/i.test(valorRaw);
  const esCuantiaIndeterminada = esIndeterminadaIA || esIndeterminadaLegacy;
  const valor = esCuantiaIndeterminada ? { letras: "", numeros: "" } : splitValor(valorRaw);
  // Type safety: campo de monto SIEMPRE numérico/formateado o undefined. Nunca literal de estado.
  const valorHipotecaMonto: string | undefined = esCuantiaIndeterminada
    ? undefined
    : (valorRaw || undefined);
  const ciudadHipoteca = extractCiudadFromNotaria(data.hipoteca_anterior.notaria_hipoteca || "");
  const ne = data.notaria_emisora || {};
  const pb = data.poder_banco || {};
  const fp = parseFechaParts(data.hipoteca_anterior.fecha_escritura_hipoteca || "");
  const fpPoder = parseFechaParts(pb.apoderado_fecha || "");
  const notariaOrigenNum = extractNotariaNumero(data.hipoteca_anterior.notaria_hipoteca || "");


  // Motor de flexión de género gramatical (módulo compartido _shared/genero.ts).
  // Prioridad: campo manual del frontend > inferencia por nombre > combinado notarial.
  const generoDeudor = data.partes.deudor_genero || inferGeneroFromNombre(data.partes.deudor_nombre || "") || "";
  const generoApoderado = pb.apoderado_genero || inferGeneroFromNombre(pb.apoderado_nombre || "") || "";
  const tratamientoBanco = data.partes.tratamiento_entidad || "";
  const tokensDeudor = deudorTokens(generoDeudor);
  const tokensApoderado = apoderadoTokens(generoApoderado);
  const tokensBanco = bancoTokens(tratamientoBanco);

  // valor_acto (cuadro SNR): respeta override manual. Si Ley 546 y hay valor, lo formatea.
  // Si está vacío o es cuantía indeterminada → undefined → nullGetter pinta "___________".
  const valorActoFinal = ne.valor_acto?.trim()
    ? ne.valor_acto
    : (data.analisis_legal.aplica_ley_546 && !esCuantiaIndeterminada && valorRaw)
      ? `----------------------------------------------------------------------------- ${formatValorPesos(valorRaw) || valor.numeros || ""}`.trim()
      : "";

  // Inmueble (CANCELACIÓN): segmentación estricta — sin linderos, sin áreas, sin coeficientes.
  // FASE 2: sufijo "(DIRECCION CATASTRAL)" SOLO si la ciudad es Bogotá (formato SNR capital).
  // Para Villeta, Girardot y cualquier otro municipio, se omite.
  const ciudadInmueble = fixOcrTypos((data.inmueble.ciudad || "").trim());
  const ciudadNorm = ciudadInmueble
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().trim();
  const esBogota = /^BOGOTA(\s|,|\.|$|D)/i.test(ciudadNorm);

  // Red de seguridad determinista: aunque Gemini se desborde, descartamos áreas,
  // linderos y coeficientes en el servidor antes de mapear a la plantilla.
  const descripcionPredioBase = (data.inmueble.descripcion_predio ?? data.inmueble.descripcion ?? "")
    .replace(/(?:CON\s+UN\s+[ÁA]REA|[ÁA]REA\s+(?:PRIVADA|CONSTRUIDA|TOTAL)|LINDEROS?\s+(?:HORIZONTALES?|T[EÉ]CNICOS?|GENERALES?|VERTICALES?)|COEFICIENTE\s+DE\s+COPROPIEDAD|ENTRE\s+LOS\s+PUNTOS).*$/i, "")
    .replace(/[\s,;.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Inyección de régimen PH como cláusula intercalada notarial (Ley 675 de 2001).
  const descripcionPredio = inyectarRegimenPH(fixOcrTypos(descripcionPredioBase));

  let nomenclaturaBase = (data.inmueble.nomenclatura_predio ?? data.inmueble.direccion_completa ?? "").trim();
  // FASE 2: limpieza estricta en este orden:
  //  1) fixOcrTypos  2) quitar sufijo catastral pre-existente (lo re-inyectamos sólo si Bogotá)
  //  3) colapsar coletilla "DE LA CIUDAD Y/O MUNICIPIO ..." final, incluso TRUNCADA en seco.
  nomenclaturaBase = fixOcrTypos(nomenclaturaBase)
    .replace(/\s*\(?\s*DIRECCI[OÓ]N\s+CATASTRAL\s*\)?/gi, "")
    // Regex tolerante: la cola "DE ..." final es opcional (cubre los 3 residuos OCR reales)
    .replace(/\s+DE\s+LA\s+CIUDAD\s+Y[\s\/]*O\s+MUNICIPIO(?:\s+DE\s+.+)?\s*$/i, "")
    .replace(/[\s,;.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const departamentoInmueble = fixOcrTypos(((data.inmueble as Record<string, string>).departamento || "").trim().toUpperCase());
  const coletillaCiudad = ciudadInmueble
    ? ` DE LA CIUDAD Y/O MUNICIPIO DE ${ciudadInmueble.toUpperCase()}${departamentoInmueble ? ` DEPARTAMENTO DE ${departamentoInmueble}` : ""}`
    : "";
  const nomenclaturaFinal = nomenclaturaBase
    ? (esBogota
        ? `${nomenclaturaBase} (DIRECCION CATASTRAL)${coletillaCiudad}`
        : `${nomenclaturaBase}${coletillaCiudad}`)
    : undefined;

  // Notaría origen: typos OCR + anti-duplicación "BOGOTA D.C. DEL BOGOTA D.C."
  const notariaHipotecaSanitizada = (() => {
    const fixed = fixOcrTypos(data.hipoteca_anterior.notaria_hipoteca || "");
    if (!ciudadInmueble) return fixed;
    return fixed.replace(new RegExp(`\\b${ciudadInmueble}\\b\\s+DEL?\\s+\\b${ciudadInmueble}\\b`, "gi"), ciudadInmueble);
  })();

  // FASE 2 — Capa protocolo TEXTO (NÚMERO). Idempotente, con género gramatical.
  // Heurística "ÚNICA": si el nombre/título contiene la palabra, forzamos número 1 femenino.
  const _esNotariaUnica = (s?: string) => !!s && /\b[ÚU]?NICA\b/i.test(s);
  const notariaHipotecaNumLetras = _esNotariaUnica(notariaHipotecaSanitizada)
    ? numeroConLetras(1, "feminine")
    : numeroConLetras(notariaOrigenNum || "", "feminine");
  const notariaEmisoraNumLetras = _esNotariaUnica(ne.notaria_emisora_titulo || ne.notario_nombre || "")
    ? numeroConLetras(1, "feminine")
    : numeroConLetras(ne.notaria_emisora_numero || "", "feminine");
  const escrituraHipotecaNumLetras = numeroConLetras(
    extractCorto(data.hipoteca_anterior.numero_escritura_hipoteca || "") || data.hipoteca_anterior.numero_escritura_hipoteca || "",
    "masculine",
  );
  const escrituraNuevaNumLetras = numeroConLetras(
    extractCorto(ne.numero_escritura_nueva || "") || ne.numero_escritura_nueva || "",
    "masculine",
  );
  const fechaEscrituraHipotecaLetras = fechaProsaUpper(data.hipoteca_anterior.fecha_escritura_hipoteca || "");
  const fechaOtorgamientoNuevaLetras = fechaProsaUpper(ne.fecha_otorgamiento_nueva || "");
  const apoderadoFechaLetras = fechaProsaUpper(pb.apoderado_fecha || "");
  const valorHipotecaProtocolo = esCuantiaIndeterminada ? undefined : (montoProsaProtocolo(valorRaw) || undefined);


  return {
    // Hipoteca anterior
    numero_escritura_hipoteca: data.hipoteca_anterior.numero_escritura_hipoteca,
    numero_escritura_hipoteca_corto: extractCorto(data.hipoteca_anterior.numero_escritura_hipoteca),
    fecha_escritura_hipoteca: data.hipoteca_anterior.fecha_escritura_hipoteca,
    fecha_escritura_hipoteca_cont: "",
    fecha_escritura_hipoteca_dia: fp.dia || undefined,
    fecha_escritura_hipoteca_mes: fp.mes || undefined,
    fecha_escritura_hipoteca_ano: fp.ano || extractAno(data.hipoteca_anterior.fecha_escritura_hipoteca) || undefined,
    notaria_hipoteca: notariaHipotecaSanitizada,
    notaria_hipoteca_numero: notariaOrigenNum || undefined,
    ciudad_hipoteca: ciudadHipoteca,
    ciudad_hipoteca_corto: ciudadHipoteca,
    valor_hipoteca_original: valorHipotecaMonto,
    valor_hipoteca_letras: valor.letras || undefined,
    valor_hipoteca_numeros: valor.numeros || undefined,
    valor_hipoteca_es_indeterminada: esCuantiaIndeterminada || undefined,
    // Inmueble (atómico)
    matricula_inmobiliaria: sanitizeMatricula(data.inmueble.matricula_inmobiliaria) || undefined,
    descripcion_predio: descripcionPredio || undefined,
    nomenclatura_predio: nomenclaturaFinal,
    // Compatibilidad retro con plantillas antiguas
    direccion_inmueble: nomenclaturaFinal,
    direccion_inmueble_cont: "",
    ciudad_inmueble: ciudadInmueble || undefined,
    descripcion_inmueble: descripcionPredio || undefined,
    // Partes
    deudor_nombre: data.partes.deudor_nombre,
    deudor_identificacion: data.partes.deudor_identificacion,
    deudor_tipo_id: data.partes.deudor_tipo_id,
    banco_acreedor: data.partes.banco_acreedor,
    banco_nit: data.partes.banco_nit,
    // Ley 546
    aplica_ley_546: data.analisis_legal.aplica_ley_546,
    // Apoderado dinámico (sin hardcode). undefined → nullGetter → "___________"
    apoderado_nombre: pb.apoderado_nombre || undefined,
    apoderado_cedula: pb.apoderado_cedula || undefined,
    apoderado_escritura: pb.apoderado_escritura || undefined,
    apoderado_fecha: pb.apoderado_fecha || undefined,
    apoderado_fecha_dia: pb.apoderado_fecha_dia || fpPoder.dia || undefined,
    apoderado_fecha_mes: pb.apoderado_fecha_mes || fpPoder.mes || undefined,
    apoderado_fecha_ano: pb.apoderado_fecha_anio || fpPoder.ano || undefined,
    apoderado_notaria_poder: pb.apoderado_notaria_poder || undefined,
    // Notario emisor (editable; vacío → nullGetter "___________")
    notario_nombre: ne.notario_nombre || undefined,
    notaria_emisora_titulo: ne.notaria_emisora_titulo || undefined,
    notaria_emisora_numero: ne.notaria_emisora_numero || undefined,
    notaria_emisora_ciudad: ne.notaria_emisora_ciudad || undefined,
    notaria_resolucion: ne.notaria_resolucion || undefined,
    notaria_fecha_resolucion: ne.notaria_fecha_resolucion || undefined,
    // Escritura NUEVA (tabla SNR encabezado) → undefined fuerza líneas en blanco
    numero_escritura_nueva: ne.numero_escritura_nueva || undefined,
    numero_escritura_nueva_corto: extractCorto(ne.numero_escritura_nueva || "") || undefined,
    numero_escritura_nueva_letras: (ne as Record<string, string>).numero_escritura_nueva_letras || undefined,
    fecha_otorgamiento_nueva: ne.fecha_otorgamiento_nueva || undefined,
    fecha_otorgamiento_nueva_dia: parseFechaParts(ne.fecha_otorgamiento_nueva || "").dia || undefined,
    fecha_otorgamiento_nueva_mes: parseFechaParts(ne.fecha_otorgamiento_nueva || "").mes || undefined,
    fecha_otorgamiento_nueva_ano: parseFechaParts(ne.fecha_otorgamiento_nueva || "").ano || undefined,
    fecha_otorgamiento_nueva_letras: (ne as Record<string, string>).fecha_otorgamiento_nueva_letras || undefined,
    fecha_otorgamiento_nueva_cont: "",
    // Liquidación notarial → undefined fuerza nullGetter para mantener líneas
    derechos_notariales: ne.derechos_notariales || undefined,
    superintendencia: ne.superintendencia || undefined,
    fondo_nacional: ne.fondo_nacional || undefined,
    iva: ne.iva || undefined,
    valor_acto: valorActoFinal || undefined,
    // Tokens de flexión de género gramatical (motor compartido)
    ...tokensDeudor,
    ...tokensApoderado,
    ...tokensBanco,
  };
}

async function fillTemplate(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
  vars: Record<string, unknown>,
): Promise<Uint8Array> {
  const { data: blob, error } = await supabase.storage
    .from(BUCKET_PLANTILLAS)
    .download(`${PREFIX_DAVIVIENDA}${templateName}`);
  if (error || !blob) throw new Error(`No se pudo descargar plantilla ${templateName}: ${error?.message}`);

  const buf = new Uint8Array(await blob.arrayBuffer());
  const zip = new PizZip(buf);
  // Campos "atómicos" en celdas de tabla angostas: si están vacíos, usamos un guion
  // corto en lugar de la línea larga "___________" que deforma la tabla.
  const SLIM_FIELDS = new Set([
    "fecha_escritura_hipoteca_dia",
    "fecha_escritura_hipoteca_mes",
    "fecha_escritura_hipoteca_ano",
    "notaria_hipoteca_numero",
    "ciudad_hipoteca_corto",
    "numero_escritura_hipoteca_corto",
    // Tabla SNR (escritura nueva) — celdas angostas
    "numero_escritura_nueva_corto",
    "fecha_otorgamiento_nueva_dia",
    "fecha_otorgamiento_nueva_mes",
    "fecha_otorgamiento_nueva_ano",
    "notaria_emisora_numero",
  ]);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part: { value?: string }) =>
      part?.value && SLIM_FIELDS.has(part.value) ? "—" : "___________",
  });
  doc.render(vars);
  const out = doc.getZip().generate({ type: "uint8array" });
  return out;
}

async function createSignedStorageUrl(
  supabase: ReturnType<typeof createClient>,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_OUTPUT)
    .createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) throw new Error(`No se pudo firmar PDF ${path}: ${error?.message}`);
  return data.signedUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsErr || !claimsData?.claims?.sub) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = claimsData.claims.sub as string;

  let body: {
    cancelacionId?: string;
    certificadoPath?: string;
    certificadoImagePaths?: string[];
    escrituraPath?: string;
    escrituraImagePaths?: string[];
    poderPath?: string;
    poderImagePaths?: string[];
    regen?: boolean;
    manualOverrides?: CancelacionData;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { cancelacionId, certificadoPath, certificadoImagePaths, escrituraPath, escrituraImagePaths, poderPath, poderImagePaths, regen, manualOverrides } = body;
  if (!cancelacionId) {
    return new Response(JSON.stringify({ error: "cancelacionId requerido" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load cancelación + verify org
  const { data: cancRow, error: cancErr } = await supabaseService
    .from("cancelaciones")
    .select("*")
    .eq("id", cancelacionId)
    .maybeSingle();
  if (cancErr || !cancRow) {
    return new Response(JSON.stringify({ error: "Cancelación no encontrada" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgId = cancRow.organization_id as string;

  // Verify user is member of org
  const { data: membership } = await supabaseService
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!membership) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ─────────────────────────────────────────────────────────────
    // MODO REGEN: solo re-mapeo docx con data_final, sin cobrar
    // ─────────────────────────────────────────────────────────────
    if (regen) {
      // SSOT: frontend payload manda. Permite vaciar campos intencionalmente.
      const data: CancelacionData = (manualOverrides ?? cancRow.data_final ?? cancRow.data_ia) as CancelacionData;
      if (!data) {
        return new Response(JSON.stringify({ error: "No hay datos para regenerar" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const vars = buildDocxVars(data);
      const minuta = await fillTemplate(supabaseService, TEMPLATE_MINUTA, vars);
      const certificado = await fillTemplate(supabaseService, TEMPLATE_CERT, vars);

      const minutaPath = `cancelaciones/${cancelacionId}/minuta.docx`;
      const certPath = `cancelaciones/${cancelacionId}/certificado.docx`;
      await supabaseService.storage.from(BUCKET_OUTPUT).upload(minutaPath, minuta, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
      await supabaseService.storage.from(BUCKET_OUTPUT).upload(certPath, certificado, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
      await supabaseService.from("cancelaciones").update({
        data_final: data,
        url_minuta_generada: minutaPath,
        url_certificado_generado: certPath,
        updated_at: new Date().toISOString(),
      }).eq("id", cancelacionId);

      return new Response(JSON.stringify({ ok: true, regenerated: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODO NORMAL: cobro + IA + docx + persistencia
    // ─────────────────────────────────────────────────────────────
    const hasCertImages = certificadoImagePaths && certificadoImagePaths.length > 0;
    const hasEscImages = escrituraImagePaths && escrituraImagePaths.length > 0;
    if (!hasCertImages && !certificadoPath) {
      return new Response(JSON.stringify({ error: "Certificado requerido (imágenes JPEG)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!hasEscImages && !escrituraPath) {
      return new Response(JSON.stringify({ error: "Escritura requerida (imágenes JPEG)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Cobro de 2 créditos (con auditoría obligatoria → p_tramite_id requerido)
    const { data: charge, error: chargeErr } = await supabaseService.rpc("consume_credit_v2", {
      p_org_id: orgId,
      p_user_id: userId,
      p_action: "GENERACION_DOCX",
      p_tramite_id: cancelacionId,
      p_tipo_acto: "cancelacion_hipoteca",
      p_credits: 2,
    });
    if (chargeErr) {
      console.error("[procesar-cancelacion] consume_credit_v2 chargeErr:", chargeErr);
      return biz(
        "credit_charge_error",
        "No se pudo registrar el consumo de créditos en la auditoría. Contacte a soporte técnico.",
      );
    }
    if (charge !== true) {
      return biz(
        "credits_blocked",
        "No tienes créditos suficientes para procesar esta cancelación (requiere 2 créditos).",
      );
    }

    // Marcar processing
    await supabaseService.from("cancelaciones").update({
      status: "processing", created_by: userId, error_message: null,
    }).eq("id", cancelacionId);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const certInputPaths: string[] = certificadoImagePaths && certificadoImagePaths.length > 0
      ? certificadoImagePaths
      : (certificadoPath ? [certificadoPath] : []);
    const escInputPaths: string[] = escrituraImagePaths && escrituraImagePaths.length > 0
      ? escrituraImagePaths
      : (escrituraPath ? [escrituraPath] : []);
    const poderInputPaths: string[] = poderImagePaths && poderImagePaths.length > 0
      ? poderImagePaths
      : (poderPath ? [poderPath] : []);

    // ── Trabajo pesado en background — evita WORKER_RESOURCE_LIMIT ──
    const heavyWork = async () => {
      try {
        const certUrls = await Promise.all(
          certInputPaths.map((p) => createSignedStorageUrl(supabaseService, p)),
        );
        const escUrls = await Promise.all(
          escInputPaths.map((p) => createSignedStorageUrl(supabaseService, p)),
        );
        const poderUrls = await Promise.all(
          poderInputPaths.map((p) => createSignedStorageUrl(supabaseService, p)),
        );

        const poderLine = poderUrls.length > 0
          ? ` Los siguientes ${poderUrls.length} adjuntos son páginas del Poder General del Banco (en orden) — revisa TODAS las páginas, especialmente las finales, para extraer el bloque 'poder_banco'.`
          : ` NO se adjuntó Poder General; OMITE el objeto 'poder_banco' por completo.`;

        const userContent: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: `Analiza los siguientes documentos y extrae los datos para una cancelación de hipoteca de Davivienda. Los primeros ${certUrls.length} adjuntos son páginas del Certificado de Tradición y Libertad (en orden); los siguientes ${escUrls.length} adjuntos son páginas de la Escritura Pública de Constitución de Hipoteca (en orden).${poderLine} Llama a extract_cancelacion_hipoteca con TODOS los campos requeridos.`,
          },
          ...certUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ...escUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ...poderUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ];

        const aiBody = {
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "extract_cancelacion_hipoteca" } },
        };

        const aiResp = await fetchAiGateway({ apiKey: LOVABLE_API_KEY, body: aiBody, tag: "procesar-cancelacion" });
        const extracted = await parseToolCallArguments<CancelacionData>(aiResp, "procesar-cancelacion");

        const vars = buildDocxVars(extracted);
        const minuta = await fillTemplate(supabaseService, TEMPLATE_MINUTA, vars);
        const certificado = await fillTemplate(supabaseService, TEMPLATE_CERT, vars);

        const minutaOutputPath = `cancelaciones/${cancelacionId}/minuta.docx`;
        const certOutputPath = `cancelaciones/${cancelacionId}/certificado.docx`;
        const { error: upMinErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(minutaOutputPath, minuta, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
        if (upMinErr) throw new Error(`Upload minuta: ${upMinErr.message}`);
        const { error: upCertErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(certOutputPath, certificado, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
        if (upCertErr) throw new Error(`Upload certificado: ${upCertErr.message}`);

        const { error: updErr } = await supabaseService.from("cancelaciones").update({
          status: "completed",
          data_ia: extracted,
          data_final: extracted,
          numero_escritura_hipoteca: extracted.hipoteca_anterior.numero_escritura_hipoteca,
          fecha_escritura_hipoteca: extracted.hipoteca_anterior.fecha_escritura_hipoteca,
          notaria_hipoteca: extracted.hipoteca_anterior.notaria_hipoteca,
          valor_hipoteca_original: extracted.hipoteca_anterior.valor_hipoteca_original,
          matricula_inmobiliaria: extracted.inmueble.matricula_inmobiliaria,
          direccion_inmueble: extracted.inmueble.nomenclatura_predio ?? extracted.inmueble.direccion_completa ?? null,
          ciudad_inmueble: extracted.inmueble.ciudad,
          deudor_nombre: extracted.partes.deudor_nombre,
          deudor_cedula: extracted.partes.deudor_identificacion,
          deudor_tipo_id: extracted.partes.deudor_tipo_id,
          banco_acreedor: extracted.partes.banco_acreedor,
          banco_nit: extracted.partes.banco_nit,
          aplica_ley_546: extracted.analisis_legal.aplica_ley_546,
          explicacion_ley: extracted.analisis_legal.explicacion_ley,
          url_minuta_generada: minutaOutputPath,
          url_certificado_generado: certOutputPath,
          updated_at: new Date().toISOString(),
        }).eq("id", cancelacionId);
        if (updErr) throw new Error(`Persist: ${updErr.message}`);
      } catch (bgErr) {
        const rawMsg = bgErr instanceof Error ? bgErr.message : String(bgErr);
        const isAiErr = bgErr instanceof AiGatewayError;
        const isPayloadTooLarge = isAiErr && (bgErr as AiGatewayError).status === 413;
        const isUnsupportedFormat =
          isAiErr &&
          (bgErr as AiGatewayError).status === 400 &&
          /unsupported image format/i.test((bgErr as AiGatewayError).rawBody ?? rawMsg);

        let friendlyMsg = rawMsg;
        if (isPayloadTooLarge) {
          friendlyMsg = "La escritura supera el límite técnico de análisis de la IA (30 MB de contenido por documento). Comprime el PDF o reduce su tamaño antes de reintentar.";
        } else if (isUnsupportedFormat) {
          friendlyMsg = "El certificado debe convertirse a imagen antes del análisis. Reintenta la carga; el sistema ya está preparado para hacerlo automáticamente.";
        }

        console.error(
          `[procesar-cancelacion bg] error${isPayloadTooLarge ? " (413 payload too large)" : isUnsupportedFormat ? " (400 unsupported image format)" : ""}:`,
          rawMsg,
        );

        // Guard idempotente: solo restituye créditos si aún no se ha marcado error.
        const { data: currentRow } = await supabaseService
          .from("cancelaciones")
          .select("status, error_message")
          .eq("id", cancelacionId)
          .maybeSingle();

        if (currentRow && currentRow.status !== "error") {
          try {
            await supabaseService.rpc("restore_credit", { org_id: orgId });
            await supabaseService.rpc("restore_credit", { org_id: orgId });
          } catch (_) { /* ignore */ }
        }

        await supabaseService.from("cancelaciones").update({
          status: "error",
          error_message: friendlyMsg.slice(0, 500),
        }).eq("id", cancelacionId);
      }
    };

    // @ts-ignore EdgeRuntime global disponible en Supabase Edge Functions
    EdgeRuntime.waitUntil(heavyWork());

    return new Response(JSON.stringify({ ok: true, cancelacionId, async: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[procesar-cancelacion] error:", msg);

    // Restaurar créditos internos (2) — siempre que no haya sido credits_blocked
    try {
      await supabaseService.rpc("restore_credit", { org_id: orgId });
      await supabaseService.rpc("restore_credit", { org_id: orgId });
    } catch (_) { /* ignore */ }

    await supabaseService.from("cancelaciones").update({
      status: "error", error_message: msg.slice(0, 500),
    }).eq("id", cancelacionId);

    // Mapeo de errores del AI Gateway → envelope de negocio (HTTP 200)
    if (err instanceof AiGatewayError) {
      if (err.status === 402) {
        return biz("ai_gateway_no_credits",
          "El servicio de IA no tiene créditos disponibles. Contacta al administrador del workspace para recargar.");
      }
      if (err.status === 413) {
        return biz("ai_gateway_payload_too_large",
          "La escritura supera el límite técnico de análisis de la IA (30 MB de contenido por documento). Comprime el PDF antes de reintentar.");
      }
      if (err.status === 429) {
        return biz("ai_gateway_rate_limit",
          "Demasiadas solicitudes al servicio de IA. Espera unos minutos e intenta de nuevo.");
      }
      if (err.status === 502) {
        return biz("ai_gateway_bad_response",
          "La IA no devolvió datos estructurados válidos. Intenta nuevamente con los mismos documentos.");
      }
      return biz("ai_gateway_error", `Error del servicio de IA (${err.status}). Intenta de nuevo.`);
    }

    return biz("internal", msg.slice(0, 300));
  }
});

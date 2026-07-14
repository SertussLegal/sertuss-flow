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
import { deudorTokens, deudoresTokens, apoderadoTokens, bancoTokens, inferGeneroFromNombre } from "../_shared/genero.ts";
import { assertOwnPaths } from "../_shared/storagePaths.ts";
import { POWER_V5_ENABLED, POWER_V6_EXTRACTOR_ENABLED } from "../_shared/poderBancoSchemaVersion.ts";
import { runWithPoderCache } from "../_shared/poderBancoCache.ts";
import { classifyApoderado, type ApoderadoPayload } from "../_shared/isomorphic/apoderadoClassifier.ts";
import { getProsaBanco, type ProsaContext, mergeOverride, type ProsaApoderadoOverride } from "../_shared/isomorphic/prosaBancos/index.ts";
import {
  buildPoderBancoRequest,
  PODER_BANCO_TOOL_NAME,
  type PoderBancoDeepPayload,
} from "../_shared/isomorphic/poderBancoExtractor/index.ts";
import { sanitizeString, stripNullyStrings, CANCELACION_NULLY_PATHS } from "../_shared/isomorphic/poderBancoExtractor/merge.ts";

// Bucket donde viven los JPEG del Poder (mismo que el resto del expediente).
// Constante local; se usa al instanciar el wrapper de caché v5.
const POWER_DOC_TYPE = "poder_banco_dedicado";

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
const TEMPLATE_MINUTA = "formato cancelacion hipoteca blanqueado v2.docx";
const TEMPLATE_MINUTA_V3 = "formato cancelacion hipoteca v3.docx";
const TEMPLATE_CERT = "CERTIFICADO can hipo blanqueado.docx";

/**
 * Selector de plantilla de minuta (Fase B3 del plan v5).
 *
 * Reglas:
 *   - v3 SOLO cuando el flag global `POWER_V5_ENABLED` está encendido Y
 *     el trámite trae la estructura v5 extraída (`poder_banco.apoderado.tipo`
 *     poblado con 'natural' o 'juridica'). Esa forma solo aparece cuando el
 *     schema de OCR v5 corrió sobre el Poder General.
 *   - v2 en cualquier otro caso: flag apagado, trámite legacy, o Poder
 *     ausente. Mantiene compatibilidad retro sin sorpresas para tenants.
 *
 * NO lanza: si el bucket no tiene la plantilla v3 aún, el error se
 * materializa en `fillTemplate` con mensaje claro por nombre de archivo.
 */
export function selectMinutaTemplate(data: CancelacionData): string {
  if (!POWER_V5_ENABLED) return TEMPLATE_MINUTA;
  const pb = (data.poder_banco || {}) as Record<string, unknown>;
  const apo = (pb.apoderado || {}) as Record<string, unknown>;
  const tipo = typeof apo.tipo === "string" ? apo.tipo : "";
  if (tipo === "natural" || tipo === "juridica") return TEMPLATE_MINUTA_V3;
  return TEMPLATE_MINUTA;
}

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
    // Prosa notarial (legacy / fuente de verdad para texto completo)
    numero_escritura_hipoteca: string;
    fecha_escritura_hipoteca: string;
    notaria_hipoteca: string;
    valor_hipoteca_original: string;
    valor_hipoteca_es_indeterminada?: boolean;
    /** Metadata para UI: "escritura" cuando el monto vino del OCR dedicado
     *  a la escritura antecedente porque el certificado estaba indeterminado. */
    cuantia_origen?: "escritura" | "certificado" | "manual";
    // ── Campos ATÓMICOS (preferidos) — evitan regex inversos sobre prosa ──
    numero_escritura?: string;          // "3866"
    fecha_escritura?: { dia?: string; mes?: string; ano?: string }; // dia/mes 2 dígitos, ano 4
    notaria?: { numero?: string; ciudad?: string };
  };
  inmueble: {
    matricula_inmobiliaria: string;
    direccion_completa?: string;
    descripcion?: string;
    descripcion_predio?: string;
    nomenclatura_predio?: string;
    ciudad: string;
    departamento?: string;
  };
  partes: {
    // ── Array canónico (NUEVO) — preferido por buildDocxVars ──
    deudores?: Array<{
      nombre: string;
      identificacion: string; // SOLO DÍGITOS limpios (sin puntos)
      tipo_id: "CEDULA DE CIUDADANIA" | "CEDULA DE EXTRANJERIA" | "PASAPORTE" | string;
      genero?: "M" | "F" | "";
    }>;
    // ── Legacy singulares (compat lectura; se hidratan desde deudores[0] si faltan) ──
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
    tipo_credito?: "VIVIENDA_LEY_546" | "VIVIENDA_NO_LEY_546" | "COMERCIAL" | "DESCONOCIDO";
    // Limitaciones registrales concurrentes (Ley 258/1996, Ley 70/1931 + 495/1999)
    concurre_afectacion_vivienda?: boolean;
    afectacion_vivienda_anotacion?: string;   // "0007" (4 dígitos, formato SNR)
    concurre_patrimonio_familia?: boolean;
    patrimonio_familia_anotacion?: string;    // "0008" (4 dígitos, formato SNR)
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
              valor_hipoteca_original: { type: "string", description: "Monto del CRÉDITO HIPOTECARIO original. ANCLAJE SINTÁCTICO OBLIGATORIO al verbo rector del gravamen ('constituye', 'grava', 'hipoteca', 'garantiza', 'presta', 'concede', 'desembolsa'). LISTA NEGRA: 'precio de venta', 'avalúo', 'subrogación', 'abono', 'saldo pendiente', 'subsidio', 'cesantías'. Cuantía indeterminada / hipoteca abierta → cadena vacía '' y valor_hipoteca_es_indeterminada=true. Ambigüedad sin desambiguación → '' y false. Formato: '<MONTO EN LETRAS> DE PESOS ($<NÚMERO CON PUNTOS DE MILES>)' MAYÚSCULAS." },
              valor_hipoteca_es_indeterminada: { type: "boolean", description: "true SOLO si la hipoteca es declarada expresamente ABIERTA, SIN LÍMITE DE CUANTÍA, o de CUANTÍA INDETERMINADA." },
              // ── ATÓMICOS (preferidos) — eliminan necesidad de parsers inversos en backend ──
              numero_escritura: { type: "string", description: "Número de escritura SOLO en DÍGITOS ARÁBIGOS, sin paréntesis ni letras. Ej: '3866'. Estricto: solo dígitos." },
              fecha_escritura: {
                type: "object",
                description: "Fecha de la escritura desglosada en partes atómicas.",
                properties: {
                  dia: { type: "string", description: "Día con 2 dígitos, ej: '01', '15'." },
                  mes: { type: "string", description: "Mes con 2 dígitos, ej: '06' para junio." },
                  ano: { type: "string", description: "Año con 4 dígitos, ej: '2011'." },
                },
                additionalProperties: false,
              },
              notaria: {
                type: "object",
                description: "Notaría de origen desglosada en partes atómicas.",
                properties: {
                  numero: { type: "string", description: "Número de notaría SOLO en dígitos arábigos, ej: '72'." },
                  ciudad: { type: "string", description: "Ciudad de la notaría, MAYÚSCULAS, ej: 'BOGOTA D.C.'." },
                },
                additionalProperties: false,
              },
            },
            required: ["numero_escritura_hipoteca", "fecha_escritura_hipoteca", "notaria_hipoteca", "valor_hipoteca_original"],
            additionalProperties: false,
          },
          inmueble: {
            type: "object",
            properties: {
              matricula_inmobiliaria: { type: "string", description: "Matrícula ESTRICTAMENTE alfanumérica con guión, ej: '50C-2085432'. SIN palabras en letras, SIN paréntesis." },
              descripcion_predio: { type: "string", description: "Identificación ARQUITECTÓNICA del predio en formato notarial corto, MAYÚSCULAS, con números en LETRAS seguidos del número entre paréntesis. PROHIBIDO incluir áreas, M2, coeficientes, linderos, dimensiones ni nomenclatura urbana." },
              nomenclatura_predio: { type: "string", description: "Dirección postal urbana del predio, MAYÚSCULAS, en formato notarial TEXTO (NÚMERO). Tomada EXCLUSIVAMENTE del renglón de ÍNDICE MÁS ALTO de la sección 'DIRECCION DEL INMUEBLE' del certificado de tradición (renglones '1)','2)','3)' o romanos — la vigente es la del índice mayor). Vía y números en letras con dígito entre paréntesis, sufijos cardinales SUR/NORTE/ESTE/OESTE en MAYÚSCULA pegados al número. SEPARADOR DE PLACA: se conserva como el SÍMBOLO '-' (un guion ASCII rodeado de espacios), NUNCA se verbaliza como la palabra 'GUION'. Letras pegadas (62A, 53B, 'BIS') se transcriben literales en MAYÚSCULA. Cardinales masculinos ('UNO','DOS','VEINTIUNO'). Ej: 'CL 59 SUR 60 84' → 'CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84)'. PROHIBIDO incluir apartamento/torre/interior/bloque/manzana/casa (van en descripcion_predio), ciudad (va en ciudad), nombre de conjunto/edificio, ni el sufijo '(DIRECCION CATASTRAL)' — el backend los inyecta." },
              ciudad: { type: "string", description: "Ciudad del inmueble en mayúsculas, ej: 'BOGOTA D.C.'" },
              departamento: { type: "string", description: "Departamento del inmueble en mayúsculas, ej: 'CUNDINAMARCA'. Opcional." },
            },
            required: ["matricula_inmobiliaria", "descripcion_predio", "nomenclatura_predio", "ciudad"],
            additionalProperties: false,
          },
          partes: {
            type: "object",
            properties: {
              deudores: {
                type: "array",
                minItems: 1,
                description: "TODOS los deudores hipotecantes (personas naturales). Fuente PRIMARIA: cada fila 'DE: NOMBRE / CC#/CE#/PA# NUMERO' de la anotación 0205 HIPOTECA del Certificado de Tradición es UN ítem distinto. Fuente SECUNDARIA de cruce: COMPARECENCIA de la escritura antecedente.",
                items: {
                  type: "object",
                  properties: {
                    nombre: { type: "string", description: "Nombre completo en MAYÚSCULAS, idéntico al certificado." },
                    identificacion: { type: "string", description: "Número de identificación ESTRICTAMENTE NUMÉRICO sin puntos ni espacios ni letras. Solo dígitos 0-9. Ej: '20549804'. Si es ilegible, devuelve cadena vacía — NO inventes." },
                    tipo_id: {
                      type: "string",
                      enum: ["CEDULA DE CIUDADANIA", "CEDULA DE EXTRANJERIA", "PASAPORTE"],
                      description: "Detéctalo LITERAL del texto del certificado/escritura. 'CC' → CEDULA DE CIUDADANIA; 'CE' → CEDULA DE EXTRANJERIA; 'PA' / 'PASAPORTE' → PASAPORTE. NO asumas CC por defecto."
                    },
                  },
                  required: ["nombre", "identificacion", "tipo_id"],
                  additionalProperties: false,
                }
              },
              banco_acreedor: { type: "string", description: "Razón social del banco, normalmente 'BANCO DAVIVIENDA S.A.'" },
              banco_nit: { type: "string", description: "NIT ESTRICTAMENTE NUMÉRICO con puntos y guión, ej: '860.034.313-7'. SIN letras." },
            },
            required: ["deudores", "banco_acreedor", "banco_nit"],
            additionalProperties: false,
          },
          analisis_legal: {
            type: "object",
            properties: {
              aplica_ley_546: { type: "boolean", description: "true si la hipoteca se constituyó conjuntamente con la compraventa de vivienda (Ley 546 de 1999)" },
              explicacion_ley: { type: "string", description: "Explicación detallada del análisis" },
              tipo_credito: {
                type: "string",
                enum: ["VIVIENDA_LEY_546", "VIVIENDA_NO_LEY_546", "COMERCIAL", "DESCONOCIDO"],
                description: "Tipificación del crédito hipotecario. VIVIENDA_LEY_546 si se constituyó simultáneamente con compraventa de vivienda; VIVIENDA_NO_LEY_546 si es vivienda pero acto separado; COMERCIAL si es para otro destino; DESCONOCIDO si no es claro.",
              },
              // ── Limitaciones registrales concurrentes (BLINDAJE REGISTRAL) ──
              concurre_afectacion_vivienda: { type: "boolean", description: "true SOLO si el certificado de tradición tiene una anotación de AFECTACIÓN A VIVIENDA FAMILIAR (Ley 258 de 1996) constituida en la MISMA ESCRITURA PÚBLICA que la hipoteca a cancelar (mismo número, año y notaría)." },
              afectacion_vivienda_anotacion: { type: "string", description: "Número de la anotación de afectación a vivienda familiar en el certificado, EXACTAMENTE en formato de 4 dígitos como aparece en la SNR. Ej: '0007'. Solo si concurre_afectacion_vivienda=true." },
              concurre_patrimonio_familia: { type: "boolean", description: "true SOLO si el certificado de tradición tiene una anotación de PATRIMONIO DE FAMILIA INEMBARGABLE (Ley 70 de 1931 + Ley 495 de 1999) constituido en la MISMA ESCRITURA PÚBLICA que la hipoteca a cancelar." },
              patrimonio_familia_anotacion: { type: "string", description: "Número de la anotación de patrimonio de familia inembargable, EXACTAMENTE en formato de 4 dígitos como aparece en la SNR. Ej: '0008'. Solo si concurre_patrimonio_familia=true." },
            },
            required: ["aplica_ley_546", "explicacion_ley"],
            additionalProperties: false,
          },
          poder_banco: {
            type: "object",
            description: "DEVUELVE este objeto SIEMPRE que el usuario haya adjuntado páginas del Poder. Llénalo con TODOS los campos que puedas confirmar y OMITE cada campo individual ilegible (no lo incluyas en el JSON; NO uses la cadena \"null\" ni cadena vacía). OMÍTELO completamente SOLO si NO se adjuntó poder. Los datos suelen estar en las cláusulas finales del PDF.",
            properties: {
              apoderado_nombre: { type: "string", description: "Nombre completo del apoderado / representante legal en MAYÚSCULAS. Si encuentras CUALQUIER nombre de apoderado, devuélvelo." },
              apoderado_cedula: { type: "string", description: "Cédula del apoderado, estrictamente numérica con puntos de miles, ej: '79.123.456'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
              apoderado_escritura: { type: "string", description: "Número de escritura del poder en LETRAS Y NÚMEROS, ej: 'DOS MIL CUATROCIENTOS QUINCE (2415)'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
              apoderado_fecha: { type: "string", description: "Fecha del poder en FORMATO NOTARIAL COMPLETO: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
              apoderado_notaria_poder: { type: "string", description: "Notaría donde se otorgó el poder en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y DOS (32) DE BOGOTA D.C.'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
            },
            required: ["apoderado_nombre"],
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
3. (Opcional) Poder General del banco a su apoderado — PDF de hasta 50 páginas.

REGLAS ESTRICTAS DE FORMATO:
- Toda escritura, notaría, valor y fecha debe expresarse en DOBLE EXPRESIÓN: LETRAS y NÚMEROS entre paréntesis.
- El NIT del banco y la cédula del apoderado son ESTRICTAMENTE NUMÉRICAS con puntos de miles. NUNCA letras.
- Las identificaciones de los deudores (partes.deudores[].identificacion) son ESTRICTAMENTE NUMÉRICAS sin puntos ni espacios — solo dígitos 0-9. El frontend aplica la máscara visual con puntos.

REGLAS DE DEUDORES (PLURAL OBLIGATORIO — CRÍTICAS):
- Devuelve SIEMPRE el array 'partes.deudores' con UN ítem por cada fila de la anotación 0205 HIPOTECA del Certificado de Tradición ("DE: <NOMBRE>" + "CC#"/"CE#"/"PA# <NÚMERO>"). NO consolides en uno solo. NO uses las filas 'A:' (esas son el acreedor).
- PAREO ESTRICTO: el orden de 'deudores[]' respeta el orden del certificado. Cada 'nombre' va con SU PROPIA cédula. PROHIBIDO mezclar cédulas entre personas.
- DÍGITOS LIMPIOS: si el certificado dice '20.549.804', devuelves '20549804'. Si dice '1.018.440.535', devuelves '1018440535'.
- TIPO DOC: detecta lo que aparece LITERAL en el certificado o la escritura ('CC' / 'C.C.' → CEDULA DE CIUDADANIA; 'CE' / 'C.E.' → CEDULA DE EXTRANJERIA; 'PA' / 'PASAPORTE' → PASAPORTE). NO asumas un default.
- CRUCE CON ESCRITURA ANTECEDENTE: si la escritura trae COMPARECENCIA con cédulas, úsala para confirmar. El certificado es la fuente registral primaria; si discrepan, prevalece el certificado.
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

REGLAS DE EXTRACCIÓN DE NOMENCLATURA DESDE EL CERTIFICADO DE TRADICIÓN (CRÍTICAS — aplican SOLO a 'nomenclatura_predio'):

a) SELECCIÓN POR ÍNDICE MÁS ALTO: la sección "DIRECCION DEL INMUEBLE" del certificado suele traer renglones numerados "1) ...", "2) ...", "3) ..." (o numerales romanos I, II, III). Representan el historial cronológico de Catastro/ORIP; la vigente es SIEMPRE la del índice numérico MÁS ALTO. Toma EXCLUSIVAMENTE esa línea e ignora las anteriores aunque sean más descriptivas o incluyan el nombre del conjunto. Si solo hay un renglón sin numerar, tómalo.

b) FORMATO TEXTO (NÚMERO) OBLIGATORIO con concordancia colombiana:
   - Vía: CL/CLL/CALLE → "CALLE"; CR/CRA/KR/KRA/CARRERA → "CARRERA"; AV/AVENIDA → "AVENIDA"; DG/DIAGONAL → "DIAGONAL"; TV/TRANSVERSAL → "TRANSVERSAL"; CIRCULAR; AUTOPISTA.
   - Número de la vía en letras + "(N)". Conserva el sufijo cardinal (SUR/NORTE/ESTE/OESTE) en MAYÚSCULAS inmediatamente después del número.
   - Placa: literal "NÚMERO" + primer número en letras + " - " (SÍMBOLO GUION ASCII rodeado de espacios, NUNCA la palabra 'GUION') + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
   - Ej canónico: "CL 59 SUR 60 84" → "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84)".

c) BLINDAJE ALFANUMÉRICO (sufijos pegados al número): si el número de la vía o de la placa trae una letra de adición pegada (62A, 53B, 45C) o el marcador "BIS", escribe el número en letras y mantén la letra/marca en MAYÚSCULA LITERAL. El separador sigue siendo el símbolo "-", NO la palabra "GUION".
   - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B - VEINTIUNO (62A No. 53B-21)".
   - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO - TREINTA Y DOS (13 BIS No. 85-32)".
   PROHIBIDO inventar palabras como "ALFA", "BETA", "GAMMA", "DOBLE" o "GUION": la letra/sufijo se transcribe literal en mayúscula y el separador queda como el símbolo "-".

d) CARDINALES MASCULINOS: los números van en cardinales masculinos ("UNO", "DOS", "VEINTIUNO", "TREINTA Y UNO"…). La concordancia femenina de ordinales 1-10 NO aplica a direcciones.

e) STRIP DE BASURA — qué NO incluir en 'nomenclatura_predio':
   - NO incluyas el nombre del conjunto/edificio (no se devuelve en este flujo).
   - NO incluyas la ciudad/municipio (va en el campo 'ciudad').
   - NO incluyas la coletilla "(DIRECCION CATASTRAL)" (la inyecta el backend solo si la ciudad es Bogotá).
   - NO incluyas complementos arquitectónicos (TORRE, APARTAMENTO, INTERIOR, BLOQUE, MANZANA, CASA): esos van en 'descripcion_predio' aplicando el mismo formato TEXTO (NÚMERO) — TO/TORRE → "TORRE <letras> (N)"; AP/APTO/APARTAMENTO → "APARTAMENTO <letras> (N)"; INT/INTERIOR → "INTERIOR <letras> (N)"; BL/BLOQUE → "BLOQUE <letras> (N)"; MZ/MANZANA → "MANZANA <letras> (N)"; CS/CASA → "CASA <letras> (N)".
   Si el renglón del índice más alto trae cualquiera de estos elementos, elimínalos del valor devuelto en 'nomenclatura_predio' y reubícalos en su campo correspondiente.

PODER GENERAL DEL BANCO (cuando se adjunte):
- ANALIZA TODAS LAS PÁGINAS del PDF, incluyendo las finales. La cláusula de designación del apoderado suele estar al final del documento.
- Palabras clave para localizar al apoderado: 'CONFIERE PODER', 'APODERADO', 'REPRESENTANTE LEGAL', 'OTORGA PODER GENERAL', 'FACULTA A', 'ESCRITURA PÚBLICA No.', 'NOTARÍA'.
- Devuelve la fecha del poder en formato notarial completo: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'.
- Si SE ADJUNTÓ el Poder: DEVUELVE el objeto 'poder_banco' con TODOS los campos que puedas confirmar y **OMITE cada campo individual ilegible** (no lo incluyas en el JSON; NO uses la cadena \`"null"\` ni cadena vacía \`""\`). Si encuentras al menos el nombre del apoderado, devuelve el objeto.
- Solo OMITE 'poder_banco' completamente si NO se adjuntó poder en absoluto.


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

CAMPOS ATÓMICOS DE HIPOTECA ANTERIOR (NUEVO — OBLIGATORIO):
Además de la prosa notarial, DEBES poblar SIEMPRE los siguientes campos atómicos que el backend usará directamente para celdas de tabla SNR (sin parsers inversos):
- 'hipoteca_anterior.numero_escritura': SOLO dígitos arábigos del número de escritura (ej: '3866').
- 'hipoteca_anterior.fecha_escritura': objeto con { dia: '01', mes: '06', ano: '2011' } — dos dígitos en día/mes, cuatro en año.
- 'hipoteca_anterior.notaria': objeto con { numero: '72', ciudad: 'BOGOTA D.C.' } — número solo en dígitos.
La prosa formateada ('numero_escritura_hipoteca', 'fecha_escritura_hipoteca', 'notaria_hipoteca') sigue siendo obligatoria para los párrafos del cuerpo.

LIMITACIONES REGISTRALES CONCURRENTES (BLINDAJE — Anotaciones del Certificado de Tradición):
En el Certificado de Tradición y Libertad, EXAMINA TODAS LAS ANOTACIONES en busca de limitaciones que se hayan constituido en la MISMA ESCRITURA PÚBLICA que la hipoteca a cancelar (mismo número de escritura, año y notaría que aparecen en la anotación de la hipoteca).

- 'analisis_legal.concurre_afectacion_vivienda' = true SOLO si existe una anotación tipo 'AFECTACIÓN A VIVIENDA FAMILIAR' (Ley 258 de 1996) cuyo documento de origen coincida con la escritura de la hipoteca. En ese caso 'afectacion_vivienda_anotacion' DEBE ser el número de anotación EXACTAMENTE en formato de 4 dígitos como aparece en la SNR (ej: '0007', '0012', '0123'). Rellenar a 4 dígitos con ceros a la izquierda es obligatorio para pulcritud de trazabilidad.

- 'analisis_legal.concurre_patrimonio_familia' = true SOLO si existe una anotación tipo 'PATRIMONIO DE FAMILIA INEMBARGABLE' (Ley 70 de 1931, modificada por Ley 495 de 1999) cuyo documento de origen coincida con la escritura de la hipoteca. En ese caso 'patrimonio_familia_anotacion' DEBE ir en formato 4 dígitos (ej: '0008').

- 'analisis_legal.tipo_credito': VIVIENDA_LEY_546 si aplica_ley_546=true; VIVIENDA_NO_LEY_546 si es para vivienda pero acto separado; COMERCIAL si es para destino distinto; DESCONOCIDO si no es claro.

Si una limitación NO concurre con la escritura de la hipoteca a cancelar (es de otra escritura), el campo concurrente DEBE ser false aunque la anotación exista en el certificado.

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

// ── Helpers de protocolo TEXTO (NÚMERO) para el Poder General ──
// Red de seguridad determinista cuando Gemini emite el dato en dígitos crudos.
// Idempotentes: si ya viene formateado "LETRAS (NNN)" o contiene alfabéticos
// estructurados (>=3 letras consecutivas), se devuelve intacto en MAYÚSCULAS.
function _yaTieneLetrasEstructuradas(s: string): boolean {
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(s) && /\(\s*\d+\s*\)/.test(s);
}

function formatProtocoloEscritura(raw: string): string | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  if (_yaTieneLetrasEstructuradas(s)) return s.toLocaleUpperCase("es-CO");
  const m = s.match(/\d{1,7}/);
  if (!m) return s.toLocaleUpperCase("es-CO");
  const formatted = numeroConLetras(m[0], "masculine");
  return formatted || s.toLocaleUpperCase("es-CO");
}

function formatProtocoloNotaria(raw: string): string | undefined {
  const s = (raw || "").trim();
  if (!s) return undefined;
  if (_yaTieneLetrasEstructuradas(s)) return s.toLocaleUpperCase("es-CO");
  // Heurística "ÚNICA" — mismo criterio que el bloque existente de hipoteca.
  const esUnica = /\b[ÚU]?NICA\b/i.test(s);
  // Extraer número y coletilla de ubicación (todo lo que viene después del dígito).
  const m = s.match(/(\d{1,4})\s*(.*)$/);
  const num = esUnica ? 1 : (m ? m[1] : "");
  const colaRaw = m ? (m[2] || "") : s;
  // Limpieza de la cola: conserva "DE BOGOTA D.C.", "DEL CIRCULO DE …", etc.
  const cola = colaRaw.replace(/\s+/g, " ").trim();
  const numLetras = num ? numeroConLetras(num, "feminine") : "";
  if (!numLetras) return s.toLocaleUpperCase("es-CO");
  const colaUp = cola ? ` ${cola.toLocaleUpperCase("es-CO")}` : "";
  return `${numLetras}${colaUp}`.replace(/\s+/g, " ").trim();
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
// Resultado: "TREINTA MILLONES DE PESOS M/CTE ($30.000.000)". Idempotente solo
// cuando la cadena entrante YA contiene M/CTE (requisito registral colombiano).
// Si trae "... ($NNN)" sin M/CTE, re-normaliza extrayendo el número.
const _M_CTE_RE = /\bM\s*[\/.]?\s*CTE\b/i;
const _MONTO_TAIL_RE = /\(\$([\d.,]+)\)\s*$/;
export function montoProsaProtocolo(valor: string | number | undefined | null): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const raw = typeof valor === "number" ? String(valor) : valor;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const tail = trimmed ? trimmed.match(_MONTO_TAIL_RE) : null;
  if (tail && _M_CTE_RE.test(trimmed)) {
    return trimmed.replace(/,00\)$/, ")");
  }
  const source = tail ? tail[1] : raw;
  const formateado = formatMonedaLegal(source);
  if (!formateado) return "";
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

// ──────────────────────────────────────────────────────────────────────
// HELPERS DECLARATIVOS V2 — Post-Merge (se ejecutan sobre data_final ya
// unificado). Permiten que la plantilla v2 contenga UN SOLO tag agnóstico
// y que el backend recomponga la prosa correcta tras cada edición manual.
// ──────────────────────────────────────────────────────────────────────

// Bogotá vs. resto del país: la coletilla "(DIRECCION CATASTRAL)" solo
// aplica en Bogotá. En otros municipios se omite (regla SNR).
export function buildDireccionCompletaSaneada(opts: {
  nomenclaturaBase: string;
  ciudad: string;
  departamento: string;
  esBogota: boolean;
}): string | undefined {
  const { nomenclaturaBase, ciudad, departamento, esBogota } = opts;
  if (!nomenclaturaBase) return undefined;
  const coletilla = ciudad
    ? ` DE LA CIUDAD Y/O MUNICIPIO DE ${ciudad.toUpperCase()}${departamento ? ` DEPARTAMENTO DE ${departamento}` : ""}`
    : "";
  return esBogota
    ? `${nomenclaturaBase} (DIRECCION CATASTRAL)${coletilla}`
    : `${nomenclaturaBase}${coletilla}`;
}

// Cláusula de pago coherente con el flag de cuantía: la plantilla v2
// renderiza UN ÚNICO tag y nunca contradice SEGUNDO/QUINTO.
export function buildClausulaPagoHipoteca(opts: {
  esCuantiaIndeterminada: boolean;
  valorRaw: string;
}): string {
  if (opts.esCuantiaIndeterminada) {
    return "Conforme a la cláusula primera de la escritura referida, la hipoteca se constituyó como HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA, por lo cual no se hace referencia a una suma específica de mutuo. Las obligaciones que esta garantía amparaba se encuentran satisfechas en su totalidad.";
  }
  const monto = montoProsaProtocolo(opts.valorRaw);
  if (!monto) {
    return "La cuantía de la obligación garantizada por la hipoteca consta en la escritura referida en la cláusula segunda y se encuentra satisfecha en su totalidad.";
  }
  return `La obligación garantizada por la hipoteca, por la suma de ${monto}, se encuentra satisfecha en su totalidad.`;
}

// Parágrafo registral: cuando concurren limitaciones (Ley 258/1996 y/o
// Ley 70/1931 + 495/1999) en la misma escritura, el documento debe
// declarar expresamente que subsisten para evitar que el registrador
// las cancele junto con la hipoteca.
export function buildClausulaLimitacionesSubsisten(ha: {
  concurre_afectacion_vivienda?: boolean;
  afectacion_vivienda_anotacion?: string;
  concurre_patrimonio_familia?: boolean;
  patrimonio_familia_anotacion?: string;
}): string | undefined {
  const aff = ha.concurre_afectacion_vivienda === true;
  const pat = ha.concurre_patrimonio_familia === true;
  if (!aff && !pat) return undefined;

  const anotacionAff = (ha.afectacion_vivienda_anotacion || "").trim();
  const anotacionPat = (ha.patrimonio_familia_anotacion || "").trim();
  const refAff = anotacionAff ? ` (anotación No. ${anotacionAff})` : "";
  const refPat = anotacionPat ? ` (anotación No. ${anotacionPat})` : "";

  if (aff && pat) {
    return `La presente cancelación de hipoteca NO afecta la AFECTACIÓN A VIVIENDA FAMILIAR${refAff} (Ley 258 de 1996) ni el PATRIMONIO DE FAMILIA INEMBARGABLE${refPat} (Ley 70 de 1931, modificada por la Ley 495 de 1999) que recaen sobre el inmueble, los cuales SUBSISTEN por ministerio de la ley. Se solicita al señor Registrador de Instrumentos Públicos mantener vigentes dichas limitaciones registrales.`;
  }
  if (aff) {
    return `La presente cancelación de hipoteca NO afecta la AFECTACIÓN A VIVIENDA FAMILIAR${refAff} (Ley 258 de 1996) que recae sobre el inmueble, la cual SUBSISTE por ministerio de la ley. Se solicita al señor Registrador de Instrumentos Públicos mantener vigente dicha limitación registral.`;
  }
  return `La presente cancelación de hipoteca NO afecta el PATRIMONIO DE FAMILIA INEMBARGABLE${refPat} (Ley 70 de 1931, modificada por la Ley 495 de 1999) constituido sobre el inmueble, el cual SUBSISTE por ministerio de la ley. Se solicita al señor Registrador de Instrumentos Públicos mantener vigente dicha limitación registral.`;
}

// Padding 4 dígitos para celdas SNR (ej. notaría '72' → '0072', escritura '3866' → '3866').
export function pad4(s: string | number | undefined | null): string {
  const raw = (s === null || s === undefined ? "" : String(s)).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  return digits.padStart(4, "0");
}

// ── Helpers de saneamiento para deudores (plural N) ──
const VALID_TIPO_ID = new Set([
  "CEDULA DE CIUDADANIA",
  "CEDULA DE EXTRANJERIA",
  "PASAPORTE",
]);
const TIPO_ID_LABEL: Record<string, string> = {
  "CEDULA DE CIUDADANIA": "cédula de ciudadanía",
  "CEDULA DE EXTRANJERIA": "cédula de extranjería",
  "PASAPORTE": "pasaporte",
};
const onlyDigits = (s: unknown): string => String(s ?? "").replace(/\D+/g, "");
const formatCC = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Normaliza el array de deudores con compatibilidad legacy:
 *  - Si `partes.deudores[]` existe → se usa tal cual.
 *  - Si NO existe pero hay `deudor_*` singulares → se hidrata como array de 1.
 *  - Si tampoco hay singulares → devuelve [] (la plantilla pintará subrayados).
 * Cada ítem queda saneado: nombre MAYÚSCULAS, identificación solo dígitos,
 * tipo_id validado contra enum, género inferido si no viene.
 */
function normalizeDeudores(partes: CancelacionData["partes"]) {
  const raw = Array.isArray(partes?.deudores) && partes.deudores.length > 0
    ? partes.deudores
    : (partes?.deudor_nombre || partes?.deudor_identificacion)
      ? [{
          nombre: partes.deudor_nombre,
          identificacion: partes.deudor_identificacion,
          tipo_id: partes.deudor_tipo_id,
          genero: partes.deudor_genero,
        }]
      : [];
  return raw.map((d) => {
    const nombre = String(d?.nombre ?? "").toUpperCase().trim();
    const ident = onlyDigits(d?.identificacion);
    const tipoIn = String(d?.tipo_id ?? "").toUpperCase().trim();
    const tipo_id = VALID_TIPO_ID.has(tipoIn) ? tipoIn : "CEDULA DE CIUDADANIA";
    const genero: "M" | "F" | "" = ((d?.genero as "M" | "F" | "" | undefined) || inferGeneroFromNombre(nombre) || "") as "M" | "F" | "";
    return {
      nombre,
      identificacion: ident,
      identificacion_formateada: formatCC(ident),
      tipo_id,
      genero,
    };
  });
}

// Build the variable map sent to Docxtemplater
export function buildDocxVars(data: CancelacionData, prosaOverride?: ProsaApoderadoOverride | null) {
  const rawIn = (data.hipoteca_anterior.valor_hipoteca_original || "").trim();
  // Guard defensivo H2: strings basura ("null"/"undefined"/"nan") jamás deben llegar a la plantilla.
  // Si por cualquier ruta (merge cliente, JSON round-trip, ?? "null") acabaron persistidos, los
  // normalizamos a vacío ANTES de decidir la rama de renderizado. Esto impide de raíz que la palabra
  // "null" aparezca incrustada en la prosa notarial.
  const isTrashMonto = /^(null|undefined|nan)$/i.test(rawIn);
  const valorRaw = isTrashMonto ? "" : rawIn;
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
  // ── DEUDORES (plural N) — fuente única para nombres, cédulas, tokens, prosa ──
  const deudoresArr = normalizeDeudores(data.partes);

  // ── V5/B3: filtro de firmantes para el loop {#apoderado_representantes} ──
  // Solo aplica cuando el schema v5 (`apoderado.tipo === 'juridica'`) trae
  // el array de RLs designados. Regla:
  //   1. Preferir sólo aquellos con `es_firmante === true`.
  //   2. Fallback de seguridad: si NINGUNO quedó marcado (el abogado los
  //      desmarcó todos por error), devolver el listado completo para no
  //      dejar la minuta huérfana de antefirmas.
  //   3. Si `tipo !== 'juridica'` o no hay array → undefined (la plantilla v3
  //      resuelve el bloque como natural o pinta subrayados vía nullGetter).
  const apoderadoRaw = ((pb as Record<string, unknown>).apoderado || {}) as Record<string, unknown>;
  const repsIn = Array.isArray(apoderadoRaw.representantes)
    ? (apoderadoRaw.representantes as Array<Record<string, unknown>>)
    : [];
  const repsFirmantes = repsIn.filter((r) => r?.es_firmante === true);
  const apoderadoRepresentantes = apoderadoRaw.tipo === "juridica" && repsIn.length > 0
    ? (repsFirmantes.length > 0 ? repsFirmantes : repsIn)
    : undefined;

  const tokensDeudor = deudoresTokens(deudoresArr);
  const deudoresNombres = deudoresArr.map((d) => d.nombre).filter(Boolean).join(" Y ");
  const deudoresCedulas = deudoresArr.map((d) => d.identificacion_formateada).filter(Boolean).join(" Y ");
  const deudorTipoIdMostrado = deudoresArr[0]?.tipo_id || data.partes.deudor_tipo_id || "CEDULA DE CIUDADANIA";
  // Prosa de comparecencia per-deudor — tag opcional para plantillas v3.
  const comparecientesDeudoresProsa = deudoresArr
    .map((d) => {
      const t = deudorTokens(d.genero);
      const tipoLabel = TIPO_ID_LABEL[d.tipo_id] || "cédula de ciudadanía";
      return `${t.art_deudor.toUpperCase()} ${d.nombre}, ${t.id_deudor} con ${tipoLabel} número ${d.identificacion_formateada}`;
    })
    .join(", Y ");
  // Bloque de firmas — orden alfabético estable en español, INDEPENDIENTE
  // del orden registral. Tag opcional para plantillas futuras.
  const firmasDeudoresProsa = [...deudoresArr]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((d) => `${d.nombre}\nC.C. ${d.identificacion_formateada}`)
    .join("\n\n");

  const generoApoderado = pb.apoderado_genero || inferGeneroFromNombre(sanitizeString(pb.apoderado_nombre) || "") || "";
  const tratamientoBanco = data.partes.tratamiento_entidad || "";
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
    // Red de seguridad: el separador de placa es el SÍMBOLO '-', nunca la palabra 'GUION'.
    // Sólo reemplazamos cuando aparece como palabra suelta entre espacios, para no tocar
    // nombres propios ni el contenido dentro del paréntesis técnico "(... No. N-N)".
    .replace(/\s+GUION(?:ES)?\s+/gi, " - ")
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

  // ── MAPEO ATÓMICO SNR (sin parsers inversos) ──
  const haAtom = data.hipoteca_anterior as Record<string, unknown>;
  const fechaAtom = (haAtom.fecha_escritura as { dia?: string; mes?: string; ano?: string } | undefined) || {};
  const notariaAtom = (haAtom.notaria as { numero?: string; ciudad?: string } | undefined) || {};
  const numeroEscrituraAtom = typeof haAtom.numero_escritura === "string" ? haAtom.numero_escritura : "";
  const snrNumeroEscritura = numeroEscrituraAtom || extractCorto(data.hipoteca_anterior.numero_escritura_hipoteca || "");
  const snrFechaDia = (fechaAtom.dia || fp.dia || "").toString().padStart(2, "0").slice(0, 2);
  const snrFechaMes = (fechaAtom.mes || fp.mes || "").toString().padStart(2, "0").slice(0, 2);
  const snrFechaAno = (fechaAtom.ano || fp.ano || extractAno(data.hipoteca_anterior.fecha_escritura_hipoteca) || "").toString();
  const snrNotariaNumero = (notariaAtom.numero || notariaOrigenNum || "").toString();
  const snrNotariaCiudad = (notariaAtom.ciudad || ciudadHipoteca || "").toString();

  // ── Helpers V2 (Post-Merge) ──
  const direccionCompletaSaneada = buildDireccionCompletaSaneada({
    nomenclaturaBase, ciudad: ciudadInmueble, departamento: departamentoInmueble, esBogota,
  });
  const clausulaPagoHipoteca = buildClausulaPagoHipoteca({ esCuantiaIndeterminada, valorRaw });
  const clausulaLimitacionesSubsisten = buildClausulaLimitacionesSubsisten({
    concurre_afectacion_vivienda: data.analisis_legal.concurre_afectacion_vivienda,
    afectacion_vivienda_anotacion: data.analisis_legal.afectacion_vivienda_anotacion,
    concurre_patrimonio_familia: data.analisis_legal.concurre_patrimonio_familia,
    patrimonio_familia_anotacion: data.analisis_legal.patrimonio_familia_anotacion,
  });
  const limitacionesConcurrentes =
    data.analisis_legal.concurre_afectacion_vivienda === true ||
    data.analisis_legal.concurre_patrimonio_familia === true;

  // Letras del valor con fallback de cuantía indeterminada (plantilla v2 envuelve
  // ($ {numeros}) con sección inversa, así que numeros queda en blanco cuando
  // esCuantiaIndeterminada=true).
  const valorLetrasOIndeterminado = esCuantiaIndeterminada
    ? "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA"
    : (valor.letras || undefined);

  const _v2Overrides = {
    // SNR atómico (sobreescribe los regex-inverso del return original)
    numero_escritura_hipoteca_corto: pad4(snrNumeroEscritura) || undefined,
    fecha_escritura_hipoteca_dia: snrFechaDia || undefined,
    fecha_escritura_hipoteca_mes: snrFechaMes || undefined,
    fecha_escritura_hipoteca_ano: snrFechaAno || undefined,
    notaria_hipoteca_numero: pad4(snrNotariaNumero) || undefined,
    ciudad_hipoteca: snrNotariaCiudad || undefined,
    ciudad_hipoteca_corto: snrNotariaCiudad || undefined,
    // V2 — tags agnósticos para plantilla saneada
    direccion_completa_saneada: direccionCompletaSaneada,
    clausula_pago_hipoteca: clausulaPagoHipoteca,
    clausula_limitaciones_subsisten: clausulaLimitacionesSubsisten,
    limitaciones_concurrentes: limitacionesConcurrentes || undefined,
    concurre_afectacion_vivienda: data.analisis_legal.concurre_afectacion_vivienda || undefined,
    afectacion_vivienda_anotacion: data.analisis_legal.afectacion_vivienda_anotacion || undefined,
    concurre_patrimonio_familia: data.analisis_legal.concurre_patrimonio_familia || undefined,
    patrimonio_familia_anotacion: data.analisis_legal.patrimonio_familia_anotacion || undefined,
    tipo_credito: data.analisis_legal.tipo_credito || undefined,
    // V2 — fallback de cuantía indeterminada (consumido por la plantilla v2)
    valor_hipoteca_letras_o_indeterminado: valorLetrasOIndeterminado,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Plan v7 / Fase B4 — Prosa condicional Natural vs Jurídica por banco.
  //
  // Se corre SIEMPRE (independiente de POWER_V5_ENABLED) para poblar tags
  // v3 sin costo cuando la plantilla no los referencia. La plantilla v2
  // legacy ignora los tags nuevos por completo → cero riesgo.
  //
  // El validador determinista (`classifyApoderado`) gobierna sobre la IA:
  // si degrada a null, los tags de prosa quedan vacíos y la UI muestra
  // el banner de ambigüedad. Sin ese banner el usuario no podrá regenerar.
  // ═══════════════════════════════════════════════════════════════════════
  const apoderadoPayload = ((pb as Record<string, unknown>).apoderado || {}) as ApoderadoPayload;
  const poderdantePayload = ((pb as Record<string, unknown>).poderdante || {}) as Record<string, string | null | undefined>;
  const instrumentoPayload = ((pb as Record<string, unknown>).instrumento_poder || {}) as Record<string, string | null | undefined>;
  const classifierResult = classifyApoderado(apoderadoPayload);
  const bancoNit = (data.partes.banco_nit || "").toString();
  const bancoTemplate = getProsaBanco(bancoNit);
  let comparecenciaProsa: string | undefined;
  let antefirmaProsa: string | undefined;
  let notaAutorizacionProsa: string | undefined;
  if (bancoTemplate && classifierResult.tipoEfectivo) {
    const baseCtx: ProsaContext = {
      apoderado: { ...apoderadoPayload, tipo: classifierResult.tipoEfectivo },
      poderdante: poderdantePayload as ProsaContext["poderdante"],
      instrumento: instrumentoPayload as ProsaContext["instrumento"],
      ciudad_firma: ne.notaria_emisora_ciudad || null,
      notas_adicionales: null,
    };
    // Plan v5/Fase 2 — aplica override por trámite (Modal Híbrido). Manual > OCR > BD.
    const ctx = mergeOverride(baseCtx, prosaOverride ?? null);
    comparecenciaProsa = bancoTemplate.renderComparecencia(ctx);
    antefirmaProsa = bancoTemplate.renderAntefirma(ctx);
    notaAutorizacionProsa = bancoTemplate.renderNotaAutorizacion(ctx);
  }
  const prosaOverrides = {
    comparecencia_prosa: comparecenciaProsa,
    antefirma_prosa: antefirmaProsa,
    nota_autorizacion_prosa: notaAutorizacionProsa,
    apoderado_es_juridica: classifierResult.tipoEfectivo === "juridica" || undefined,
    apoderado_es_natural: classifierResult.tipoEfectivo === "natural" || undefined,
    apoderado_tipo_efectivo: classifierResult.tipoEfectivo || undefined,
    apoderado_ambiguo: classifierResult.tipoEfectivo === null || undefined,
  };
  Object.assign(_v2Overrides as Record<string, unknown>, prosaOverrides);

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
    deudor_nombre: deudoresNombres || data.partes.deudor_nombre,
    deudor_identificacion: deudoresCedulas || data.partes.deudor_identificacion,
    deudor_tipo_id: deudorTipoIdMostrado,
    comparecientes_deudores_prosa: comparecientesDeudoresProsa || undefined,
    firmas_deudores_prosa: firmasDeudoresProsa || undefined,
    banco_acreedor: data.partes.banco_acreedor,
    banco_nit: data.partes.banco_nit,
    // Ley 546
    aplica_ley_546: data.analisis_legal.aplica_ley_546,
    // Apoderado dinámico (sin hardcode). undefined → nullGetter → "___________"
    // Guard defensivo mismo patrón que H2 (cuantía): `sanitizeString` normaliza
    // basura literal ("null"/"undefined"/"nan"/"") a undefined ANTES de imprimir.
    apoderado_nombre: sanitizeString(pb.apoderado_nombre),
    apoderado_cedula: sanitizeString(pb.apoderado_cedula),
    apoderado_escritura: formatProtocoloEscritura(sanitizeString(pb.apoderado_escritura) || ""),
    apoderado_fecha: sanitizeString(pb.apoderado_fecha),
    apoderado_fecha_dia: sanitizeString(pb.apoderado_fecha_dia) || fpPoder.dia || undefined,
    apoderado_fecha_mes: sanitizeString(pb.apoderado_fecha_mes) || fpPoder.mes || undefined,
    apoderado_fecha_ano: sanitizeString(pb.apoderado_fecha_anio) || fpPoder.ano || undefined,
    apoderado_notaria_poder: formatProtocoloNotaria(sanitizeString(pb.apoderado_notaria_poder) || ""),
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
    // FASE 2 — Capa protocolo TEXTO (NÚMERO). Idempotente. Las atómicas siguen intactas arriba.
    escritura_hipoteca_numero_letras: escrituraHipotecaNumLetras || undefined,
    notaria_hipoteca_numero_letras: notariaHipotecaNumLetras || undefined,
    escritura_nueva_numero_letras: escrituraNuevaNumLetras || (ne as Record<string, string>).numero_escritura_nueva_letras || undefined,
    notaria_emisora_numero_letras: notariaEmisoraNumLetras || undefined,
    fecha_escritura_hipoteca_letras: fechaEscrituraHipotecaLetras || undefined,
    fecha_otorgamiento_nueva_prosa: fechaOtorgamientoNuevaLetras || (ne as Record<string, string>).fecha_otorgamiento_nueva_letras || undefined,
    apoderado_fecha_letras: apoderadoFechaLetras || undefined,
    valor_hipoteca_protocolo: valorHipotecaProtocolo,
    // Tokens de flexión de género gramatical (motor compartido)
    ...tokensDeudor,
    ...tokensApoderado,
    ...tokensBanco,
    // ── MERGE FINAL — los overrides V2 atómicos pisan defaults derivados ──
    // Orden de precedencia: defaults (regex IA) ← _v2Overrides (atómicos del
    // schema/builder) ← edición manual (ya inyectada en `data.*` desde data_final).
    // ts-ignore: el override intencional dispara TS2783/2785 sobre claves repetidas.
    ...(_v2Overrides as Record<string, unknown>),
    // V5/B3 — array filtrado para el loop {#apoderado_representantes} de la
    // plantilla v3. `undefined` en flujo legacy: docxtemplater omite el loop.
    apoderado_representantes: apoderadoRepresentantes,
  };
}

async function fillTemplate(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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

/**
 * Helper compartido: genera minuta+certificado a partir de un `CancelacionData`,
 * sube los .docx al bucket de salida y retorna los paths uploadeados.
 *
 * Reusado por:
 *   1. Flujo normal (heavyWork) — cuando no hay NO_LEGIBLE.
 *   2. Modo `regen` (re-mapeo docx sin cobrar).
 *   3. Acción `confirm_manual_review` — desbloqueo post-revisión humana.
 *
 * NO actualiza el row de `cancelaciones`. Solo genera+sube y devuelve paths.
 * El caller decide qué campos escribir (status, url_*, timestamps, etc.).
 */
export class ManualReviewRequiredError extends Error {
  readonly code = "MANUAL_REVIEW_REQUIRED";
  constructor(
    public readonly paths: string[],
    public readonly motivos: string[],
  ) {
    super(
      `Generación bloqueada: ${paths.length} campo(s) NO_LEGIBLE, ` +
      `${motivos.length} hard-block de coherencia.`,
    );
    this.name = "ManualReviewRequiredError";
  }
}

export async function generateAndUploadCancelacionDocs(
  // deno-lint-ignore no-explicit-any
  supabaseService: any,
  cancelacionId: string,
  data: CancelacionData,
  prosaApoderadoOverride: ProsaApoderadoOverride | null,
): Promise<{ minutaPath: string; certPath: string }> {
  // Fail-safe por construcción: bloquear si persiste NO_LEGIBLE o hard-block.
  // Cubre los 3 call sites (flujo normal, confirm_manual_review, regen)
  // y cualquier call site futuro.
  const revision = detectRequiereRevisionManual(data);
  if (revision.requiere) {
    throw new ManualReviewRequiredError(revision.paths, revision.motivos);
  }

  const vars = buildDocxVars(data, prosaApoderadoOverride);
  const minutaTemplate = selectMinutaTemplate(data);
  const minuta = await fillTemplate(supabaseService, minutaTemplate, vars);
  const certificado = await fillTemplate(supabaseService, TEMPLATE_CERT, vars);

  const minutaPath = `cancelaciones/${cancelacionId}/minuta.docx`;
  const certPath = `cancelaciones/${cancelacionId}/certificado.docx`;
  const { error: upMinErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(minutaPath, minuta, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upMinErr) throw new Error(`Upload minuta: ${upMinErr.message}`);
  const { error: upCertErr } = await supabaseService.storage.from(BUCKET_OUTPUT).upload(certPath, certificado, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upCertErr) throw new Error(`Upload certificado: ${upCertErr.message}`);
  return { minutaPath, certPath };
}

/**
 * Detector NO_LEGIBLE + coherencia post-merge. Inspecciona:
 *  1) los 6 paths del prompt v7 con centinela textual "NO_LEGIBLE".
 *  2) `_coherencia_warnings` que fueron marcados como hard-block (por
 *     `validate.ts::isHardBlockCoherenciaWarning` — sufijos _no_legible,
 *     _incoherente, _placeholder, _duplicidad_cruzada).
 * Decide si la cancelación debe frenar antes de generar la minuta
 * (Fase E — bloqueo duro con override manual).
 */
export function detectRequiereRevisionManual(extracted: CancelacionData): {
  requiere: boolean;
  paths: string[];
  motivos: string[];
} {
  const pb = (extracted.poder_banco || {}) as Record<string, unknown>;
  const apo = (pb.apoderado || {}) as Record<string, unknown>;
  const ins = (pb.instrumento_poder || {}) as Record<string, unknown>;
  const candidates: Array<[string, unknown]> = [
    ["poder_banco.apoderado_cedula", pb.apoderado_cedula],
    ["poder_banco.apoderado_escritura", pb.apoderado_escritura],
    ["poder_banco.apoderado_fecha", pb.apoderado_fecha],
    ["poder_banco.apoderado.cedula", apo.cedula],
    ["poder_banco.instrumento_poder.escritura_num", ins.escritura_num],
    ["poder_banco.instrumento_poder.fecha", ins.fecha],
  ];
  const paths = candidates.filter(([, v]) => v === "NO_LEGIBLE").map(([p]) => p);

  const warnings = Array.isArray(pb._coherencia_warnings)
    ? (pb._coherencia_warnings as unknown[]).filter((w): w is string => typeof w === "string")
    : [];
  const motivos = warnings.filter(isHardBlockCoherenciaWarning);

  return {
    requiere: paths.length > 0 || motivos.length > 0,
    paths,
    motivos,
  };
}

async function createSignedStorageUrl(

  // deno-lint-ignore no-explicit-any
  supabase: any,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_OUTPUT)
    .createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) throw new Error(`No se pudo firmar PDF ${path}: ${error?.message}`);
  return data.signedUrl;
}

// ──────────────────────────────────────────────────────────────────────
// PODER BANCARIO — OCR DEDICADO (Eje B v2)
// Una sola llamada multimodal a gemini-2.5-flash con TODAS las páginas del
// poder. Salida tipada exactamente al sub-schema PoderBanco que consume
// buildDocxVars → permite Read-then-Merge directo sin mapeo intermedio.
// ──────────────────────────────────────────────────────────────────────
const poderDedicadoTool = [
  {
    type: "function" as const,
    function: {
      name: "extract_poder_banco_dedicado",
      description: "Extrae los datos del apoderado del banco a partir de TODAS las páginas del Poder General adjunto. La cláusula de designación suele estar al final del documento.",
      parameters: {
        type: "object",
        properties: {
          apoderado_nombre: { type: "string", description: "Nombre completo del apoderado en MAYÚSCULAS." },
          apoderado_cedula: { type: "string", description: "Cédula del apoderado, estrictamente numérica con puntos de miles, ej: '79.123.456'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
          apoderado_escritura: { type: "string", description: "Número de escritura del poder en LETRAS Y NÚMEROS, ej: 'DOS MIL CUATROCIENTOS QUINCE (2415)'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
          apoderado_fecha: { type: "string", description: "Fecha del poder en formato notarial completo: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
          apoderado_notaria_poder: { type: "string", description: "Notaría donde se otorgó el poder en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y DOS (32) DE BOGOTA D.C.'. OMITE el campo si es ilegible (NO devuelvas la cadena \"null\")." },
        },
        required: ["apoderado_nombre"],
        additionalProperties: false,
      },
    },
  },
];

const PODER_DEDICADO_SYSTEM = `Eres un sistema OCR jurídico especializado EXCLUSIVAMENTE en extraer la designación de apoderado y sus datos de identificación a partir de un Poder General otorgado por un banco colombiano (típicamente Banco Davivienda S.A.).

ALCANCE MULTIPÁGINA: el usuario puede enviarte hasta 50 páginas en un único turno multimodal. La cláusula que designa al apoderado y enumera sus facultades suele aparecer en las PÁGINAS FINALES — revisa TODAS las páginas, no solo las primeras.

PALABRAS CLAVE para localizar al apoderado: 'CONFIERE PODER', 'APODERADO', 'REPRESENTANTE LEGAL', 'OTORGA PODER GENERAL', 'FACULTA A', 'ESCRITURA PÚBLICA No.', 'NOTARÍA'.

FORMATO DE SALIDA (estricto):
- apoderado_nombre: nombre completo en MAYÚSCULAS.
- apoderado_cedula: solo dígitos con puntos de miles, ej: '79.123.456'.
- apoderado_escritura: 'DOS MIL CUATROCIENTOS QUINCE (2415)'.
- apoderado_fecha: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'.
- apoderado_notaria_poder: 'TREINTA Y DOS (32) DE BOGOTA D.C.'.

ANTI-ALUCINACIÓN:
- Si un campo individual es humanamente ilegible, **OMÍTELO del JSON** (no lo incluyas). NO devuelvas la cadena "null" ni cadena vacía "".
- Si encuentras al menos el nombre del apoderado, devuelve el objeto con los demás campos omitidos cuando no los puedas confirmar.
- PROHIBIDO devolver 'N/A', 'ilegible', '?', '---', 'null' o reconstrucciones inventadas.

Llama SIEMPRE a la herramienta extract_poder_banco_dedicado.`;

interface PoderDedicadoResult {
  apoderado_nombre?: string | null;
  apoderado_cedula?: string | null;
  apoderado_escritura?: string | null;
  apoderado_fecha?: string | null;
  apoderado_notaria_poder?: string | null;
}

async function extractPoderBancoDedicado(
  poderUrls: string[],
  apiKey: string,
): Promise<PoderDedicadoResult | null> {
  if (poderUrls.length === 0) return null;
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: `Analiza las ${poderUrls.length} páginas adjuntas como un único Poder General bancario y extrae los datos del apoderado. Llama a extract_poder_banco_dedicado.`,
    },
    ...poderUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  const aiResp = await fetchAiGateway({
    apiKey,
    body: {
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: PODER_DEDICADO_SYSTEM },
        { role: "user", content: userContent },
      ],
      tools: poderDedicadoTool,
      tool_choice: { type: "function", function: { name: "extract_poder_banco_dedicado" } },
    },
    tag: "procesar-cancelacion.poder",
  });
  return await parseToolCallArguments<PoderDedicadoResult>(aiResp, "procesar-cancelacion.poder");
}

// Read-then-Merge: el OCR dedicado rellena los huecos del monolítico.
// Humano (data_final) > OCR dedicado > OCR monolítico.
function mergePoderBanco(
  monolitico: PoderBanco | undefined,
  dedicado: PoderDedicadoResult | null,
): PoderBanco | undefined {
  if (!monolitico && !dedicado) return undefined;
  const pick = (m?: string | null, d?: string | null): string | undefined => {
    // Dedicado pisa monolítico si el monolítico es null/empty/"null"/"undefined"/"nan".
    // Delegamos a `sanitizeString` (fuente única) para no reintroducir la basura literal.
    return sanitizeString(m) ?? sanitizeString(d);
  };
  const merged: PoderBanco = {
    apoderado_nombre: pick(monolitico?.apoderado_nombre, dedicado?.apoderado_nombre),
    apoderado_cedula: pick(monolitico?.apoderado_cedula, dedicado?.apoderado_cedula),
    apoderado_escritura: pick(monolitico?.apoderado_escritura, dedicado?.apoderado_escritura),
    apoderado_fecha: pick(monolitico?.apoderado_fecha, dedicado?.apoderado_fecha),
    apoderado_notaria_poder: pick(monolitico?.apoderado_notaria_poder, dedicado?.apoderado_notaria_poder),
  };
  // Preserva atómicos de fecha si vinieron del monolítico (no los rompemos).
  if (monolitico?.apoderado_fecha_dia) merged.apoderado_fecha_dia = monolitico.apoderado_fecha_dia;
  if (monolitico?.apoderado_fecha_mes) merged.apoderado_fecha_mes = monolitico.apoderado_fecha_mes;
  if (monolitico?.apoderado_fecha_anio) merged.apoderado_fecha_anio = monolitico.apoderado_fecha_anio;
  // Si TODOS los campos quedaron undefined, devuelve undefined (no objeto fantasma).
  const hasAny = Object.values(merged).some((v) => v !== undefined && v !== "");
  return hasAny ? merged : undefined;
}

// ═════════════════════════════════════════════════════════════════════════
// EXTRACTOR V6 (schema profundo isomórfico) — opt-in vía POWER_V6_EXTRACTOR_ENABLED
// ═════════════════════════════════════════════════════════════════════════

// Merge v6 vive en el módulo isomórfico para poder testearse desde vitest
// (el archivo actual tiene imports Deno + errores TS preexistentes que
// bloquean el test-runner de Deno).
import { mergePoderBancoV6 as mergeV6Iso } from "../_shared/isomorphic/poderBancoExtractor/merge.ts";
import { validatePoderBancoCoherencia, isHardBlockCoherenciaWarning } from "../_shared/isomorphic/poderBancoExtractor/validate.ts";
import { detectDuplicidadCruzada, type ExistingPoderRow } from "../_shared/isomorphic/poderBancoExtractor/crossCheck.ts";
import { validatePoderVsCancelacion } from "../_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts";

/** Anota `_coherencia_warnings` y `_coherencia_suspicious` en el poder mergeado.
 *  Nunca bloquea; si hay warnings emite un system_event no bloqueante. */
async function annotatePoderCoherencia(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  merged: Record<string, unknown> | undefined | null,
  ctx: { orgId: string; cancelacionId: string; userId: string; trigger: string },
): Promise<void> {
  if (!merged) return;
  const { warnings, suspicious } = validatePoderBancoCoherencia(merged);
  (merged as Record<string, unknown>)._coherencia_warnings = warnings;
  (merged as Record<string, unknown>)._coherencia_suspicious = Array.from(suspicious);
  if (warnings.length === 0) return;
  try {
    await supabase.from("system_events").insert({
      organization_id: ctx.orgId,
      tramite_id: ctx.cancelacionId,
      user_id: ctx.userId,
      evento: "procesar-cancelacion.poder.coherencia",
      resultado: "warnings",
      categoria: "ocr_poder_banco",
      detalle: {
        trigger: ctx.trigger,
        warnings,
        suspicious: Array.from(suspicious),
      },
    });
  } catch (_) { /* no bloqueante */ }
}

/** Fase 2 — Coherencia intra-trámite: valida que el banco que otorga el poder
 *  coincida con el acreedor hipotecario extraído de la escritura/certificado
 *  del MISMO trámite. Acumula sobre `_coherencia_warnings`/`_coherencia_suspicious`
 *  sin sobreescribir lo que `annotatePoderCoherencia` ya escribió. */
async function annotatePoderIntraTramite(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  merged: Record<string, unknown> | undefined | null,
  partes: { banco_nit?: string | null; banco_acreedor?: string | null } | null | undefined,
  ctx: { orgId: string; cancelacionId: string; userId: string; trigger: string },
): Promise<void> {
  if (!merged) return;
  const { warnings, suspicious } = validatePoderVsCancelacion(merged, partes);
  if (warnings.length === 0) return;
  const prevW = Array.isArray(merged._coherencia_warnings)
    ? (merged._coherencia_warnings as string[]).filter((s) => typeof s === "string")
    : [];
  const prevS = Array.isArray(merged._coherencia_suspicious)
    ? (merged._coherencia_suspicious as string[]).filter((s) => typeof s === "string")
    : [];
  (merged as Record<string, unknown>)._coherencia_warnings = Array.from(new Set([...prevW, ...warnings]));
  (merged as Record<string, unknown>)._coherencia_suspicious = Array.from(
    new Set<string>([...prevS, ...Array.from(suspicious)]),
  );
  try {
    await supabase.from("system_events").insert({
      organization_id: ctx.orgId,
      tramite_id: ctx.cancelacionId,
      user_id: ctx.userId,
      evento: "procesar-cancelacion.poder.intra_tramite",
      resultado: "warnings",
      categoria: "ocr_poder_banco",
      detalle: { trigger: ctx.trigger, warnings, suspicious: Array.from(suspicious) },
    });
  } catch (_) { /* no bloqueante */ }
}



/** Ejecuta el chequeo de duplicidad cruzada contra el histórico de
 *  cancelaciones de la MISMA organización. Consulta hasta 500 filas más
 *  recientes (excluyendo la actual), extrae nombre+cédula del apoderado
 *  desde `data_final` (o `data_ia` como fallback), y **acumula** los
 *  warnings/suspicious en el poder ya anotado por `annotatePoderCoherencia`.
 *  Nunca lanza; en caso de error registra system_event y sale silencioso. */
async function runPoderCrossChecks(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  merged: Record<string, unknown> | undefined | null,
  ctx: { orgId: string; cancelacionId: string; userId: string; trigger: string },
): Promise<void> {
  if (!merged) return;
  const current = {
    apoderado_nombre: merged.apoderado_nombre as string | undefined,
    apoderado_cedula: merged.apoderado_cedula as string | undefined,
  };
  if (!current.apoderado_nombre && !current.apoderado_cedula) return;

  let existing: ExistingPoderRow[] = [];
  try {
    const { data, error } = await supabase
      .from("cancelaciones")
      .select("id, data_ia, data_final")
      .eq("organization_id", ctx.orgId)
      .neq("id", ctx.cancelacionId)
      .not("data_ia", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    existing = (data ?? []).map((row: Record<string, unknown>) => {
      const df = (row.data_final ?? {}) as Record<string, unknown>;
      const di = (row.data_ia ?? {}) as Record<string, unknown>;
      const pbF = (df.poder_banco ?? {}) as Record<string, unknown>;
      const pbI = (di.poder_banco ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        apoderado_nombre: (pbF.apoderado_nombre ?? pbI.apoderado_nombre) as string | undefined,
        apoderado_cedula: (pbF.apoderado_cedula ?? pbI.apoderado_cedula) as string | undefined,
      };
    });
  } catch (e) {
    try {
      await supabase.from("system_events").insert({
        organization_id: ctx.orgId,
        tramite_id: ctx.cancelacionId,
        user_id: ctx.userId,
        evento: "procesar-cancelacion.poder.crosscheck",
        resultado: "fallo",
        categoria: "ocr_poder_banco",
        detalle: { trigger: ctx.trigger, error: String(e).slice(0, 200) },
      });
    } catch (_) { /* no bloqueante */ }
    return;
  }

  const { warnings, suspicious, matches } = detectDuplicidadCruzada(current, existing);
  if (warnings.length === 0) return;

  // Acumula sobre lo que ya escribió `annotatePoderCoherencia`.
  const prevW = Array.isArray(merged._coherencia_warnings)
    ? (merged._coherencia_warnings as string[]).filter((s) => typeof s === "string")
    : [];
  const prevS = Array.isArray(merged._coherencia_suspicious)
    ? (merged._coherencia_suspicious as string[]).filter((s) => typeof s === "string")
    : [];
  (merged as Record<string, unknown>)._coherencia_warnings = Array.from(new Set([...prevW, ...warnings]));
  (merged as Record<string, unknown>)._coherencia_suspicious = Array.from(
    new Set<string>([...prevS, ...Array.from(suspicious)]),
  );

  try {
    await supabase.from("system_events").insert({
      organization_id: ctx.orgId,
      tramite_id: ctx.cancelacionId,
      user_id: ctx.userId,
      evento: "procesar-cancelacion.poder.crosscheck",
      resultado: "warnings",
      categoria: "ocr_poder_banco",
      detalle: { trigger: ctx.trigger, warnings, suspicious: Array.from(suspicious), matches, examined: existing.length },
    });
  } catch (_) { /* no bloqueante */ }
}

/**
 * Ejecuta el OCR v6 (schema profundo) usando el módulo isomórfico. Se llama
 * SOLO cuando `POWER_V6_EXTRACTOR_ENABLED` está encendido. Devuelve el
 * payload profundo tal como lo emitió Gemini (sin normalizar).
 */
async function extractPoderBancoV6(
  poderUrls: string[],
  apiKey: string,
): Promise<PoderBancoDeepPayload | null> {
  if (poderUrls.length === 0) return null;
  const body = buildPoderBancoRequest({ imageUrls: poderUrls });
  const aiResp = await fetchAiGateway({
    apiKey,
    body,
    tag: "procesar-cancelacion.poder.v6",
  });
  return await parseToolCallArguments<PoderBancoDeepPayload>(aiResp, "procesar-cancelacion.poder.v6");
}

/**
 * Wrapper local que preserva la firma legacy (`PoderBanco | undefined`)
 * mientras delega el trabajo al merge isomórfico. Este re-tipo es seguro
 * porque `PoderBanco` es un superset laxo de `PoderBancoFlat`.
 */
export function mergePoderBancoV6(
  monolitico: PoderBanco | undefined,
  dedicadoFlat: PoderDedicadoResult | null,
  deepV6: PoderBancoDeepPayload | null,
): PoderBanco | undefined {
  const out = mergeV6Iso(
    monolitico as unknown as import("../_shared/isomorphic/poderBancoExtractor/merge.ts").PoderBancoFlat | undefined,
    dedicadoFlat as unknown as import("../_shared/isomorphic/poderBancoExtractor/merge.ts").DedicadoFlatResult | null,
    deepV6,
  );
  return out as unknown as PoderBanco | undefined;
}




// Telemetría no bloqueante a system_events (Eje A v3).
async function logPoderEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    cancelacionId: string;
    userId: string;
    resultado: "exito" | "fallo" | "parcial" | "sin_poder";
    paginas_enviadas: number;
    poder_banco_presente: boolean;
    campos_llenos: number;
    tiempo_ms?: number;
    extra?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("system_events").insert({
      organization_id: opts.orgId,
      tramite_id: opts.cancelacionId,
      user_id: opts.userId,
      evento: "procesar-cancelacion.poder",
      resultado: opts.resultado,
      categoria: "ocr_poder_banco",
      detalle: {
        paginas_enviadas: opts.paginas_enviadas,
        poder_banco_presente: opts.poder_banco_presente,
        campos_llenos: opts.campos_llenos,
        ...(opts.extra ?? {}),
      },
      tiempo_ms: opts.tiempo_ms ?? null,
    });
  } catch (_) { /* telemetría no bloqueante */ }
}


// ──────────────────────────────────────────────────────────────────────
// CUANTÍA DEL CRÉDITO — OCR DEDICADO (Eje B v3)
// Cuando el Certificado de Tradición registra la hipoteca como "CUANTÍA
// INDETERMINADA" / "ABIERTA", el monto efectivo SOLO existe dentro de la
// escritura escaneada (cláusula de Mutuo / cláusula de Pago de la
// compraventa). El monolítico Gemini 2.5 Pro tiende a respetar la marca
// del certificado y deja `valor_hipoteca_original = ""`. Este handler
// corre en PARALELO al monolítico únicamente cuando se detecta el caso,
// usa Gemini 2.5 Flash con TODAS las páginas de la escritura en un solo
// turno multimodal, y devuelve la cifra anclada sintácticamente al verbo
// rector del gravamen (skill `extraccion-cuantia-semantica`).
// ──────────────────────────────────────────────────────────────────────
export type CuantiaMotivoNull =
  | "sin_evidencia"
  | "ambigua_multiple"
  | "escritura_declara_abierta"
  | null;

export type CuantiaClasificacion =
  | "cuantia_credito"
  | "precio_venta"
  | "avaluo"
  | "subrogacion"
  | "abono_saldo"
  | "subsidio"
  | "uvr_upac"
  | "otro";

export interface CuantiaCandidato {
  texto_fragmento: string;
  clasificacion: CuantiaClasificacion;
  monto: number | null;
  pagina_aprox?: number | null;
}

const cuantiaDedicadaTool = [
  {
    type: "function" as const,
    function: {
      name: "extract_cuantia_credito_dedicada",
      description: "Determina la cuantía del CRÉDITO HIPOTECARIO (mutuo) razonando semánticamente sobre TODAS las cifras monetarias del documento. NO usa lista fija de verbos: clasifica cada cifra por su rol semántico (cuantia_credito / precio_venta / avaluo / subrogacion / abono_saldo / subsidio / uvr_upac / otro), desambigua entre las clasificadas como cuantia_credito, y devuelve el ganador o un motivo_null específico.",
      parameters: {
        type: "object",
        properties: {
          valor_hipoteca_original: {
            type: ["string", "null"],
            description: "Monto del crédito hipotecario en formato notarial estricto: '<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)'. Devuelve JSON null (NUNCA cadena vacía) si la escritura declara la hipoteca ABIERTA/INDETERMINADA, si hay ambigüedad irreconciliable, o si no hay evidencia.",
          },
          valor_hipoteca_es_indeterminada: {
            type: "boolean",
            description: "true SOLO si la escritura declara expresamente 'HIPOTECA ABIERTA', 'SIN LÍMITE DE CUANTÍA' o 'DE CUANTÍA INDETERMINADA'. En cualquier otro caso false.",
          },
          confianza: {
            type: "string",
            enum: ["alta", "media", "baja"],
            description: "Nivel de confianza en la decisión final del PASO 3.",
          },
          motivo_null: {
            type: ["string", "null"],
            enum: ["sin_evidencia", "ambigua_multiple", "escritura_declara_abierta", null],
            description: "OBLIGATORIO no-null cuando valor_hipoteca_original es null. null cuando la extracción fue exitosa.",
          },
          candidatos_vistos: {
            type: "array",
            description: "TODAS las cifras monetarias enumeradas en el PASO 1 con su clasificación semántica. NO omitir aunque haya ganador claro — esto es auditoría.",
            items: {
              type: "object",
              properties: {
                texto_fragmento: {
                  type: "string",
                  maxLength: 200,
                  description: "Fragmento textual literal alrededor de la cifra (~140 chars).",
                },
                clasificacion: {
                  type: "string",
                  enum: ["cuantia_credito", "precio_venta", "avaluo", "subrogacion", "abono_saldo", "subsidio", "uvr_upac", "otro"],
                },
                monto: {
                  type: ["integer", "null"],
                  description: "Entero en pesos, sin decimales ni separadores. null si la cifra está expresada solo en UVR/UPAC.",
                },
                pagina_aprox: {
                  type: ["integer", "null"],
                },
              },
              required: ["texto_fragmento", "clasificacion", "monto"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "valor_hipoteca_original",
          "valor_hipoteca_es_indeterminada",
          "motivo_null",
          "candidatos_vistos",
        ],
        additionalProperties: false,
      },
    },
  },
];

const CUANTIA_DEDICADA_SYSTEM = `Eres un sistema OCR jurídico-notarial colombiano. Tu única tarea es determinar la CUANTÍA DEL CRÉDITO HIPOTECARIO (mutuo) documentada en una Escritura Pública de Constitución de Hipoteca, cuando el Certificado de Tradición la registra como "CUANTÍA INDETERMINADA / ABIERTA".

ALCANCE: hasta 30 páginas multimodales en un turno. La cifra puede estar en carátula, cláusula de mutuo, cláusula de pago de la compraventa, casilla de liquidación, o cualquier parte del cuerpo — recorre TODO.

PROCEDIMIENTO OBLIGATORIO (en este orden):

PASO 1 — ENUMERAR
Lista TODAS las cifras monetarias en pesos colombianos ($) que veas en el documento, sin filtrar. Para cada una captura el fragmento textual literal (máx. ~140 caracteres alrededor de la cifra) tal como aparece.

PASO 2 — CLASIFICAR
Para cada cifra, decide su rol SEGÚN EL CONTEXTO SEMÁNTICO que la rodea (no por proximidad a palabras clave). Clasifica en UNA de estas categorías:

  - "cuantia_credito"    → la suma que el banco presta / concede / desembolsa / entrega al deudor, O que la escritura llama explícitamente cuantía del mutuo, valor del crédito, monto del préstamo, cuantía del crédito otorgado, o equivalente semántico (aunque el verbo no esté conjugado: construcciones nominales tipo "la cuantía del crédito otorgado es: $X" cuentan).
  - "precio_venta"       → precio de la compraventa del inmueble.
  - "avaluo"             → avalúo catastral o comercial.
  - "subrogacion"        → liberación / subrogación de gravamen previo.
  - "abono_saldo"        → abono, saldo pendiente, cuota inicial.
  - "subsidio"           → subsidio familiar, cesantías aplicadas.
  - "uvr_upac"           → cifra expresada en UVR o UPAC (nunca en pesos como cuantía principal — la real está en pesos M/CTE).
  - "otro"               → honorarios, gastos notariales, impuestos, seguros, tasas, cualquier otro concepto.

PASO 3 — DESAMBIGUAR (elige UNA salida)

  a) Exactamente UNA cifra clasificada como "cuantia_credito"
     → úsala. Confianza = "alta".

  b) VARIAS cifras "cuantia_credito" con el MISMO monto normalizado (mismo entero en pesos, ignorando formato/decimales/UVR paralelo)
     → úsala. Confianza = "alta" (redundancia entre mutuo, pago y liquidación es lo esperado en escrituras bien redactadas).

  c) VARIAS cifras "cuantia_credito" con montos DISTINTOS que no puedes conciliar
     → valor_hipoteca_original = null, motivo_null = "ambigua_multiple". Confianza = "baja".

  d) CERO cifras "cuantia_credito" pero la escritura declara expresamente "HIPOTECA ABIERTA", "SIN LÍMITE DE CUANTÍA" o "DE CUANTÍA INDETERMINADA"
     → valor_hipoteca_original = null, valor_hipoteca_es_indeterminada = true, motivo_null = "escritura_declara_abierta". Confianza = "alta".

  e) CERO cifras "cuantia_credito" y sin declaración de apertura
     → valor_hipoteca_original = null, motivo_null = "sin_evidencia". Confianza = "baja".

REGLAS DE FORMATO (solo aplican a los casos a/b):
- valor_hipoteca_original = "<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)"
- valor_hipoteca_es_indeterminada = false
- motivo_null = null

ANTI-ALUCINACIÓN (estricto):
- NUNCA promuevas a "cuantia_credito" una cifra cuyo contexto la ubica en las categorías precio_venta / avaluo / subrogacion / abono_saldo / subsidio / uvr_upac / otro. Estas cifras se enumeran y clasifican, pero se descartan.
- NUNCA inventes una cifra que no aparece literalmente en el documento.
- NUNCA devuelvas "N/A", "ilegible", "?", "---" ni literales descriptivos en el campo de monto. Si dudas, monto = null con motivo_null correcto.
- Si el texto es ilegible en una cifra, no la incluyas en candidatos_vistos.

DEVUELVE SIEMPRE candidatos_vistos con TODAS las cifras enumeradas en PASO 1 (no solo la ganadora). Esto es auditoría — no lo omitas ni siquiera en el caso a).

EJEMPLOS:

Ejemplo 1 — MUTUO clásico (verbo conjugado)
  Fragmento: "…el BANCO POPULAR S.A. concede al deudor un mutuo por la suma de VEINTICINCO MILLONES DE PESOS ($25.000.000) M/CTE, garantizado con hipoteca…"
  Salida: valor_hipoteca_original = "VEINTICINCO MILLONES DE PESOS ($25.000.000)", valor_hipoteca_es_indeterminada = false, motivo_null = null, confianza = "alta", candidatos_vistos incluye {clasificacion:"cuantia_credito", monto:25000000}.

Ejemplo 2 — Construcción nominal de carátula (escrituras 90s–2000s)
  Fragmentos: "PARA EFECTOS DE LIQUIDACIÓN, LA CUANTÍA DEL CRÉDITO OTORGADO ES: $ 8.558.475.oo" + "precio de venta: $65.000.000" + "avalúo catastral: $12.400.000".
  Salida: valor_hipoteca_original = "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)", valor_hipoteca_es_indeterminada = false, motivo_null = null, confianza = "alta", candidatos_vistos = [{..., "cuantia_credito", 8558475}, {..., "precio_venta", 65000000}, {..., "avaluo", 12400000}].

Ejemplo 3 — Ambigüedad real (dos cifras de crédito irreconciliables → null)
  Fragmentos: "cláusula sexta: el mutuo asciende a CINCUENTA MILLONES DE PESOS ($50.000.000)" + "cláusula décima: reliquidado el crédito, el saldo insoluto es SESENTA Y DOS MILLONES DE PESOS ($62.000.000) al momento del otorgamiento".
  Salida: valor_hipoteca_original = null, valor_hipoteca_es_indeterminada = false, motivo_null = "ambigua_multiple", confianza = "baja", candidatos_vistos = [{..., "cuantia_credito", 50000000}, {..., "cuantia_credito", 62000000}].

Llama SIEMPRE a la herramienta extract_cuantia_credito_dedicada.`;

export interface CuantiaDedicadaResult {
  valor_hipoteca_original?: string | null;
  valor_hipoteca_es_indeterminada?: boolean;
  confianza?: "alta" | "media" | "baja";
  motivo_null?: CuantiaMotivoNull;
  candidatos_vistos?: CuantiaCandidato[];
}

export interface CuantiaDedicadaRun {
  result: CuantiaDedicadaResult | null;
  paginas_totales: number;
  paginas_enviadas: number;
  truncado: boolean;
  error_status?: number | "network" | "parse";
  error_msg?: string;
}

/**
 * Deriva la etiqueta `resultado` para system_events a partir del run del
 * extractor dedicado. Reemplaza el balde único "fallo_ambiguo" con
 * etiquetas semánticamente accionables. Los códigos de error http/red se
 * conservan tal cual (fallo_413 / fallo_red / fallo_<n> / fallo_parse).
 */
export function deriveCuantiaResultado(run: CuantiaDedicadaRun | null): string {
  if (!run) return "fallo_sin_evidencia";
  if (run.error_status === 413) return "fallo_413";
  if (run.error_status === "network") return "fallo_red";
  if (run.error_status === "parse") return "fallo_parse";
  if (typeof run.error_status === "number") return `fallo_${run.error_status}`;
  // La indeterminación confirmada gana sobre cualquier string en
  // valor_hipoteca_original: si la escritura declara HIPOTECA ABIERTA,
  // la telemetría debe reflejar ese estado semántico, no "exito".
  const esIndet = run.result?.valor_hipoteca_es_indeterminada === true;
  const motivo = run.result?.motivo_null;
  if (esIndet && motivo === "escritura_declara_abierta") return "indeterminada_confirmada";
  const monto = (run.result?.valor_hipoteca_original ?? "").trim();
  if (monto) return "exito";
  if (motivo === "escritura_declara_abierta") return "indeterminada_confirmada";
  if (motivo === "ambigua_multiple") return "fallo_ambiguo_multiple";
  if (motivo === "sin_evidencia") return "fallo_sin_evidencia";
  return "fallo_ambiguo_desconocido";
}

/**
 * Bloque `extra` común de telemetría con candidatos_vistos y motivo_null.
 * Usado en el flujo auto y en reprocess_cuantia.
 */
export function buildCuantiaExtra(run: CuantiaDedicadaRun | null, trigger: string): Record<string, unknown> {
  const candidatos = run?.result?.candidatos_vistos ?? [];
  return {
    trigger,
    paginas_totales: run?.paginas_totales ?? 0,
    truncado: run?.truncado ?? false,
    error_status: run?.error_status,
    error_msg: run?.error_msg,
    motivo_null: run?.result?.motivo_null ?? null,
    confianza: run?.result?.confianza ?? null,
    candidatos_vistos: candidatos,
    candidatos_cuantia_credito_count: candidatos.filter((c) => c.clasificacion === "cuantia_credito").length,
  };
}

// Tope de páginas para mantenernos por debajo del límite de 30MB del gateway
// upstream (Gemini). Empíricamente 25 páginas a 180dpi caben holgadamente.
// La cláusula del mutuo / liquidación está casi siempre en la carátula o
// cierre, así que el muestreo head+tail captura el 100% de los casos reales.
const MAX_CUANTIA_PAGES = 25;
const CUANTIA_HEAD = 20;
const CUANTIA_TAIL = 5;

function sliceHeadTail(urls: string[]): { sliced: string[]; truncado: boolean } {
  if (urls.length <= MAX_CUANTIA_PAGES) return { sliced: urls, truncado: false };
  return { sliced: [...urls.slice(0, CUANTIA_HEAD), ...urls.slice(-CUANTIA_TAIL)], truncado: true };
}

export async function extractCuantiaDedicada(
  escUrls: string[],
  apiKey: string,
): Promise<CuantiaDedicadaRun> {
  const paginas_totales = escUrls.length;
  if (paginas_totales === 0) {
    return { result: null, paginas_totales: 0, paginas_enviadas: 0, truncado: false };
  }
  const { sliced, truncado } = sliceHeadTail(escUrls);
  const paginas_enviadas = sliced.length;

  const userText = truncado
    ? `Recibirás un fragmento optimizado de ${paginas_enviadas} páginas (primeras ${CUANTIA_HEAD} + últimas ${CUANTIA_TAIL}) de una escritura que originalmente tiene ${paginas_totales} páginas para evitar límites de tamaño. Concéntrate en la carátula, cláusulas iniciales de mutuo o liquidación final para hallar el valor del crédito. Aplica anclaje sintáctico al verbo rector del gravamen e ignora la lista negra. Llama a extract_cuantia_credito_dedicada.`
    : `Analiza las ${paginas_enviadas} páginas adjuntas como una única Escritura Pública de Constitución de Hipoteca y extrae la cuantía del crédito (mutuo). Aplica anclaje sintáctico al verbo rector del gravamen e ignora la lista negra. Llama a extract_cuantia_credito_dedicada.`;

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: userText },
    ...sliced.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];

  try {
    const aiResp = await fetchAiGateway({
      apiKey,
      body: {
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: CUANTIA_DEDICADA_SYSTEM },
          { role: "user", content: userContent },
        ],
        tools: cuantiaDedicadaTool,
        tool_choice: { type: "function", function: { name: "extract_cuantia_credito_dedicada" } },
      },
      tag: "procesar-cancelacion.cuantia",
    });
    const result = await parseToolCallArguments<CuantiaDedicadaResult>(aiResp, "procesar-cancelacion.cuantia");
    return { result, paginas_totales, paginas_enviadas, truncado };
  } catch (e) {
    if (e instanceof AiGatewayError) {
      if (e.status === 413) {
        console.error(`[procesar-cancelacion.cuantia] PAYLOAD_TOO_LARGE paginas=${paginas_enviadas} totales=${paginas_totales}`);
      } else {
        console.error(`[procesar-cancelacion.cuantia] AiGatewayError status=${e.status} msg=${e.message}`);
      }
      return { result: null, paginas_totales, paginas_enviadas, truncado, error_status: e.status, error_msg: e.message.slice(0, 200) };
    }
    console.error("[procesar-cancelacion.cuantia] unexpected error:", e);
    return { result: null, paginas_totales, paginas_enviadas, truncado, error_status: "network", error_msg: String(e).slice(0, 200) };
  }
}

/**
 * Read-then-Merge específico para la cuantía. Reglas:
 *  - El monolítico Gemini 2.5 Pro produce `valor_hipoteca_original` y
 *    `valor_hipoteca_es_indeterminada` leyendo el certificado.
 *  - El OCR dedicado solo PISA al monolítico si éste dejó la cuantía
 *    vacía o marcada como indeterminada (caso típico: cert "INDETERMINADA",
 *    escritura sí trae cifra). Cuando la cuantía del dedicado se inyecta,
 *    se etiqueta con `cuantia_origen = "escritura"` para que la UI muestre
 *    el banner informativo azul.
 *  - Edición manual (data_final) SIEMPRE gana — este merge solo aplica
 *    sobre el resultado fresco del monolítico, no sobrescribe humano.
 */
export function mergeCuantiaIntoExtracted(
  extracted: CancelacionData,
  dedicada: CuantiaDedicadaResult | null,
): { applied: boolean; monto: string | null } {
  if (!dedicada) return { applied: false, monto: null };
  const monoMonto = (extracted.hipoteca_anterior.valor_hipoteca_original ?? "").trim();
  const monoIndet = extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
  const certVacio = monoMonto === "" || monoIndet || /^(null|undefined|nan)$/i.test(monoMonto);
  if (!certVacio) return { applied: false, monto: null };
  const dedicadaMonto = (dedicada.valor_hipoteca_original ?? "").trim();
  const dedicadaIndet = dedicada.valor_hipoteca_es_indeterminada === true
    || dedicada.motivo_null === "escritura_declara_abierta";
  if (dedicadaMonto) {
    extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
    extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = false;
    extracted.hipoteca_anterior.cuantia_origen = "escritura";
    return { applied: true, monto: dedicadaMonto };
  }
  if (dedicadaIndet) {
    // Propagación explícita: el extractor dedicado confirmó HIPOTECA ABIERTA.
    // Escribimos vacío REAL (no "null"), flag=true, origen=escritura. Sin esto,
    // el estado basura del monolítico sobrevive y termina en la prosa.
    extracted.hipoteca_anterior.valor_hipoteca_original = "";
    extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = true;
    extracted.hipoteca_anterior.cuantia_origen = "escritura";
    return { applied: true, monto: null };
  }
  return { applied: false, monto: null };
}

// Telemetría no bloqueante.
async function logCuantiaEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    cancelacionId: string;
    userId: string;
    resultado: string;
    paginas_enviadas: number;
    cert_indeterminada: boolean;
    monto_encontrado: boolean;
    aplicado: boolean;
    tiempo_ms?: number;
    extra?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("system_events").insert({
      organization_id: opts.orgId,
      tramite_id: opts.cancelacionId,
      user_id: opts.userId,
      evento: "procesar-cancelacion.cuantia",
      resultado: opts.resultado,
      categoria: "ocr_cuantia_credito",
      detalle: {
        paginas_enviadas: opts.paginas_enviadas,
        cert_indeterminada: opts.cert_indeterminada,
        monto_encontrado: opts.monto_encontrado,
        aplicado: opts.aplicado,
        ...(opts.extra ?? {}),
      },
      tiempo_ms: opts.tiempo_ms ?? null,
    });
  } catch (_) { /* telemetría no bloqueante */ }
}






if (import.meta.main) serve(async (req) => {
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
    /** "reprocess_poder"      → re-extrae solo el Poder con OCR dedicado.
     *  "reprocess_cuantia"    → re-extrae solo la cuantía del crédito a partir
     *                           de la escritura antecedente (cuando el certificado
     *                           vino como indeterminado). Ninguno cobra créditos.
     *  "confirm_manual_review" → desbloqueo Fase E: confirma revisión humana
     *                           tras NO_LEGIBLE y dispara generación de minuta. */
    action?: "reprocess_poder" | "reprocess_cuantia" | "confirm_manual_review";

  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // MODO REGRESSION_CUANTIA (solo lectura, platform-admin only):
  // ejecuta extractCuantiaDedicada contra las páginas de la escritura
  // ya almacenadas en storage para una lista de trámites históricos.
  // NO escribe en cancelaciones, NO llama logCuantiaEvent, NO consume
  // créditos. Se usa para validar regresiones del prompt semántico.
  // ─────────────────────────────────────────────────────────────
  // deno-lint-ignore no-explicit-any
  const bodyAny = body as any;
  if (bodyAny?.action === "regression_cuantia") {
    const { data: isAdminData, error: isAdminErr } = await supabaseUser.rpc("is_platform_admin");
    if (isAdminErr || isAdminData !== true) {
      return new Response(JSON.stringify({ error: "Forbidden: platform admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const ids = Array.isArray(bodyAny.tramite_ids) ? (bodyAny.tramite_ids as unknown[]).filter((x) => typeof x === "string") as string[] : [];
    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: "tramite_ids (string[]) requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY_REG = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY_REG) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const results = await Promise.all(ids.map(async (id) => {
      try {
        const prefix = `${id}/cancelaciones/soportes/escritura`;
        const { data: files, error: listErr } = await supabaseService.storage
          .from(BUCKET_OUTPUT).list(prefix);
        if (listErr || !files || files.length === 0) {
          return { tramite_id: id, error: `no_pages (${listErr?.message ?? "empty"}) prefix=${prefix}` };
        }
        const paths = files
          .filter((f: { name?: string }) => f.name && /\.jpe?g$/i.test(f.name))
          .sort((a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? ""))
          .map((f: { name: string }) => `${prefix}/${f.name}`);
        if (paths.length === 0) {
          return { tramite_id: id, error: `no_jpg prefix=${prefix}` };
        }
        const urls = await Promise.all(paths.map((p) => createSignedStorageUrl(supabaseService, p)));
        const t0 = Date.now();
        const run = await extractCuantiaDedicada(urls, LOVABLE_API_KEY_REG);
        const ms = Date.now() - t0;
        return {
          tramite_id: id,
          ms,
          paginas_totales: run.paginas_totales,
          paginas_enviadas: run.paginas_enviadas,
          truncado: run.truncado,
          error_status: run.error_status ?? null,
          error_msg: run.error_msg ?? null,
          monto: run.result?.valor_hipoteca_original ?? null,
          es_indeterminada: run.result?.valor_hipoteca_es_indeterminada ?? null,
          confianza: run.result?.confianza ?? null,
          motivo_null: run.result?.motivo_null ?? null,
          resultado_derivado: deriveCuantiaResultado(run),
          candidatos_vistos: run.result?.candidatos_vistos ?? [],
        };
      } catch (e) {
        return { tramite_id: id, error: (e as Error).message };
      }
    }));
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { cancelacionId, certificadoPath, certificadoImagePaths, escrituraPath, escrituraImagePaths, poderPath, poderImagePaths, regen, manualOverrides, action } = body;

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
    // ACCIÓN CONFIRM_MANUAL_REVIEW (Fase E — desbloqueo tras NO_LEGIBLE)
    // Exige que el row esté en 'requiere_revision_manual'. Marca el
    // timestamp/usuario de confirmación y dispara la generación de docs
    // usando data_final (que el usuario pudo editar). NO cobra créditos:
    // ya se cobró GENERACION_DOCX en el intento inicial que se bloqueó.
    // ─────────────────────────────────────────────────────────────
    if (action === "confirm_manual_review") {
      if (cancRow.status !== "requiere_revision_manual") {
        return biz(
          "not_pending_review",
          `La cancelación no está pendiente de revisión manual (status actual: ${cancRow.status}).`,
        );
      }
      const data = (cancRow.data_final ?? cancRow.data_ia) as CancelacionData | null;
      if (!data) {
        return biz("no_data", "No hay datos persistidos para generar el documento.");
      }
      try {
        const prosaOv = (cancRow as { prosa_apoderado_override?: ProsaApoderadoOverride | null }).prosa_apoderado_override ?? null;
        const { minutaPath, certPath } = await generateAndUploadCancelacionDocs(
          supabaseService, cancelacionId, data, prosaOv,
        );
        const nowIso = new Date().toISOString();
        const { error: updErr } = await supabaseService.from("cancelaciones").update({
          status: "completed",
          url_minuta_generada: minutaPath,
          url_certificado_generado: certPath,
          revision_manual_confirmada_at: nowIso,
          revision_manual_confirmada_por: userId,
          updated_at: nowIso,
        }).eq("id", cancelacionId);
        if (updErr) throw new Error(`Persist(confirm_manual_review): ${updErr.message}`);

        void supabaseService.from("activity_logs").insert({
          organization_id: orgId,
          user_id: userId,
          action: "MANUAL_REVIEW_CONFIRMED",
          entity_type: "cancelacion",
          entity_id: cancelacionId,
          metadata: { confirmed_at: nowIso },
        }).then(() => {}, () => {});
        void supabaseService.from("system_events").insert({
          organization_id: orgId,
          tramite_id: cancelacionId,
          user_id: userId,
          evento: "procesar-cancelacion.revision_manual",
          resultado: "desbloqueado",
          categoria: "PODER_NO_LEGIBLE",
          detalle: { confirmed_by: userId },
        }).then(() => {}, () => {});

        return new Response(JSON.stringify({
          ok: true,
          unlocked: true,
          url_minuta_generada: minutaPath,
          url_certificado_generado: certPath,
        }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (genErr) {
        if (genErr instanceof ManualReviewRequiredError) {
          // El usuario intentó confirmar sin resolver los campos NO_LEGIBLE /
          // hard-blocks de coherencia. NO cambiamos status (sigue en
          // 'requiere_revision_manual') y logueamos el intento.
          void supabaseService.from("system_events").insert({
            organization_id: orgId,
            tramite_id: cancelacionId,
            user_id: userId,
            evento: "procesar-cancelacion.confirm_manual_review",
            resultado: "rechazado",
            categoria: "PODER_NO_LEGIBLE_PERSISTE",
            detalle: { paths: genErr.paths, motivos: genErr.motivos },
          }).then(() => {}, () => {});
          const pendientes = [...genErr.paths, ...genErr.motivos].join(", ");
          return biz(
            "manual_review_not_resolved",
            `Aún hay campos sin resolver: ${pendientes}. Corrígelos antes de confirmar.`,
            { paths: genErr.paths, motivos: genErr.motivos },
          );
        }
        const msg = genErr instanceof Error ? genErr.message : String(genErr);
        console.error("[procesar-cancelacion.confirm_manual_review] error:", msg);
        return biz("generation_error", `No se pudo generar el documento: ${msg.slice(0, 300)}`);
      }
    }


    // MODO REPROCESS_PODER: re-extrae solo el Poder con OCR dedicado.
    // Idempotente: limpia data_ia.poder_banco antes de re-inyectar.
    // No cobra créditos adicionales: el costo de generación ya fue cubierto
    // por unlock_expediente al abrir el expediente. El número de créditos
    // lo determina credit_prices, no un valor fijo aquí.
    // ─────────────────────────────────────────────────────────────
    if (action === "reprocess_poder") {
      const LOVABLE_API_KEY_RP = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY_RP) {
        return biz("internal", "LOVABLE_API_KEY no configurada");
      }

      // Listar páginas del poder desde el bucket bajo la convención conocida.
      const poderPrefix = `${cancelacionId}/cancelaciones/soportes/poder`;
      const { data: poderFiles, error: listErr } = await supabaseService.storage
        .from(BUCKET_OUTPUT)
        .list(poderPrefix);
      if (listErr || !poderFiles || poderFiles.length === 0) {
        return biz("no_poder_attached", "No se encontraron páginas del Poder General para re-procesar.");
      }
      const poderPaths = poderFiles
        .filter((f: { name?: string }) => f.name && /\.jpe?g$/i.test(f.name))
        .sort((a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map((f: { name: string }) => `${poderPrefix}/${f.name}`);

      if (poderPaths.length === 0) {
        return biz("no_poder_attached", "No se encontraron páginas válidas del Poder General.");
      }

      const poderUrls = await Promise.all(
        poderPaths.map((p) => createSignedStorageUrl(supabaseService, p)),
      );

      // 1) Idempotencia: limpiar data_ia.poder_banco antes de re-inyectar.
      const prevDataIa = (cancRow.data_ia ?? {}) as Record<string, unknown>;
      const cleanedIa = { ...prevDataIa };
      delete cleanedIa.poder_banco;
      await supabaseService.from("cancelaciones").update({ data_ia: cleanedIa }).eq("id", cancelacionId);

      // 2) Ejecutar OCR dedicado en una sola llamada multimodal.
      //    Plan v5/B1: cuando POWER_V5_ENABLED, envuelve con caché inmutable
      //    `ocr_raw_cache` indexada por SHA-256 de las páginas JPEG ordenadas.
      const tStart = Date.now();
      let dedicated: PoderDedicadoResult | null = null;
      let deepV6: PoderBancoDeepPayload | null = null;
      let resultado: "exito" | "fallo" | "parcial" = "fallo";
      let cacheHitRP = false;
      let cacheReasonRP = "v5_disabled";
      try {
        if (POWER_V5_ENABLED) {
          const r = await runWithPoderCache<PoderDedicadoResult>({
            supabase: supabaseService,
            organizationId: orgId,
            bucket: BUCKET_OUTPUT,
            paths: poderPaths,
            docType: POWER_DOC_TYPE,
            extractor: () => extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY_RP),
          });
          dedicated = r.payload;
          cacheHitRP = r.cacheHit;
          cacheReasonRP = r.reason;
        } else {
          dedicated = await extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY_RP);
        }
        // Extractor v6 (schema profundo) — opt-in ortogonal. Cero regresión
        // cuando el flag está apagado (default).
        if (POWER_V6_EXTRACTOR_ENABLED) {
          try {
            deepV6 = await extractPoderBancoV6(poderUrls, LOVABLE_API_KEY_RP);
          } catch (e) {
            console.error("[procesar-cancelacion reprocess_poder] v6 extractor failed:", e);
          }
        }
        const fieldsFilled = dedicated
          ? Object.values(dedicated).filter((v) => v != null && String(v).trim() !== "").length
          : 0;
        resultado = fieldsFilled >= 3 ? "exito" : fieldsFilled > 0 ? "parcial" : "fallo";
      } catch (e) {
        console.error("[procesar-cancelacion reprocess_poder] dedicated OCR failed:", e);
      }


      // 3) Merge en data_ia y data_final (humano > dedicado).
      const finalPoder = POWER_V6_EXTRACTOR_ENABLED
        ? mergePoderBancoV6(undefined, dedicated, deepV6)
        : mergePoderBanco(undefined, dedicated);
      if (finalPoder) {
        await annotatePoderCoherencia(
          supabaseService,
          finalPoder as unknown as Record<string, unknown>,
          { orgId, cancelacionId, userId, trigger: "reprocess_poder" },
        );
        await annotatePoderIntraTramite(
          supabaseService,
          finalPoder as unknown as Record<string, unknown>,
          {
            banco_nit: (cancRow as Record<string, unknown>).banco_nit as string | null | undefined,
            banco_acreedor: (cancRow as Record<string, unknown>).banco_acreedor as string | null | undefined,
          },
          { orgId, cancelacionId, userId, trigger: "reprocess_poder" },
        );
        await runPoderCrossChecks(
          supabaseService,
          finalPoder as unknown as Record<string, unknown>,
          { orgId, cancelacionId, userId, trigger: "reprocess_poder" },
        );
      }
      const newDataIa = { ...cleanedIa, ...(finalPoder ? { poder_banco: stripNullyStrings(finalPoder as unknown as Record<string, unknown>) } : {}) };
      const prevDataFinal = (cancRow.data_final ?? {}) as Record<string, unknown>;
      const existingFinalPoder = (prevDataFinal.poder_banco ?? {}) as PoderBanco;
      // En data_final, humano gana en los flat legacy: dedicado solo rellena huecos.
      // Los bloques profundos v6 (apoderado, poderdante, instrumento_poder) se
      // copian tal cual porque la UI aún no permite editarlos manualmente.
      const finalPoderExt = (finalPoder ?? undefined) as (Record<string, unknown> | undefined);
      const mergedFinalPoder: PoderBanco | undefined = finalPoder
        ? ({
            // sanitizeString aplica al lado humano ANTES de decidir si gana o cede al dedicado.
            // Previene el mismo patrón H2: humano con "null"/"undefined" como string ganaba por truthy.
            apoderado_nombre: sanitizeString(existingFinalPoder.apoderado_nombre) ?? finalPoder.apoderado_nombre,
            apoderado_cedula: sanitizeString(existingFinalPoder.apoderado_cedula) ?? finalPoder.apoderado_cedula,
            apoderado_escritura: sanitizeString(existingFinalPoder.apoderado_escritura) ?? finalPoder.apoderado_escritura,
            apoderado_fecha: sanitizeString(existingFinalPoder.apoderado_fecha) ?? finalPoder.apoderado_fecha,
            apoderado_notaria_poder: sanitizeString(existingFinalPoder.apoderado_notaria_poder) ?? finalPoder.apoderado_notaria_poder,
            apoderado_fecha_dia: existingFinalPoder.apoderado_fecha_dia,
            apoderado_fecha_mes: existingFinalPoder.apoderado_fecha_mes,
            apoderado_fecha_anio: existingFinalPoder.apoderado_fecha_anio,
            // Bloques profundos v6 (opt-in): pasan tal cual si vienen.
            ...(finalPoderExt?.apoderado ? { apoderado: finalPoderExt.apoderado } : {}),
            ...(finalPoderExt?.poderdante ? { poderdante: finalPoderExt.poderdante } : {}),
            ...(finalPoderExt?.instrumento_poder ? { instrumento_poder: finalPoderExt.instrumento_poder } : {}),
            ...(finalPoderExt?.facultades ? { facultades: finalPoderExt.facultades } : {}),
            ...(finalPoderExt?.vigencia ? { vigencia: finalPoderExt.vigencia } : {}),
          } as unknown as PoderBanco)
        : existingFinalPoder;
      const sanitizedFinalPoder = mergedFinalPoder
        ? (stripNullyStrings(mergedFinalPoder as unknown as Record<string, unknown>) as unknown as PoderBanco)
        : undefined;
      const newDataFinal = {
        ...prevDataFinal,
        ...(sanitizedFinalPoder && Object.values(sanitizedFinalPoder).some((v) => v) ? { poder_banco: sanitizedFinalPoder } : {}),
      };


      await supabaseService.from("cancelaciones").update({
        data_ia: newDataIa,
        data_final: newDataFinal,
        updated_at: new Date().toISOString(),
      }).eq("id", cancelacionId);

      // Telemetría no bloqueante.
      void logPoderEvent(supabaseService, {
        orgId, cancelacionId, userId,
        resultado: resultado === "fallo" ? "fallo" : resultado === "parcial" ? "parcial" : "exito",
        paginas_enviadas: poderUrls.length,
        poder_banco_presente: !!finalPoder,
        campos_llenos: finalPoder ? Object.values(finalPoder).filter((v) => v != null && String(v).trim() !== "").length : 0,
        tiempo_ms: Date.now() - tStart,
        extra: { trigger: "reprocess_poder", cache_hit: cacheHitRP, cache_reason: cacheReasonRP },
      });

      return new Response(JSON.stringify({ ok: true, reprocessed: true, poder_banco: finalPoder ?? null }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // MODO REPROCESS_CUANTIA: re-extrae sólo la cuantía del crédito
    // a partir de la escritura antecedente (caso típico: el certificado
    // viene como CUANTÍA INDETERMINADA y el monolítico dejó el campo
    // vacío). Idempotente: limpia el monto antes de re-inyectar.
    // No cobra créditos.
    // ─────────────────────────────────────────────────────────────
    if (action === "reprocess_cuantia") {
      const LOVABLE_API_KEY_RC = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY_RC) {
        return biz("internal", "LOVABLE_API_KEY no configurada");
      }

      const escPrefix = `${cancelacionId}/cancelaciones/soportes/escritura`;
      const { data: escFiles, error: listErr } = await supabaseService.storage
        .from(BUCKET_OUTPUT)
        .list(escPrefix);
      if (listErr || !escFiles || escFiles.length === 0) {
        return biz("no_escritura_attached", "No se encontraron páginas de la escritura antecedente para re-procesar.");
      }
      const escPaths = escFiles
        .filter((f: { name?: string }) => f.name && /\.jpe?g$/i.test(f.name))
        .sort((a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? ""))
        .map((f: { name: string }) => `${escPrefix}/${f.name}`);
      if (escPaths.length === 0) {
        return biz("no_escritura_attached", "No se encontraron páginas válidas de la escritura.");
      }

      const escUrls = await Promise.all(
        escPaths.map((p) => createSignedStorageUrl(supabaseService, p)),
      );

      // 1) Idempotencia: limpiar el monto y la metadata antes de re-inyectar.
      const prevDataIa = (cancRow.data_ia ?? {}) as Record<string, unknown>;
      const prevDataFinal = (cancRow.data_final ?? {}) as Record<string, unknown>;
      const cleanedIaHA = {
        ...((prevDataIa.hipoteca_anterior ?? {}) as Record<string, unknown>),
      };
      delete cleanedIaHA.cuantia_origen;
      // Sólo limpiamos el monto si está vacío o marcado como indeterminado
      // (idempotente para reintentos sobre el mismo caso). Si el humano ya lo
      // escribió manualmente, se respeta y no se ejecuta el reproceso encima.
      const cleanedIa = { ...prevDataIa, hipoteca_anterior: cleanedIaHA };
      await supabaseService.from("cancelaciones").update({ data_ia: cleanedIa }).eq("id", cancelacionId);

      // 2) Ejecutar OCR dedicado (con head+tail si la escritura es larga).
      const tStart = Date.now();
      const cuantiaRun = await extractCuantiaDedicada(escUrls, LOVABLE_API_KEY_RC);
      const dedicada = cuantiaRun.result;
      const dedicadaMonto = (dedicada?.valor_hipoteca_original ?? "").trim();
      const dedicadaIndet = dedicada?.valor_hipoteca_es_indeterminada === true
        || dedicada?.motivo_null === "escritura_declara_abierta";

      // 3) Merge: humano > dedicado. Sólo escribimos si el humano dejó el
      //    valor vacío, marcado indeterminado, o basura ("null"/"undefined"/"nan").
      //    Nunca pisamos un monto manual real.
      const finalHA = { ...((prevDataFinal.hipoteca_anterior ?? cleanedIaHA) as Record<string, unknown>) };
      const finalMontoActual = String((finalHA as { valor_hipoteca_original?: string }).valor_hipoteca_original ?? "").trim();
      const finalIndet = (finalHA as { valor_hipoteca_es_indeterminada?: boolean }).valor_hipoteca_es_indeterminada === true;
      const finalMontoBasura = /^(null|undefined|nan)$/i.test(finalMontoActual);
      const finalVacioOSustituible = finalMontoActual === "" || finalIndet || finalMontoBasura;
      let aplicado = false;
      let aplicadoIndet = false;
      if (dedicadaMonto && finalVacioOSustituible) {
        (finalHA as Record<string, unknown>).valor_hipoteca_original = dedicadaMonto;
        (finalHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = false;
        (finalHA as Record<string, unknown>).cuantia_origen = "escritura";
        aplicado = true;
      } else if (dedicadaIndet && finalVacioOSustituible) {
        // Propagación explícita de indeterminada confirmada por el extractor dedicado.
        (finalHA as Record<string, unknown>).valor_hipoteca_original = "";
        (finalHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = true;
        (finalHA as Record<string, unknown>).cuantia_origen = "escritura";
        aplicado = true;
        aplicadoIndet = true;
      }

      const newDataIaHA = { ...cleanedIaHA };
      if (dedicadaMonto) {
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_original = dedicadaMonto;
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = false;
        (newDataIaHA as Record<string, unknown>).cuantia_origen = "escritura";
      } else if (dedicadaIndet) {
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_original = "";
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = true;
        (newDataIaHA as Record<string, unknown>).cuantia_origen = "escritura";
      }
      const newDataIa = { ...cleanedIa, hipoteca_anterior: newDataIaHA };
      const newDataFinal = { ...prevDataFinal, hipoteca_anterior: finalHA };

      const updatePayload: Record<string, unknown> = {
        data_ia: newDataIa,
        data_final: newDataFinal,
        updated_at: new Date().toISOString(),
      };
      // Espejo en columna plana — solo si efectivamente aplicamos el nuevo valor.
      if (aplicado && !aplicadoIndet) {
        updatePayload.valor_hipoteca_original = dedicadaMonto;
      } else if (aplicadoIndet) {
        // Limpiamos el espejo plano cuando confirmamos indeterminada; jamás dejar basura.
        updatePayload.valor_hipoteca_original = null;
      }
      await supabaseService.from("cancelaciones").update(updatePayload).eq("id", cancelacionId);

      void logCuantiaEvent(supabaseService, {
        orgId, cancelacionId, userId,
        resultado: deriveCuantiaResultado(cuantiaRun),
        paginas_enviadas: cuantiaRun.paginas_enviadas,
        cert_indeterminada: true,
        monto_encontrado: !!dedicadaMonto,
        aplicado,
        tiempo_ms: Date.now() - tStart,
        extra: buildCuantiaExtra(cuantiaRun, "reprocess_cuantia"),
      });


      return new Response(JSON.stringify({
        ok: true,
        reprocessed: true,
        aplicado,
        valor_hipoteca_original: dedicadaMonto || null,
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // ─────────────────────────────────────────────────────────────
    // MODO REGEN: solo re-mapeo docx con data_final, sin cobrar
    // ─────────────────────────────────────────────────────────────
    if (regen) {

      // Read-then-Merge defensivo (helper puro isomórfico + test dedicado):
      // rescata bloque profundo v6 de `data_ia` si `data_final` histórico lo
      // perdió (caso c8924aa2) y garantiza que `overrides` NUNCA borra
      // claves que no envía.
      const data = mergeRegenPayload<Record<string, unknown>>({
        dataIa: cancRow.data_ia as Record<string, unknown> | null,
        dataFinal: cancRow.data_final as Record<string, unknown> | null,
        overrides: (manualOverrides ?? null) as Record<string, unknown> | null,
      }) as unknown as CancelacionData;
      if (!data || Object.keys(data as Record<string, unknown>).length === 0) {
        return new Response(JSON.stringify({ error: "No hay datos para regenerar" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const prosaOv = (cancRow as { prosa_apoderado_override?: ProsaApoderadoOverride | null }).prosa_apoderado_override ?? null;
      try {
        const { minutaPath, certPath } = await generateAndUploadCancelacionDocs(
          supabaseService, cancelacionId, data, prosaOv,
        );
        await supabaseService.from("cancelaciones").update({
          data_final: data,
          url_minuta_generada: minutaPath,
          url_certificado_generado: certPath,
          updated_at: new Date().toISOString(),
        }).eq("id", cancelacionId);

        return new Response(JSON.stringify({ ok: true, regenerated: true }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (genErr) {
        if (genErr instanceof ManualReviewRequiredError) {
          // Persistir SOLO data_final (el usuario sigue editando) y NO tocar
          // url_minuta_generada/url_certificado_generado — el docx previo (si
          // existe) queda intacto en vez de sobrescribirlo con uno contaminado.
          await supabaseService.from("cancelaciones").update({
            data_final: data,
            updated_at: new Date().toISOString(),
          }).eq("id", cancelacionId);
          return new Response(JSON.stringify({
            ok: false,
            error: "manual_review_required",
            paths: genErr.paths,
            motivos: genErr.motivos,
          }), {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        throw genErr;
      }
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

    // 1) Cobro de créditos (auditoría obligatoria → p_tramite_id requerido).
    // Fallback defensivo: el precio real lo resuelve credit_prices en el servidor
    // (consume_credit_v2). El valor p_credits: 2 solo aplica si la tabla no
    // tuviera una fila activa para GENERACION_DOCX / cancelacion_hipoteca.
    const { data: charge, error: chargeErr } = await supabaseUser.rpc("consume_credit_v2", {
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

    // ── GUARD ANTI-IDOR (helper compartido) ─────────────────────────
    // Todo path del cliente DEBE pertenecer a esta cancelación.
    // El bucket usa convención `${cancelacionId}/cancelaciones/soportes/...`.
    try {
      assertOwnPaths(
        [...certInputPaths, ...escInputPaths, ...poderInputPaths],
        cancelacionId,
      );
    } catch (guardErr) {
      console.error("[procesar-cancelacion] path guard rejected request", {
        cancelacionId,
        userId,
        message: guardErr instanceof Error ? guardErr.message : "unknown",
      });
      return new Response(JSON.stringify({ error: "Forbidden path" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

        // ── Eje B v3 — PARALELISMO BALANCEADO (2 promesas, no 30) ──
        // Promesa 1: análisis monolítico con Gemini 2.5 Pro (3 docs juntos).
        // Promesa 2: OCR dedicado del Poder con Gemini 2.5 Flash en UN SOLO
        // turno multimodal con TODAS las páginas → respeta el RPM del gateway
        // y elimina el riesgo de que el modelo monolítico priorice cert+escr
        // y devuelva el bloque poder_banco vacío.
        const tPoderStart = Date.now();
        // Plan v5/B1: cuando POWER_V5_ENABLED, el OCR dedicado del Poder pasa
        // por `ocr_raw_cache`. El monolítico Gemini 2.5 Pro NO se cachea
        // (depende de cert+escr+poder juntos → SHA combinado inestable).
        let cacheHitHW = false;
        let cacheReasonHW = poderUrls.length === 0 ? "sin_poder" : "v5_disabled";
        const dedicatedRunner = async (): Promise<PoderDedicadoResult | null> => {
          if (poderUrls.length === 0) return null;
          if (!POWER_V5_ENABLED) {
            return await extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY);
          }
          const r = await runWithPoderCache<PoderDedicadoResult>({
            supabase: supabaseService,
            organizationId: orgId,
            bucket: BUCKET_OUTPUT,
            paths: poderInputPaths,
            docType: POWER_DOC_TYPE,
            extractor: () => extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY),
          });
          cacheHitHW = r.cacheHit;
          cacheReasonHW = r.reason;
          return r.payload;
        };

        // V6 extractor: opt-in ortogonal. Corre en paralelo cuando el flag
        // está encendido; ignora fallo (best-effort) para no romper el flujo.
        const v6Runner = async (): Promise<PoderBancoDeepPayload | null> => {
          if (!POWER_V6_EXTRACTOR_ENABLED || poderUrls.length === 0) return null;
          try {
            return await extractPoderBancoV6(poderUrls, LOVABLE_API_KEY);
          } catch (e) {
            console.error("[procesar-cancelacion mono] v6 extractor failed:", e);
            return null;
          }
        };

        const [monoSettled, dedicatedSettled, v6Settled] = await Promise.allSettled([
          (async () => {
            const aiResp = await fetchAiGateway({ apiKey: LOVABLE_API_KEY, body: aiBody, tag: "procesar-cancelacion" });
            return await parseToolCallArguments<CancelacionData>(aiResp, "procesar-cancelacion");
          })(),
          dedicatedRunner(),
          v6Runner(),
        ]);

        // El monolítico es obligatorio — si falla, levantamos el error.
        if (monoSettled.status !== "fulfilled") {
          throw monoSettled.reason;
        }
        const extracted = monoSettled.value;
        const dedicatedResult: PoderDedicadoResult | null =
          dedicatedSettled.status === "fulfilled" ? dedicatedSettled.value : null;
        const v6Result: PoderBancoDeepPayload | null =
          v6Settled.status === "fulfilled" ? v6Settled.value : null;

        // Read-then-Merge: el OCR dedicado rellena huecos del monolítico.
        // Plan v5: el cache_hit devuelve `raw_payload` PURO de Gemini —
        // jamás contaminado por ediciones humanas de otra cancelación.
        const mergedPoder = POWER_V6_EXTRACTOR_ENABLED
          ? mergePoderBancoV6(extracted.poder_banco, dedicatedResult, v6Result)
          : mergePoderBanco(extracted.poder_banco, dedicatedResult);
        if (mergedPoder) {
          await annotatePoderCoherencia(
            supabaseService,
            mergedPoder as unknown as Record<string, unknown>,
            { orgId, cancelacionId, userId, trigger: "live_pipeline" },
          );
          await annotatePoderIntraTramite(
            supabaseService,
            mergedPoder as unknown as Record<string, unknown>,
            {
              banco_nit: extracted.partes?.banco_nit,
              banco_acreedor: extracted.partes?.banco_acreedor,
            },
            { orgId, cancelacionId, userId, trigger: "live_pipeline" },
          );
          await runPoderCrossChecks(
            supabaseService,
            mergedPoder as unknown as Record<string, unknown>,
            { orgId, cancelacionId, userId, trigger: "live_pipeline" },
          );
          extracted.poder_banco = stripNullyStrings(mergedPoder as unknown as Record<string, unknown>) as typeof mergedPoder;
        } else if (poderUrls.length === 0) {
          // No se adjuntó poder → no debe existir el objeto.
          delete (extracted as { poder_banco?: unknown }).poder_banco;
        }

        // Telemetría no bloqueante (Eje A v3 + Plan v5/B5).
        const pbFilled = extracted.poder_banco
          ? Object.values(extracted.poder_banco).filter((v) => v != null && String(v).trim() !== "").length
          : 0;
        void logPoderEvent(supabaseService, {
          orgId, cancelacionId, userId,
          resultado: poderUrls.length === 0
            ? "sin_poder"
            : pbFilled >= 3 ? "exito" : pbFilled > 0 ? "parcial" : "fallo",
          paginas_enviadas: poderUrls.length,
          poder_banco_presente: !!extracted.poder_banco,
          campos_llenos: pbFilled,
          tiempo_ms: Date.now() - tPoderStart,
          extra: {
            mono_status: monoSettled.status,
            dedicated_status: dedicatedSettled.status,
            v6_status: v6Settled.status,
            v6_enabled: POWER_V6_EXTRACTOR_ENABLED,
            dedicated_error: dedicatedSettled.status === "rejected"
              ? String((dedicatedSettled as PromiseRejectedResult).reason).slice(0, 200)
              : undefined,
            cache_hit: cacheHitHW,
            cache_reason: cacheReasonHW,
            v5_enabled: POWER_V5_ENABLED,
          },
        });


        // ── Eje B v3 — CUANTÍA DEDICADA (secuencial condicional) ──
        // Sólo disparamos el extractor dedicado de cuantía cuando el monolítico
        // dejó el valor vacío o lo marcó como indeterminada (caso típico: el
        // certificado registra la hipoteca como "CUANTÍA INDETERMINADA"). Así
        // evitamos costo y latencia en el caso común donde el monolítico ya
        // resuelve bien la cuantía desde el certificado.
        const monoValor = (extracted.hipoteca_anterior.valor_hipoteca_original ?? "").trim();
        const monoIndet = extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
        const certIndet = monoValor === "" || monoIndet;
        const debeReintentar = certIndet && escUrls.length > 0;
        const tCuantiaStart = Date.now();
        let cuantiaRun: CuantiaDedicadaRun | null = null;
        let cuantiaAplicada = false;
        if (debeReintentar) {
          cuantiaRun = await extractCuantiaDedicada(escUrls, LOVABLE_API_KEY);
          const mergeResult = mergeCuantiaIntoExtracted(extracted, cuantiaRun.result);
          cuantiaAplicada = mergeResult.applied;
        }
        const cuantiaMontoOk = !!(cuantiaRun?.result?.valor_hipoteca_original);
        void logCuantiaEvent(supabaseService, {
          orgId, cancelacionId, userId,
          resultado: !debeReintentar ? "no_aplica" : deriveCuantiaResultado(cuantiaRun),
          paginas_enviadas: cuantiaRun?.paginas_enviadas ?? 0,
          cert_indeterminada: certIndet,
          monto_encontrado: cuantiaMontoOk,
          aplicado: cuantiaAplicada,
          tiempo_ms: debeReintentar ? Date.now() - tCuantiaStart : 0,
          extra: buildCuantiaExtra(cuantiaRun, "auto"),
        });


        // ── Hidratación legacy: rellena `deudor_*` singulares desde el array
        //     para mantener compatibilidad con queries/columnas existentes.
        //     Telemetría no bloqueante: si algún deudor llega sin cédula, lo
        //     registramos como advertencia para auditoría posterior.
        try {
          const deudoresExtraidos = normalizeDeudores(extracted.partes);
          if (deudoresExtraidos.length > 0) {
            extracted.partes.deudores = deudoresExtraidos.map((d) => ({
              nombre: d.nombre,
              identificacion: d.identificacion,
              tipo_id: d.tipo_id,
              genero: d.genero,
            }));
            extracted.partes.deudor_nombre = deudoresExtraidos.map((d) => d.nombre).join(" Y ");
            extracted.partes.deudor_identificacion = deudoresExtraidos.map((d) => d.identificacion_formateada).join(" Y ");
            extracted.partes.deudor_tipo_id = deudoresExtraidos[0].tipo_id;
            const faltantes = deudoresExtraidos.filter((d) => !d.identificacion).map((d) => d.nombre);
            if (faltantes.length > 0) {
              void supabaseService.from("system_events").insert({
                organization_id: orgId,
                tramite_id: cancelacionId,
                user_id: userId,
                evento: "procesar-cancelacion.deudores",
                resultado: "parcial",
                categoria: "DEUDOR_CEDULA_MISMATCH",
                detalle: { faltantes, total: deudoresExtraidos.length },
              }).then(() => {}, () => {});
            }
          }
        } catch (e) {
          console.warn("[procesar-cancelacion] normalizeDeudores warn:", e);
        }

        // ── Fase E — Bloqueo duro con override manual ──
        // Si el prompt v7 emitió "NO_LEGIBLE" en algún campo crítico del poder,
        // NO generamos minuta/certificado. Persistimos data_ia/data_final para
        // que el usuario pueda revisar/editar en la pantalla de validación y
        // dejamos status='requiere_revision_manual'. El desbloqueo ocurre por
        // la acción `confirm_manual_review` (misma edge function).
        // ── Sanea strings tóxicas de la IA monolítica fuera de poder_banco.
        // Gemini a veces devuelve `"null"` literal en cuantía no legible en
        // vez de omitir. Sólo afecta `hipoteca_anterior.valor_hipoteca_original`
        // y `hipoteca_anterior.cuantia_origen` (rutas listadas en
        // `CANCELACION_NULLY_PATHS`). Ver `sanitizeNullPattern.test.ts`.
        const cleanedExtracted = stripNullyStrings(
          extracted as unknown as Record<string, unknown>,
          CANCELACION_NULLY_PATHS,
        ) as unknown as typeof extracted;

        const revision = detectRequiereRevisionManual(cleanedExtracted);
        const commonUpdate = {
          data_ia: cleanedExtracted,
          data_final: cleanedExtracted,
          numero_escritura_hipoteca: cleanedExtracted.hipoteca_anterior.numero_escritura_hipoteca,
          fecha_escritura_hipoteca: cleanedExtracted.hipoteca_anterior.fecha_escritura_hipoteca,
          notaria_hipoteca: cleanedExtracted.hipoteca_anterior.notaria_hipoteca,
          valor_hipoteca_original: cleanedExtracted.hipoteca_anterior.valor_hipoteca_original,
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
          updated_at: new Date().toISOString(),
        };

        if (revision.requiere) {
          // NO generamos docs. Marcamos status y logueamos.
          const { error: updErr } = await supabaseService.from("cancelaciones").update({
            ...commonUpdate,
            status: "requiere_revision_manual",
            revision_manual_requerida: true,
            revision_manual_confirmada_at: null,
            revision_manual_confirmada_por: null,
          }).eq("id", cancelacionId);
          if (updErr) throw new Error(`Persist(requiere_revision_manual): ${updErr.message}`);

          void supabaseService.from("system_events").insert({
            organization_id: orgId,
            tramite_id: cancelacionId,
            user_id: userId,
            evento: "procesar-cancelacion.revision_manual",
            resultado: "bloqueado",
            categoria: revision.paths.length > 0 ? "PODER_NO_LEGIBLE" : "PODER_COHERENCIA_HARD_BLOCK",
            detalle: { paths: revision.paths, motivos: revision.motivos },
          }).then(() => {}, () => {});

          void supabaseService.from("activity_logs").insert({
            organization_id: orgId,
            user_id: userId,
            action: "MANUAL_REVIEW_REQUIRED",
            entity_type: "cancelacion",
            entity_id: cancelacionId,
            metadata: { paths: revision.paths, motivos: revision.motivos },
          }).then(() => {}, () => {});
        } else {
          // Path normal — genera minuta+certificado y marca completed.
          const prosaOv = (cancRow as { prosa_apoderado_override?: ProsaApoderadoOverride | null }).prosa_apoderado_override ?? null;
          const { minutaPath, certPath } = await generateAndUploadCancelacionDocs(
            supabaseService, cancelacionId, cleanedExtracted, prosaOv,
          );
          const { error: updErr } = await supabaseService.from("cancelaciones").update({
            ...commonUpdate,
            status: "completed",
            url_minuta_generada: minutaPath,
            url_certificado_generado: certPath,
          }).eq("id", cancelacionId);
          if (updErr) throw new Error(`Persist: ${updErr.message}`);
        }

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

    return biz("internal", "Error interno del servidor. Intente de nuevo.");
  }
});

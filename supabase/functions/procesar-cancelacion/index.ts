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
import { assertOwnPaths } from "../_shared/storagePaths.ts";

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
              nomenclatura_predio: { type: "string", description: "Dirección postal urbana del predio, MAYÚSCULAS, en formato notarial TEXTO (NÚMERO). Tomada EXCLUSIVAMENTE del renglón de ÍNDICE MÁS ALTO de la sección 'DIRECCION DEL INMUEBLE' del certificado de tradición (renglones '1)','2)','3)' o romanos — la vigente es la del índice mayor). Vía y números en letras con dígito entre paréntesis, sufijos cardinales SUR/NORTE/ESTE/OESTE en MAYÚSCULA pegados al número, guion literal como 'GUION'. Letras pegadas (62A, 53B, 'BIS') se transcriben literales en MAYÚSCULA. Cardinales masculinos ('UNO','DOS','VEINTIUNO'). Ej: 'CL 59 SUR 60 84' → 'CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84)'. PROHIBIDO incluir apartamento/torre/interior/bloque/manzana/casa (van en descripcion_predio), ciudad (va en ciudad), nombre de conjunto/edificio, ni el sufijo '(DIRECCION CATASTRAL)' — el backend los inyecta." },
              ciudad: { type: "string", description: "Ciudad del inmueble en mayúsculas, ej: 'BOGOTA D.C.'" },
              departamento: { type: "string", description: "Departamento del inmueble en mayúsculas, ej: 'CUNDINAMARCA'. Opcional." },
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
            description: "DEVUELVE este objeto SIEMPRE que el usuario haya adjuntado páginas del Poder. Llénalo con TODOS los campos que puedas confirmar y usa `null` (JSON null, NO cadena vacía '') en cada campo individual ilegible. OMÍTELO completamente SOLO si NO se adjuntó poder. Los datos suelen estar en las cláusulas finales del PDF.",
            properties: {
              apoderado_nombre: { type: "string", description: "Nombre completo del apoderado / representante legal en MAYÚSCULAS. Si encuentras CUALQUIER nombre de apoderado, devuélvelo." },
              apoderado_cedula: { type: "string", description: "Cédula del apoderado, estrictamente numérica con puntos de miles, ej: '79.123.456'. `null` si es ilegible." },
              apoderado_escritura: { type: "string", description: "Número de escritura del poder en LETRAS Y NÚMEROS, ej: 'DOS MIL CUATROCIENTOS QUINCE (2415)'. `null` si es ilegible." },
              apoderado_fecha: { type: "string", description: "Fecha del poder en FORMATO NOTARIAL COMPLETO: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'. `null` si es ilegible." },
              apoderado_notaria_poder: { type: "string", description: "Notaría donde se otorgó el poder en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y DOS (32) DE BOGOTA D.C.'. `null` si es ilegible." },
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

REGLAS DE EXTRACCIÓN DE NOMENCLATURA DESDE EL CERTIFICADO DE TRADICIÓN (CRÍTICAS — aplican SOLO a 'nomenclatura_predio'):

a) SELECCIÓN POR ÍNDICE MÁS ALTO: la sección "DIRECCION DEL INMUEBLE" del certificado suele traer renglones numerados "1) ...", "2) ...", "3) ..." (o numerales romanos I, II, III). Representan el historial cronológico de Catastro/ORIP; la vigente es SIEMPRE la del índice numérico MÁS ALTO. Toma EXCLUSIVAMENTE esa línea e ignora las anteriores aunque sean más descriptivas o incluyan el nombre del conjunto. Si solo hay un renglón sin numerar, tómalo.

b) FORMATO TEXTO (NÚMERO) OBLIGATORIO con concordancia colombiana:
   - Vía: CL/CLL/CALLE → "CALLE"; CR/CRA/KR/KRA/CARRERA → "CARRERA"; AV/AVENIDA → "AVENIDA"; DG/DIAGONAL → "DIAGONAL"; TV/TRANSVERSAL → "TRANSVERSAL"; CIRCULAR; AUTOPISTA.
   - Número de la vía en letras + "(N)". Conserva el sufijo cardinal (SUR/NORTE/ESTE/OESTE) en MAYÚSCULAS inmediatamente después del número.
   - Placa: literal "NÚMERO" + primer número en letras + "GUION" + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
   - Ej canónico: "CL 59 SUR 60 84" → "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84)".

c) BLINDAJE ALFANUMÉRICO (sufijos pegados al número): si el número de la vía o de la placa trae una letra de adición pegada (62A, 53B, 45C) o el marcador "BIS", escribe el número en letras y mantén la letra/marca en MAYÚSCULA LITERAL.
   - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B GUION VEINTIUNO (62A No. 53B-21)".
   - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO GUION TREINTA Y DOS (13 BIS No. 85-32)".
   PROHIBIDO inventar palabras como "ALFA", "BETA", "GAMMA" o "DOBLE": la letra/sufijo se transcribe literal en mayúscula.

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
- Si SE ADJUNTÓ el Poder: DEVUELVE el objeto 'poder_banco' con TODOS los campos que puedas confirmar y usa **\`null\` (JSON null, NO cadena vacía '')** en cada campo individual ilegible. Si encuentras al menos el nombre del apoderado, devuelve el objeto.
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

// Build the variable map sent to Docxtemplater
export function buildDocxVars(data: CancelacionData) {
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
          apoderado_cedula: { type: "string", description: "Cédula del apoderado, estrictamente numérica con puntos de miles, ej: '79.123.456'. null si es ilegible." },
          apoderado_escritura: { type: "string", description: "Número de escritura del poder en LETRAS Y NÚMEROS, ej: 'DOS MIL CUATROCIENTOS QUINCE (2415)'. null si es ilegible." },
          apoderado_fecha: { type: "string", description: "Fecha del poder en formato notarial completo: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'. null si es ilegible." },
          apoderado_notaria_poder: { type: "string", description: "Notaría donde se otorgó el poder en LETRAS Y NÚMEROS + ciudad, ej: 'TREINTA Y DOS (32) DE BOGOTA D.C.'. null si es ilegible." },
        },
        required: ["apoderado_nombre"],
        additionalProperties: false,
      },
    },
  },
];

const PODER_DEDICADO_SYSTEM = `Eres un sistema OCR jurídico especializado EXCLUSIVAMENTE en extraer la designación de apoderado y sus datos de identificación a partir de un Poder General otorgado por un banco colombiano (típicamente Banco Davivienda S.A.).

ALCANCE MULTIPÁGINA: el usuario puede enviarte hasta 30 páginas en un único turno multimodal. La cláusula que designa al apoderado y enumera sus facultades suele aparecer en las PÁGINAS FINALES — revisa TODAS las páginas, no solo las primeras.

PALABRAS CLAVE para localizar al apoderado: 'CONFIERE PODER', 'APODERADO', 'REPRESENTANTE LEGAL', 'OTORGA PODER GENERAL', 'FACULTA A', 'ESCRITURA PÚBLICA No.', 'NOTARÍA'.

FORMATO DE SALIDA (estricto):
- apoderado_nombre: nombre completo en MAYÚSCULAS.
- apoderado_cedula: solo dígitos con puntos de miles, ej: '79.123.456'.
- apoderado_escritura: 'DOS MIL CUATROCIENTOS QUINCE (2415)'.
- apoderado_fecha: 'DIECINUEVE (19) DE AGOSTO DE DOS MIL VEINTICINCO (2025)'.
- apoderado_notaria_poder: 'TREINTA Y DOS (32) DE BOGOTA D.C.'.

ANTI-ALUCINACIÓN:
- Si un campo individual es humanamente ilegible, devuelve **\`null\` (JSON null, NO cadena vacía '')**.
- Si encuentras al menos el nombre del apoderado, devuelve el objeto con los demás campos en null cuando no los puedas confirmar.
- PROHIBIDO devolver 'N/A', 'ilegible', '?', '---' o reconstrucciones inventadas.

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
    // Dedicado pisa monolítico si el monolítico es null/empty.
    if (m && m.trim()) return m;
    if (d && d.trim()) return d;
    return undefined;
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
const cuantiaDedicadaTool = [
  {
    type: "function" as const,
    function: {
      name: "extract_cuantia_credito_dedicada",
      description: "Extrae el monto del crédito hipotecario a partir de TODAS las páginas de la escritura antecedente. Aplicar anclaje sintáctico al verbo rector del gravamen e ignorar lista negra (precio, avalúo, subsidio, UVR/UPAC).",
      parameters: {
        type: "object",
        properties: {
          valor_hipoteca_original: {
            type: ["string", "null"],
            description: "Monto del MUTUO anclado al verbo rector ('constituye', 'grava', 'hipoteca', 'garantiza', 'presta', 'concede', 'desembolsa'). Formato OBLIGATORIO: '<LETRAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)' en MAYÚSCULAS, ej: 'OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)'. Devuelve `null` (JSON null, NUNCA cadena vacía) si la hipoteca es ABIERTA / CUANTÍA INDETERMINADA, si el monto es ambiguo, o si no hay evidencia clara.",
          },
          valor_hipoteca_es_indeterminada: {
            type: "boolean",
            description: "true SOLO si la escritura declara expresamente 'HIPOTECA ABIERTA', 'SIN LÍMITE DE CUANTÍA', o 'DE CUANTÍA INDETERMINADA'. En cualquier otro caso false.",
          },
          confianza: {
            type: "string",
            enum: ["alta", "media", "baja"],
            description: "Nivel de confianza en la extracción.",
          },
        },
        required: ["valor_hipoteca_original", "valor_hipoteca_es_indeterminada"],
        additionalProperties: false,
      },
    },
  },
];

const CUANTIA_DEDICADA_SYSTEM = `Eres un sistema OCR jurídico-notarial colombiano especializado EXCLUSIVAMENTE en extraer la cuantía del crédito hipotecario (mutuo) a partir de las páginas de una Escritura Pública de Constitución de Hipoteca.

CONTEXTO: el Certificado de Tradición y Libertad de este expediente registra la hipoteca como "CUANTÍA INDETERMINADA" y por eso te llamamos para encontrar el monto real dentro de la escritura.

ALCANCE MULTIPÁGINA: el usuario puede enviarte hasta 30 páginas en un único turno multimodal. La cláusula del mutuo / cláusula de pago puede estar en cualquier parte del documento — revisa TODAS las páginas.

JERARQUÍA DE BÚSQUEDA (en orden):
1. MUTUO — el banco "presta / otorga / concede / desembolsa / entrega" una suma al deudor como crédito.
2. PAGO — cláusula de compraventa: "el saldo del precio se cubrirá con el producto del crédito que le concede [BANCO] por valor de…".
3. LIQUIDACIÓN — casilla anexa "CUANTÍA DEL MUTUO", "VALOR DEL CRÉDITO", "MONTO DEL PRÉSTAMO".

ANCLAJE SINTÁCTICO (obligatorio): la cifra DEBE estar gobernada gramaticalmente por un verbo rector del gravamen: 'constituye', 'grava', 'hipoteca', 'garantiza', 'otorga garantía hipotecaria', 'presta', 'concede', 'desembolsa', 'entrega'. La proximidad física a la palabra "hipoteca" NO basta.

LISTA NEGRA (ignora estas cifras, NO el párrafo):
- precio de venta / valor de la compraventa
- avalúo catastral / avalúo comercial
- liberación de gravamen / subrogación
- abono / saldo pendiente
- subsidio / cesantías
- DENOMINACIONES UVR / UPAC (busca SIEMPRE la cifra principal en PESOS M/CTE).

FORMATO DE SALIDA (estricto):
- valor_hipoteca_original: "<LETRAS EN MAYÚSCULAS> DE PESOS ($<NÚMEROS CON PUNTOS DE MILES>)". Ej: "OCHO MILLONES QUINIENTOS CINCUENTA Y OCHO MIL CUATROCIENTOS SETENTA Y CINCO PESOS ($8.558.475)".
- valor_hipoteca_es_indeterminada: true SOLO si la escritura misma declara la hipoteca como abierta / sin límite / de cuantía indeterminada.

ANTI-ALUCINACIÓN (estricto):
- Si no encuentras evidencia clara, devuelve \`valor_hipoteca_original = null\` (JSON null, NUNCA cadena vacía) y \`valor_hipoteca_es_indeterminada = false\`.
- Si encuentras dos cifras candidatas ambiguas y no puedes desambiguar, devuelve \`null\` y \`false\`.
- Si la escritura declara la hipoteca como ABIERTA / SIN LÍMITE / INDETERMINADA, devuelve \`valor_hipoteca_original = null\` y \`valor_hipoteca_es_indeterminada = true\`.
- PROHIBIDO devolver 'N/A', 'ilegible', '?', '---', literales descriptivos en el campo de monto, o cifras inventadas.

Llama SIEMPRE a la herramienta extract_cuantia_credito_dedicada.`;

interface CuantiaDedicadaResult {
  valor_hipoteca_original?: string | null;
  valor_hipoteca_es_indeterminada?: boolean;
  confianza?: "alta" | "media" | "baja";
}

interface CuantiaDedicadaRun {
  result: CuantiaDedicadaResult | null;
  paginas_totales: number;
  paginas_enviadas: number;
  truncado: boolean;
  error_status?: number | "network" | "parse";
  error_msg?: string;
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

async function extractCuantiaDedicada(
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
function mergeCuantiaIntoExtracted(
  extracted: CancelacionData,
  dedicada: CuantiaDedicadaResult | null,
): { applied: boolean; monto: string | null } {
  if (!dedicada) return { applied: false, monto: null };
  const monoMonto = (extracted.hipoteca_anterior.valor_hipoteca_original ?? "").trim();
  const monoIndet = extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
  const certVacio = monoMonto === "" || monoIndet;
  const dedicadaMonto = (dedicada.valor_hipoteca_original ?? "").trim();
  if (!certVacio) return { applied: false, monto: null };
  if (!dedicadaMonto) return { applied: false, monto: null };
  extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
  extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = false;
  extracted.hipoteca_anterior.cuantia_origen = "escritura";
  return { applied: true, monto: dedicadaMonto };
}

// Telemetría no bloqueante.
async function logCuantiaEvent(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: {
    orgId: string;
    cancelacionId: string;
    userId: string;
    resultado: "exito" | "fallo" | "no_aplica" | "sin_escritura";
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
    /** "reprocess_poder"   → re-extrae solo el Poder con OCR dedicado.
     *  "reprocess_cuantia" → re-extrae solo la cuantía del crédito a partir
     *                        de la escritura antecedente (cuando el certificado
     *                        vino como indeterminado). Ninguno cobra créditos. */
    action?: "reprocess_poder" | "reprocess_cuantia";
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    // MODO REPROCESS_PODER: re-extrae solo el Poder con OCR dedicado.
    // Idempotente: limpia data_ia.poder_banco antes de re-inyectar.
    // No cobra créditos (unlock_expediente ya consumió los 2).
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
      const tStart = Date.now();
      let dedicated: PoderDedicadoResult | null = null;
      let resultado: "exito" | "fallo" | "parcial" = "fallo";
      try {
        dedicated = await extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY_RP);
        const fieldsFilled = dedicated
          ? Object.values(dedicated).filter((v) => v != null && String(v).trim() !== "").length
          : 0;
        resultado = fieldsFilled >= 3 ? "exito" : fieldsFilled > 0 ? "parcial" : "fallo";
      } catch (e) {
        console.error("[procesar-cancelacion reprocess_poder] dedicated OCR failed:", e);
      }

      // 3) Merge en data_ia y data_final (humano > dedicado).
      const finalPoder = mergePoderBanco(undefined, dedicated);
      const newDataIa = { ...cleanedIa, ...(finalPoder ? { poder_banco: finalPoder } : {}) };
      const prevDataFinal = (cancRow.data_final ?? {}) as Record<string, unknown>;
      const existingFinalPoder = (prevDataFinal.poder_banco ?? {}) as PoderBanco;
      // En data_final, humano gana: dedicado solo rellena huecos.
      const mergedFinalPoder: PoderBanco | undefined = finalPoder
        ? {
            apoderado_nombre: existingFinalPoder.apoderado_nombre || finalPoder.apoderado_nombre,
            apoderado_cedula: existingFinalPoder.apoderado_cedula || finalPoder.apoderado_cedula,
            apoderado_escritura: existingFinalPoder.apoderado_escritura || finalPoder.apoderado_escritura,
            apoderado_fecha: existingFinalPoder.apoderado_fecha || finalPoder.apoderado_fecha,
            apoderado_notaria_poder: existingFinalPoder.apoderado_notaria_poder || finalPoder.apoderado_notaria_poder,
            apoderado_fecha_dia: existingFinalPoder.apoderado_fecha_dia,
            apoderado_fecha_mes: existingFinalPoder.apoderado_fecha_mes,
            apoderado_fecha_anio: existingFinalPoder.apoderado_fecha_anio,
          }
        : existingFinalPoder;
      const newDataFinal = {
        ...prevDataFinal,
        ...(mergedFinalPoder && Object.values(mergedFinalPoder).some((v) => v) ? { poder_banco: mergedFinalPoder } : {}),
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
        extra: { trigger: "reprocess_poder" },
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

      // 2) Ejecutar OCR dedicado.
      const tStart = Date.now();
      let dedicada: CuantiaDedicadaResult | null = null;
      try {
        dedicada = await extractCuantiaDedicada(escUrls, LOVABLE_API_KEY_RC);
      } catch (e) {
        console.error("[procesar-cancelacion reprocess_cuantia] dedicated OCR failed:", e);
      }
      const dedicadaMonto = (dedicada?.valor_hipoteca_original ?? "").trim();

      // 3) Merge: humano > dedicado. Sólo escribimos si el humano dejó el
      //    valor vacío (o si el certificado estaba indeterminado y el humano
      //    no ha intervenido). Nunca pisamos un monto manual.
      const finalHA = { ...((prevDataFinal.hipoteca_anterior ?? cleanedIaHA) as Record<string, unknown>) };
      const finalMontoActual = String((finalHA as { valor_hipoteca_original?: string }).valor_hipoteca_original ?? "").trim();
      const finalIndet = (finalHA as { valor_hipoteca_es_indeterminada?: boolean }).valor_hipoteca_es_indeterminada === true;
      let aplicado = false;
      if (dedicadaMonto && (finalMontoActual === "" || finalIndet)) {
        (finalHA as Record<string, unknown>).valor_hipoteca_original = dedicadaMonto;
        (finalHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = false;
        (finalHA as Record<string, unknown>).cuantia_origen = "escritura";
        aplicado = true;
      }

      const newDataIaHA = { ...cleanedIaHA };
      if (dedicadaMonto) {
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_original = dedicadaMonto;
        (newDataIaHA as Record<string, unknown>).valor_hipoteca_es_indeterminada = false;
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
      if (aplicado) {
        updatePayload.valor_hipoteca_original = dedicadaMonto;
      }
      await supabaseService.from("cancelaciones").update(updatePayload).eq("id", cancelacionId);

      void logCuantiaEvent(supabaseService, {
        orgId, cancelacionId, userId,
        resultado: dedicadaMonto ? "exito" : "fallo",
        paginas_enviadas: escUrls.length,
        cert_indeterminada: true,
        monto_encontrado: !!dedicadaMonto,
        aplicado,
        tiempo_ms: Date.now() - tStart,
        extra: { trigger: "reprocess_cuantia" },
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
        const [monoSettled, dedicatedSettled] = await Promise.allSettled([
          (async () => {
            const aiResp = await fetchAiGateway({ apiKey: LOVABLE_API_KEY, body: aiBody, tag: "procesar-cancelacion" });
            return await parseToolCallArguments<CancelacionData>(aiResp, "procesar-cancelacion");
          })(),
          poderUrls.length > 0
            ? extractPoderBancoDedicado(poderUrls, LOVABLE_API_KEY)
            : Promise.resolve(null),
        ]);

        // El monolítico es obligatorio — si falla, levantamos el error.
        if (monoSettled.status !== "fulfilled") {
          throw monoSettled.reason;
        }
        const extracted = monoSettled.value;
        const dedicatedResult: PoderDedicadoResult | null =
          dedicatedSettled.status === "fulfilled" ? dedicatedSettled.value : null;

        // Read-then-Merge: el OCR dedicado rellena huecos del monolítico.
        const mergedPoder = mergePoderBanco(extracted.poder_banco, dedicatedResult);
        if (mergedPoder) {
          extracted.poder_banco = mergedPoder;
        } else if (poderUrls.length === 0) {
          // No se adjuntó poder → no debe existir el objeto.
          delete (extracted as { poder_banco?: unknown }).poder_banco;
        }

        // Telemetría no bloqueante (Eje A v3).
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
            dedicated_status: dedicatedSettled.status,
            dedicated_error: dedicatedSettled.status === "rejected"
              ? String((dedicatedSettled as PromiseRejectedResult).reason).slice(0, 200)
              : undefined,
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
        let cuantiaDedicada: CuantiaDedicadaResult | null = null;
        let cuantiaAplicada = false;
        if (debeReintentar) {
          try {
            cuantiaDedicada = await extractCuantiaDedicada(escUrls, LOVABLE_API_KEY);
          } catch (e) {
            console.error("[procesar-cancelacion cuantia] dedicated OCR failed:", e);
          }
          const mergeResult = mergeCuantiaIntoExtracted(extracted, cuantiaDedicada);
          cuantiaAplicada = mergeResult.applied;
        }
        void logCuantiaEvent(supabaseService, {
          orgId, cancelacionId, userId,
          resultado: !debeReintentar
            ? "no_aplica"
            : (cuantiaDedicada?.valor_hipoteca_original ? "exito" : "fallo"),
          paginas_enviadas: debeReintentar ? escUrls.length : 0,
          cert_indeterminada: certIndet,
          monto_encontrado: !!(cuantiaDedicada?.valor_hipoteca_original),
          aplicado: cuantiaAplicada,
          tiempo_ms: debeReintentar ? Date.now() - tCuantiaStart : 0,
          extra: { trigger: "auto" },
        });

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

    return biz("internal", "Error interno del servidor. Intente de nuevo.");
  }
});

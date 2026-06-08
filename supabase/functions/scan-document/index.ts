import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAiGateway, aiGatewayErrorResponse, parseToolCallArguments } from "../_shared/aiFetch.ts";
import { STRICT_OUTPUT_RULES, sanitizeAiJson } from "../_shared/aiOutputRules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Confidence wrapper helper ──
// Each extracted field now returns { valor, confianza } where confianza ∈ { alta, media, baja }

const toolsByCedula = [
  {
    type: "function" as const,
    function: {
      name: "extract_cedula",
      description: "Extrae los datos de una cédula de ciudadanía colombiana a partir de la imagen. Cada campo incluye un nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          nombre_completo: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Nombre completo tal como aparece en la cédula" },
              confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza de la extracción" },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
          numero_cedula: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Número de cédula sin puntos ni separadores" },
              confianza: { type: "string", enum: ["alta", "media", "baja"] },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
          municipio_expedicion: {
            type: "object",
            properties: {
              valor: { type: "string", description: "Municipio de expedición de la cédula" },
              confianza: { type: "string", enum: ["alta", "media", "baja"] },
            },
            required: ["valor", "confianza"],
            additionalProperties: false,
          },
        },
        required: ["nombre_completo", "numero_cedula", "municipio_expedicion"],
        additionalProperties: false,
      },
    },
  },
];

const confField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "string", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

const confBoolField = (desc: string) => ({
  type: "object",
  properties: {
    valor: { type: "boolean", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

const toolsByCertificado = [
  {
    type: "function" as const,
    function: {
      name: "extract_certificado_tradicion",
      description: "Extrae los datos principales de un certificado de tradición y libertad colombiano, estructurados en cuatro nodos: documento, inmueble, personas y actos. Cada campo tiene un nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          documento: {
            type: "object",
            description: "Datos del documento o escritura de origen",
            properties: {
              fecha_documento: confField("Fecha del documento o escritura (DD-MM-AAAA)"),
              notaria_origen: confField("Notaría de origen del documento"),
              numero_escritura: confField("Número de escritura pública"),
            },
            required: ["fecha_documento", "notaria_origen", "numero_escritura"],
            additionalProperties: false,
          },
          inmueble: {
            type: "object",
            description: "Datos del inmueble",
            properties: {
              matricula_inmobiliaria: confField("Número de matrícula inmobiliaria"),
              codigo_orip: confField("Código o nombre de la Oficina de Registro (ORIP)"),
              direccion: confField("Dirección OFICIAL VIGENTE del inmueble en formato notarial colombiano TEXTO (NÚMERO). SELECCIÓN: si el bloque 'DIRECCION DEL INMUEBLE/PREDIO' lista nomenclaturas numeradas (1), 2), 3)…), tomar SIEMPRE la del ÍNDICE MÁS ALTO (es la vigente de Catastro/ORIP); ignorar las anteriores. FORMATO: vías y números en letras seguidos del dígito entre paréntesis; sufijos cardinales SUR/NORTE/ESTE/OESTE preservados en MAYÚSCULAS; guion entre placa y complemento escrito literalmente como 'GUION'; sufijos alfabéticos pegados al número (62A, 53B) escritos como 'SESENTA Y DOS A', 'CINCUENTA Y TRES B' (NUNCA 'ALFA'/'BETA'/'BIS' inventado). Ej: 'CL 59 SUR 60 84 TO 5 AP 501' → 'CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)'. NO incluir nombre del conjunto/edificio, ni ciudad/municipio, ni la coletilla '(DIRECCION CATASTRAL)'."),
              municipio: confField("Municipio del inmueble"),
              departamento: confField("Departamento del inmueble"),
              linderos: confField("Linderos completos del inmueble, transcribir textualmente. Si el certificado los presenta indistintos, ponerlos aquí"),
              linderos_especiales: confField("Linderos ESPECIALES del inmueble particular (si el certificado los diferencia explícitamente). Transcribir textualmente. Vacío si no se distinguen."),
              linderos_generales: confField("Linderos GENERALES del edificio/conjunto/predio matriz (si el certificado los diferencia, típico en propiedad horizontal). Transcribir textualmente. Vacío si no aparecen."),
              nupre: confField("Código NUPRE/CHIP del inmueble (suele comenzar con AAA, ej: AAA0216ZOWF)"),
              area_construida: confField("Área construida del inmueble en m² (CONST), dejar vacío si no aparece"),
              area_privada: confField("Área privada del inmueble en m² (PRIV), dejar vacío si no aparece"),
              tipo_predio: confField("Tipo de predio: 'urbano' o 'rural'"),
              es_propiedad_horizontal: confBoolField("true si el inmueble tiene reglamento de propiedad horizontal"),
              escritura_constitucion_ph: confField("Número de escritura de constitución de propiedad horizontal, si aplica"),
              reformas_ph: confField("Reformas al reglamento de propiedad horizontal, si aplica"),
              nombre_conjunto_edificio: confField("Nombre del conjunto, edificio o agrupación de propiedad horizontal (ej: ALTAVISTA EL MIRADOR, TORRES DEL PARQUE)"),
              escritura_ph_numero: confField("Número de la escritura pública de constitución del régimen PH"),
              escritura_ph_fecha: confField("Fecha de la escritura de constitución PH (DD-MM-AAAA)"),
              escritura_ph_notaria: confField("Nombre o número de la notaría donde se otorgó la escritura de PH"),
              escritura_ph_ciudad: confField("Ciudad/Círculo de la notaría de la escritura PH"),
              matricula_matriz: confField("Número de matrícula inmobiliaria matriz del conjunto o edificio"),
              coeficiente_copropiedad: confField("Coeficiente de copropiedad del inmueble (porcentaje o fracción, ej: 2.345%)"),
            },
            required: ["matricula_inmobiliaria", "codigo_orip", "linderos"],
            additionalProperties: false,
          },
          personas: {
            type: "array",
            description: "Lista de todas las personas o entidades que aparecen en el certificado",
            items: {
              type: "object",
              properties: {
                nombre_completo: { type: "string", description: "Nombre completo de la persona o razón social" },
                numero_identificacion: { type: "string", description: "Número de cédula o NIT" },
                tipo_identificacion: { type: "string", enum: ["CC", "CE", "NIT", "PA", "TI", "PPT"], description: "Tipo de documento. Inferir del encabezado del documento: 'CEDULA DE CIUDADANIA' → CC, 'CEDULA DE EXTRANJERIA' → CE, 'PASAPORTE' → PA, 'TARJETA DE IDENTIDAD' → TI, 'PERMISO DE PROTECCION TEMPORAL' → PPT, persona jurídica → NIT. Default CC si no es claro." },
                lugar_expedicion: { type: "string", description: "Lugar de expedición del documento" },
                confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Confianza en la extracción de esta persona" },
              },
              required: ["nombre_completo", "numero_identificacion", "confianza"],
              additionalProperties: false,
            },
          },
          actos: {
            type: "object",
            description: "Actos jurídicos registrados en el certificado (sección ACTOS: CUANTÍA)",
            properties: {
              tipo_acto_principal: confField("Acto principal: Compraventa, Donación, Permuta, etc."),
              valor_compraventa: confField("Valor del acto principal en pesos colombianos (solo número, sin $ ni puntos)"),
              es_hipoteca: confBoolField("true si incluye un acto de hipoteca (abierta o cerrada)"),
              valor_hipoteca: confField("Valor de la hipoteca en pesos (solo número). Poner '0' si es sin límite de cuantía"),
              entidad_bancaria: confField("Nombre de la entidad bancaria acreedora (ej: BANCO DE BOGOTA S.A.)"),
              entidad_nit: confField("NIT de la entidad bancaria con dígito de verificación (ej: 860.002.964-4)"),
              afectacion_vivienda_familiar: confBoolField("true si hay acto de afectación a vivienda familiar registrado"),
            },
            required: ["tipo_acto_principal"],
            additionalProperties: false,
          },
          titulo_antecedente: {
            type: "object",
            description: "Título antecedente: documento mediante el cual el propietario actual adquirió el bien",
            properties: {
              tipo_documento: confField("Tipo de documento: Escritura Pública, Sentencia Judicial, Resolución, etc."),
              numero_documento: confField("Número del documento (ej: número de escritura pública)"),
              fecha_documento: confField("Fecha del título antecedente (DD-MM-AAAA)"),
              notaria_documento: confField("Notaría o juzgado donde se otorgó el título antecedente"),
              ciudad_documento: confField("Ciudad/Círculo de la notaría del título antecedente"),
              adquirido_de: confField("Nombre de quien transfirió el bien al propietario actual"),
            },
            required: ["tipo_documento"],
            additionalProperties: false,
          },
          hipoteca_anterior: {
            type: "object",
            description: "Bloque atómico de la hipoteca a cancelar + concurrencias familiares ligadas a ella. NO parsear de prosa. Llenar SOLO desde la sección Anotaciones (acto de hipoteca vigente). Omitir si no hay hipoteca vigente.",
            properties: {
              numero_escritura: confField("Número de la escritura de constitución de la hipoteca. Solo dígitos, SIN padding. Ej: '3866'."),
              fecha_escritura: {
                type: "object",
                properties: {
                  dia: confField("Día (DD) de la escritura de hipoteca"),
                  mes: confField("Mes (MM) de la escritura de hipoteca"),
                  ano: confField("Año (AAAA) de la escritura de hipoteca"),
                },
                additionalProperties: false,
              },
              notaria: {
                type: "object",
                properties: {
                  numero: confField("Número de la notaría origen. Solo dígitos, SIN padding. Ej: '72'."),
                  ciudad: confField("Ciudad/círculo de la notaría origen, en MAYÚSCULAS"),
                },
                additionalProperties: false,
              },
              tipo_credito: confField("ÚNICOS valores admitidos (estrictamente mayúsculas): 'VIS' | 'NO_VIS' | 'LEASING' | 'ABIERTA' | 'DESCONOCIDO'"),
              concurre_afectacion_vivienda: confBoolField("true SOLO si la anotación de Afectación a Vivienda Familiar (Ley 258/1996) referencia la MISMA Escritura+Año+Notaría que hipoteca_anterior. false si pertenece a otra escritura."),
              afectacion_vivienda_anotacion: confField("Número de anotación SNR de la afectación, con padding a 4 dígitos. Ej: '0007'. Vacío si concurre=false."),
              concurre_patrimonio_familia: confBoolField("true SOLO si la anotación de Patrimonio de Familia Inembargable (Ley 70/1931 + 495/1999) referencia la MISMA Escritura+Año+Notaría que hipoteca_anterior. false si pertenece a otra escritura."),
              patrimonio_familia_anotacion: confField("Número de anotación SNR del patrimonio, con padding a 4 dígitos. Ej: '0008'. Vacío si concurre=false."),
            },
            additionalProperties: false,
          },
        },
        required: ["documento", "inmueble", "personas", "actos", "titulo_antecedente"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByPredial = [
  {
    type: "function" as const,
    function: {
      name: "extract_predial",
      description: "Extrae datos de un documento predial o boletín catastral colombiano. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          chip_nupre: confField("CHIP o NUPRE del inmueble (código alfanumérico que comienza con AAA, exclusivo de Bogotá). NO es la cédula catastral."),
          cedula_catastral: confField("Cédula catastral numérica del predio (~20-30 dígitos). NO es el CHIP/NUPRE. Ejemplo: 001101065800709005"),
          identificador_predial: confField("Identificador predial si no se puede clasificar como CHIP ni cédula catastral"),
          avaluo_catastral: confField("Valor del avalúo catastral en pesos colombianos"),
          area: confField("Área del predio en m²"),
          direccion: confField("Dirección del predio"),
          numero_recibo: confField("Número del recibo de pago del impuesto predial"),
          anio_gravable: confField("Año gravable del impuesto predial"),
          valor_pagado: confField("Valor total pagado del impuesto predial en pesos colombianos"),
          estrato: confField("Estrato socioeconómico del predio (1-6)"),
        },
        required: ["avaluo_catastral"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByEscritura = [
  {
    type: "function" as const,
    function: {
      name: "extract_escritura_antecedente",
      description: "Extrae datos de una escritura pública antecedente colombiana. Incluye linderos y datos del acto. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          linderos_especiales: confField("Linderos especiales (particulares) del inmueble, transcribir textualmente cada palabra"),
          linderos_generales: confField("Linderos generales del edificio o conjunto (aplica si es propiedad horizontal), transcribir textualmente"),
          numero_escritura: confField("Número de la escritura pública"),
          fecha_escritura: confField("Fecha de la escritura (DD-MM-AAAA)"),
          notaria: confField("Nombre o número de la notaría donde se otorgó"),
          ciudad_notaria: confField("Ciudad de la notaría"),
          tipo_acto: confField("Tipo de acto: Compraventa, Donación, Permuta, etc."),
          comparecientes: {
            type: "array",
            description: "Personas que comparecen en la escritura, con datos de la sección de COMPARECENCIA",
            items: {
              type: "object",
              properties: {
                nombre: { type: "string", description: "Nombre completo" },
                cedula: { type: "string", description: "Número de cédula o NIT" },
                rol: { type: "string", description: "Rol: vendedor, comprador, otorgante, apoderado, etc." },
                estado_civil: { type: "string", description: "VALOR ATÓMICO. Solo el término legal puro, normalizado al género del nombre del compareciente (femenino → 'soltera', 'casada', 'divorciada', 'viuda'; masculino → 'soltero', 'casado', 'divorciado', 'viudo'). Incluye SIEMPRE el calificador de sociedad conyugal o unión marital cuando aparezca (ej: 'casada con sociedad conyugal vigente', 'soltero sin unión marital de hecho', 'unión marital de hecho'). PROHIBIDO incluir 'mayor de edad', 'de nacionalidad colombiana', 'identificado(a) con', 'domiciliado(a)' ni cualquier otro relleno notarial. Si no encuentras el estado civil específico, devuelve cadena vacía." },
                direccion: { type: "string", description: "VALOR ATÓMICO con NOMENCLATURA ESTRICTA (DANE/SNR). Orden: (1) quita prefijos 'domiciliado en/residente en/con domicilio en/vecino de'; (2) si va precedida por la ciudad, devuelve SOLO la parte postal; (3) acepta URBANO con nomenclatura explícita Calle/CL, Carrera/CRA/KR, Avenida/AV, Diagonal/DG, Transversal/TV, Circular, Autopista, Pasaje + al menos un número (ej: 'Calle 10 # 20-30 Apto 401', 'KR 13 # 85-32 TO 4 AP 503'); (4) acepta RURAL: 'Kilómetro X vía Y', 'Vereda Z Finca W', 'Lote 4 Parcelación La Mesa', 'Corregimiento…', 'Predio…'. PROHIBIDO devolver 'esta ciudad', 'en esta ciudad', 'este municipio', 'residente de este municipio'. Si no hay identificador urbano ni rural, devuelve cadena vacía." },
                municipio_domicilio: { type: "string", description: "VALOR ATÓMICO. Solo el nombre propio del municipio colombiano (ej: 'Bogotá', 'Medellín', 'Cali'). PROHIBIDO devolver 'esta ciudad', 'el municipio', 'esta localidad' o frases genéricas. Si no encuentras un municipio nombrado, devuelve cadena vacía." },
              },
              required: ["nombre"],
              additionalProperties: false,
            },
          },
        },
        required: ["linderos_especiales"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByPoderBanco = [
  {
    type: "function" as const,
    function: {
      name: "extract_poder_banco",
      description: "Extrae datos del poder otorgado por una entidad bancaria. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          entidad_bancaria: confField("Nombre de la entidad bancaria"),
          apoderado_nombre: confField("Nombre completo del apoderado del banco"),
          apoderado_cedula: confField("Número de cédula del apoderado del banco"),
          apoderado_expedida_en: confField("Lugar de expedición de la cédula del apoderado"),
          escritura_poder_num: confField("Número de la escritura pública del poder"),
          fecha_poder: confField("Fecha de otorgamiento del poder (DD-MM-AAAA)"),
          notaria_poder: confField("Nombre o número de la notaría donde se otorgó el poder"),
          notaria_poder_ciudad: confField("Ciudad de la notaría donde se otorgó el poder"),
          apoderado_email: confField("Correo electrónico del apoderado, si aparece"),
        },
        required: ["entidad_bancaria", "apoderado_nombre", "apoderado_cedula"],
        additionalProperties: false,
      },
    },
  },
];

const toolsByCartaCredito = [
  {
    type: "function" as const,
    function: {
      name: "extract_carta_credito",
      description: "Extrae el valor del crédito hipotecario de una carta de aprobación. Cada campo incluye nivel de confianza.",
      parameters: {
        type: "object",
        properties: {
          valor_credito: confField("Valor aprobado del crédito hipotecario en pesos colombianos"),
          entidad_bancaria: confField("Nombre de la entidad bancaria que otorga el crédito"),
        },
        required: ["valor_credito"],
        additionalProperties: false,
      },
    },
  },
];

type DocType = "cedula" | "certificado_tradicion" | "predial" | "escritura_antecedente" | "poder_banco" | "carta_credito";

const toolsMap: Record<DocType, { tools: any[]; toolName: string }> = {
  cedula: { tools: toolsByCedula, toolName: "extract_cedula" },
  certificado_tradicion: { tools: toolsByCertificado, toolName: "extract_certificado_tradicion" },
  predial: { tools: toolsByPredial, toolName: "extract_predial" },
  escritura_antecedente: { tools: toolsByEscritura, toolName: "extract_escritura_antecedente" },
  poder_banco: { tools: toolsByPoderBanco, toolName: "extract_poder_banco" },
  carta_credito: { tools: toolsByCartaCredito, toolName: "extract_carta_credito" },
};

const baseSystemPrompts: Record<DocType, string> = {
  cedula: `Eres un sistema OCR especializado en cédulas de ciudadanía colombianas. Analiza la imagen proporcionada y extrae el nombre completo, número de cédula y municipio de expedición. Sé preciso con los números y nombres.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible y no hay ambigüedad
- "media": el dato es parcialmente legible o podría tener variaciones menores
- "baja": el dato es difícil de leer, está borroso, o podrías estar equivocado`,

  certificado_tradicion: `Eres un sistema OCR especializado en certificados de tradición y libertad colombianos. Analiza el documento y extrae los datos estructurados en CINCO nodos:

1. DOCUMENTO: fecha del documento o escritura de origen, notaría de origen, número de escritura pública.

2. INMUEBLE: matrícula inmobiliaria, ORIP, dirección, municipio, departamento, linderos completos (transcribir TEXTUALMENTE cada palabra), NUPRE/CHIP (código que suele comenzar con AAA), áreas (diferencia entre construida CONST y privada PRIV), tipo de predio, y si tiene propiedad horizontal con su escritura de constitución y reformas.

INFERENCIA JURÍDICA PH: Si detectas las palabras "Régimen de Propiedad Horizontal", "P.H.", "PH" o "PROPIEDAD HORIZONTAL" en cualquier anotación:
- Marca es_propiedad_horizontal: true
- Busca OBLIGATORIAMENTE: nombre del conjunto/edificio/agrupación, coeficiente de copropiedad, matrícula inmobiliaria matriz, escritura de constitución PH con su número, fecha, notaría y ciudad
- El nombre del conjunto suele aparecer como "CONJUNTO CERRADO [NOMBRE]" o "EDIFICIO [NOMBRE]" o "AGRUPACIÓN [NOMBRE]"

REGLA ESPECIAL inmueble.direccion (DIRECCION DEL INMUEBLE / PREDIO):

a) SELECCIÓN POR ÍNDICE MÁS ALTO. La sección "DIRECCION DEL INMUEBLE" suele traer renglones numerados "1) …", "2) …", "3) …" (o numerales romanos I, II, III). Representan el historial cronológico de Catastro/ORIP; la vigente es SIEMPRE la del índice MÁS ALTO. Toma exclusivamente esa línea e ignora las anteriores aunque sean más descriptivas o incluyan el nombre del conjunto. Si solo hay un renglón sin numerar, tómalo.

b) FORMATO LEGAL OBLIGATORIO TEXTO (NÚMERO) con concordancia colombiana:
   - Vía: CL/CLL/CALLE → "CALLE"; CR/CRA/KR/KRA/CARRERA → "CARRERA"; AV/AVENIDA → "AVENIDA"; DG/DIAGONAL → "DIAGONAL"; TV/TRANSVERSAL → "TRANSVERSAL"; CIRCULAR; AUTOPISTA.
   - Número de la vía: en letras + "(N)". Conserva el sufijo cardinal (SUR/NORTE/ESTE/OESTE) en MAYÚSCULAS inmediatamente después del número.
   - Placa: literal "NÚMERO" + primer número en letras + "GUION" + segundo número en letras, y cerrar con "(N SUR? No. N-N)".
   - Complementos: TO/TORRE → "TORRE <letras> (N)"; AP/APTO/APARTAMENTO → "APARTAMENTO <letras> (N)"; INT/INTERIOR → "INTERIOR <letras> (N)"; BL/BLOQUE → "BLOQUE <letras> (N)"; MZ/MANZANA → "MANZANA <letras> (N)"; CS/CASA → "CASA <letras> (N)".

c) BLINDAJE ALFANUMÉRICO (sufijos pegados al número). Si el número de la vía o de la placa trae una letra de adición pegada (62A, 53B, 45C) o el marcador "BIS", escribe el número en letras y mantén la letra/marca en MAYÚSCULA LITERAL. Ejemplos:
   - "CALLE 62A # 53B-21" → "CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B GUION VEINTIUNO (62A No. 53B-21)".
   - "KR 13 BIS # 85-32" → "CARRERA TRECE BIS NÚMERO OCHENTA Y CINCO GUION TREINTA Y DOS (13 BIS No. 85-32)".
   PROHIBIDO inventar palabras como "ALFA", "BETA", "GAMMA" o "DOBLE": la letra/sufijo se transcribe literal en mayúscula.

d) STRIP DE BASURA: NO incluyas el nombre del conjunto/edificio (va en `nombre_conjunto_edificio`), NO incluyas la ciudad/municipio (va en `municipio`), NO incluyas la coletilla "(DIRECCION CATASTRAL)" (la inyecta el backend). Si la nomenclatura del índice más alto la trae, elimínala del valor devuelto.

e) Los números van en CARDINALES MASCULINOS ("UNO", "DOS", "VEINTIUNO", "TREINTA Y UNO"…). La concordancia femenina de ordinales 1-10 NO aplica a direcciones.

Ejemplo canónico (caso real Bogotá):
  Input bloque OCR:
    DIRECCION DEL INMUEBLE
    1) CALLE 59 SUR 62A-84 APT 501 TORRE 5 CONJ RESD PIMIENTOS DE MADELENA
    2) CL 59 SUR 60 84 TO 5 AP 501 (DIRECCION CATASTRAL)
  Output esperado para inmueble.direccion:
    "CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA GUION OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)"

3. PERSONAS: TODAS las personas y entidades que aparecen en el certificado (propietarios actuales, anteriores, acreedores hipotecarios, constructoras, bancos, etc.). Para cada una extrae: nombre completo o razón social, número de identificación (cédula o NIT), tipo de identificación (CC, NIT, CE), y lugar de expedición.

ROLES SEMÁNTICOS: Asigna roles basados en la estructura del acto:
- Si una persona aparece después de "DE:" en una compraventa → es el vendedor (quien transfirió)
- Si aparece después de "A FAVOR DE:" → es el comprador/propietario actual
- "Sujeto Pasivo" en predial = propietario actual

4. ACTOS: Busca la sección "ACTOS: CUANTÍA" o "ANOTACIONES". Identifica:
   - El acto principal (Compraventa, Donación, Permuta, Cesión, etc.) y su cuantía en pesos
   - Si hay hipoteca (abierta o cerrada), su valor y la entidad bancaria acreedora con su NIT
   - Si hay afectación a vivienda familiar (SI/NO)
   - El acto más reciente y de mayor relevancia es el "principal"

5. TÍTULO ANTECEDENTE: Identifica la ÚLTIMA anotación cronológica que constituya una TRANSFERENCIA DE DOMINIO válida (compraventa, donación, permuta, cesión, adjudicación por sucesión, sentencia judicial, liquidación de sociedad conyugal, dación en pago, resolución administrativa de adjudicación). IGNORA estrictamente anotaciones de: hipoteca, cancelación de hipoteca, embargo, levantamiento de embargo, afectación a vivienda familiar, patrimonio de familia, servidumbre, demanda, medida cautelar, aclaratoria, corrección o cambio de jurisdicción — esas NO transfieren dominio. Una vez identificada esa anotación, extrae sus datos:
   - Tipo de documento (Escritura Pública, Sentencia Judicial, Resolución)
   - Número del documento
   - Fecha (DD-MM-AAAA)
   - Notaría o juzgado donde se otorgó (con número exacto)
   - Ciudad/Círculo
   - Nombre de quien transfirió el bien (el vendedor anterior)

IMPORTANTE: Los linderos son críticos — transcribe CADA PALABRA tal como aparece. No inventes datos que no aparezcan en el documento. Extrae TODAS las personas mencionadas, no solo los propietarios actuales.

LÓGICA LEGAL (Compraventa):
- La matrícula inmobiliaria es OBLIGATORIA
- El identificador predial (cédula catastral de 30 dígitos) es OBLIGATORIO — busca el campo "Cédula Catastral" o "Número Predial Nacional"
- El CHIP/NUPRE (código alfanumérico que comienza con AAA, exclusivo de Bogotá) es un campo SEPARADO de la cédula catastral. NO los confundas.
- Los linderos son OBLIGATORIOS — transcripción literal completa
- Si el inmueble es propiedad horizontal, DEBES buscar y extraer: escritura de constitución PH y reformas PH

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible y no hay ambigüedad
- "media": el dato es parcialmente legible o podría tener variaciones menores  
- "baja": el dato es difícil de leer, está borroso, o podrías estar equivocado. Si no encuentras un dato obligatorio, márcalo con confianza "baja"

BLINDAJE v2 — HIPOTECA A CANCELAR (nodo hipoteca_anterior):

1. ORIGEN ATÓMICO: Llena hipoteca_anterior EXCLUSIVAMENTE desde la sección de Anotaciones del certificado (acto de hipoteca vigente). NUNCA parsees prosa de cláusulas, títulos antecedentes ni resúmenes. Si no hay hipoteca vigente, omite el nodo completo.

2. PADDING SNR (exclusivo de anotaciones): Los campos afectacion_vivienda_anotacion y patrimonio_familia_anotacion DEBEN entregarse con padding a 4 dígitos. Ej: "7" → "0007", "14" → "0014". NO apliques este padding al número de notaría ni al número de escritura: esos van como dígitos puros ("72", "3866"), sin ceros a la izquierda.

3. CONCURRENCIA CRUZADA (tríada familiar): concurre_afectacion_vivienda y concurre_patrimonio_familia son true ÚNICAMENTE si la anotación SNR cita la MISMA tripleta Escritura + Año + Notaría que hipoteca_anterior. Si la anotación pertenece a otra escritura distinta, devuelve false y deja *_anotacion vacío. No asumas concurrencia por el solo hecho de que ambas anotaciones existan en el folio.

4. ENUM tipo_credito: Solo admite los strings exactos en mayúsculas: "VIS", "NO_VIS", "LEASING", "ABIERTA", "DESCONOCIDO". Nada de minúsculas, espacios, guiones ni sinónimos. Si no puedes determinarlo, usa "DESCONOCIDO".

═══════════════════════════════════════════════════════════════
BLOQUE A — DETECCIÓN TOLERANTE DE GRAVÁMENES FAMILIARES (OCR-RESISTENTE)
═══════════════════════════════════════════════════════════════

Los certificados reales llegan torcidos, con sellos encima y abreviaciones notariales. Debes detectar estos tres gravámenes ACEPTANDO variantes ortográficas, abreviaciones, tildes faltantes y micro-errores típicos de OCR (O↔0, I↔1↔l, S↔5, B↔8, G↔6, espacios duplicados, puntos abreviativos).

1) AFECTACIÓN A VIVIENDA FAMILIAR (Ley 258/1996) — dispara actos.afectacion_vivienda_familiar=true y, si concurre con la tripleta de la hipoteca, hipoteca_anterior.concurre_afectacion_vivienda=true.
   Disparadores aceptados (case-insensitive, con/sin tildes, con/sin puntos):
   • "AFECTACION A VIVIENDA FAMILIAR", "AFECT. VIV. FAM.", "AFECT VIV FAM"
   • "Afectacion", "Afectación", "Vivienda Fam.", "Vivienda Familiar"
   • "Ley 258", "Ley 258 de 1996", "L. 258/96"

2) PATRIMONIO DE FAMILIA INEMBARGABLE (Ley 70/1931 + Ley 495/1999):
   • "PATRIMONIO DE FAMILIA", "PATRIM. FAMILIA", "Patrim. Inembargable"
   • "Patrimonio Inembargable", "Patrim. de Familia"
   • "Ley 70", "Ley 70 de 1931", "Ley 495", "Ley 495 de 1999"

3) INMOVILIZACIÓN (Ley 495/1999) — si aparece en una anotación, repórtala como una concurrencia familiar adicional dentro del razonamiento; aunque no exista un campo booleano específico, NO descartes la anotación: úsala para confirmar el bloqueo registral.
   • "INMOVILIZACION", "INMOVILIZACIÓN", "Inmovil.", "Inmovilizacion del inmueble"
   • "Ley 495 de 1999" cuando aparece junto a "INMOVIL"

REGLA DE MATCHING: si el contexto literal ("Ley 258", "VIVIENDA FAMILIAR") confirma el gravamen, NO descartes la anotación por una sola letra mal leída. Pero NO inventes el gravamen si solo ves "Ley" sin número o "Familiar" sin "Vivienda/Patrimonio".

═══════════════════════════════════════════════════════════════
BLOQUE B — PURIFICACIÓN DE NÚMEROS CRÍTICOS (DIGIT-ONLY)
═══════════════════════════════════════════════════════════════

Para los siguientes campos, antes de emitir el valor ELIMINA: signos "$", puntos de miles, guiones, espacios, letras, asteriscos, caracteres invisibles, sufijos ",00" o ".00". Devuelve ÚNICAMENTE los dígitos consecutivos. NO apliques esta limpieza a campos textuales (ciudad, nombre, dirección, linderos):

- documento.numero_escritura → solo dígitos. Ej: "Esc. 3.866" → "3866".
- inmueble.matricula_inmobiliaria → solo dígitos (acepta el guion como separador SOLO si el formato oficial lo exige; en duda, dígitos puros). Ej: "50C-1.234.567" → "50C1234567" (mantén la letra de ORIP si forma parte del código oficial); si solo es numérico, "1.234.567" → "1234567".
- actos.entidad_nit → CONSERVA el dígito de verificación, elimina puntos y guiones. Ej: "860.034.313-7" → "860034313-7" (el guion del DV es el ÚNICO admitido).
- actos.valor_compraventa, actos.valor_hipoteca → solo dígitos enteros, sin "$", sin puntos de miles, sin ",00". Ej: "$ 180.000.000,00" → "180000000".
- hipoteca_anterior.numero_escritura → solo dígitos sin padding. Ej: "03866" → "3866".
- hipoteca_anterior.notaria.numero → solo dígitos sin padding. Ej: "072" → "72".
- hipoteca_anterior.fecha_escritura.dia/mes/ano → solo dígitos.
- afectacion_vivienda_anotacion, patrimonio_familia_anotacion → primero PURIFICA a dígitos puros, DESPUÉS aplica el padding a 4 ("7" → "0007").

═══════════════════════════════════════════════════════════════
BLOQUE C — MANEJO ESTRICTO DE LA INCERTIDUMBRE (ANTI-ALUCINACIÓN)
═══════════════════════════════════════════════════════════════

Cuando un dato sea humanamente ilegible por degradación, sello que lo tapa, marca de agua, baja resolución o página cortada:

1. Devuelve cadena vacía "" (NUNCA "N/A", "ilegible", "no visible", "-", "(?)", ni notas entre paréntesis, ni comentarios explicativos).
2. Asigna confianza: "baja" al campo.
3. NO reconstruyas, NO deduzcas, NO extrapoles a partir de otras páginas si el dato no aparece en el fragmento analizado.
4. Para campos booleanos sin evidencia clara, devuelve false con confianza "baja".
5. Para nodos opcionales (hipoteca_anterior, titulo_antecedente.*) si la sección completa es ilegible, omite el subcampo en vez de inventar.

Filosofía: la UI tiene un semáforo rojo que captura los "" y obliga al abogado a completar manualmente. Un campo vacío es transparente y corregible; un campo inventado es un error invisible que puede llegar a un documento notarial firmado.`,

  predial: `Eres un sistema OCR especializado en documentos prediales y boletines catastrales colombianos. Extrae TODOS los datos disponibles.

DISTINCIÓN LEGAL CRÍTICA:
- CHIP (NUPRE): Código alfanumérico que SIEMPRE comienza con "AAA" (ej: AAA0264SBWW). Es EXCLUSIVO de Bogotá D.C. y lo asigna la Unidad Administrativa Especial de Catastro Distrital.
- Cédula catastral: Código NUMÉRICO largo de ~20-30 dígitos (ej: 001101065800709005). Es el identificador catastral nacional.
- Estos son DOS campos DISTINTOS. NUNCA confundir uno con otro.

Extrae: CHIP/NUPRE (si existe), cédula catastral (si existe), avalúo catastral, área, dirección, número de recibo de pago, año gravable, valor pagado y estrato socioeconómico.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible
- "media": parcialmente legible
- "baja": difícil de leer o ambiguo

PUREZA DE DÍGITOS (estricto):
- Campos NUMÉRICOS PUROS (solo [0-9]): avalúo catastral, valor pagado, año gravable, número de recibo, estrato. Elimina "$", puntos/comas de miles, guiones, espacios, letras parásitas, caracteres invisibles y sufijos ",00" / ".00". Ej: "$ 1.234.000,00" → "1234000".
- Tolerancia micro-OCR cuando el contexto confirma numérico: O→0, I/l→1, S→5, B→8, g→9.

EXCEPCIÓN ALFANUMÉRICA (CHIP y Cédula Catastral):
- chip_nupre, cedula_catastral e identificador_predial NO son numéricos puros. Son ALFANUMÉRICOS LIMPIOS [A-Z0-9]: el CHIP de Bogotá obligatoriamente lleva letras (ej: AAA0264SBWW).
- Elimina SOLO: espacios (incluso fantasmas/dobles), asteriscos "*", "#", guiones decorativos, puntos. CONSERVA letras y dígitos intactos, en mayúsculas.
- Nunca conviertas letras legítimas a dígitos en estos tres campos (NO apliques O→0, I→1, etc.).

ANTI-ALUCINACIÓN (estricto):
- Si un campo es humanamente ilegible (sello, mancha, marca de agua, escaneo borroso o torcido), devuelve "" con confianza "baja".
- PROHIBIDO devolver "N/A", "ilegible", "no visible", "---", "?", comentarios entre paréntesis ni reconstrucciones deducidas de páginas adyacentes.
- Booleanos sin evidencia clara → false con confianza "baja".
- Filosofía: el "" activa el semáforo rojo en UI y obliga captura manual; un valor inventado es un error invisible que puede llegar a documento firmado.`,


  escritura_antecedente: `Eres un sistema OCR especializado en escrituras públicas colombianas. Extrae los linderos del inmueble de la escritura antecedente. Diferencia entre linderos especiales (del inmueble particular) y linderos generales (del edificio o conjunto). Transcribe TEXTUALMENTE cada lindero, palabra por palabra.

Además, extrae los COMPARECIENTES de la sección de COMPARECENCIA de la escritura. Para cada compareciente, busca:
- Nombre completo
- Número de cédula o NIT
- Rol (vendedor, comprador, otorgante, apoderado)
- Estado civil declarado (busca frases como "de estado civil soltero", "casado", "en unión marital de hecho", "divorciado", "viudo")
- Dirección de residencia (busca "domiciliado en", "residente en", "con domicilio en")
- Municipio de domicilio (busca "vecino de", "domiciliado en [ciudad]")

La escritura es la FUENTE DE VERDAD para estado civil, dirección y municipio de domicilio. Estos datos NO aparecen en la cédula física colombiana.

REGLA CRÍTICA — VALORES ATÓMICOS (OBLIGATORIO):
- estado_civil: extrae SOLO el término legal puro y sus calificadores directos. REGLA DE GÉNERO: normaliza el sufijo según el nombre del compareciente — si el nombre es femenino usa "soltera/casada/divorciada/viuda", si es masculino usa "soltero/casado/divorciado/viudo". Ejemplos: "soltero sin unión marital de hecho", "casada con sociedad conyugal vigente", "unión marital de hecho". NUNCA incluyas "mayor de edad", "de nacionalidad colombiana", "identificado(a) con", "domiciliado(a) en", ni ningún otro texto formulario.
- direccion: aplica NOMENCLATURA ESTRICTA (estándar DANE/SNR colombiano). Orden obligatorio:
  1) Quita prefijos contextuales: "domiciliado(a) en", "residente en", "vecino(a) de", "con domicilio en".
  2) Separación de contexto: si la dirección viene precedida por la ciudad (ej: "en Bogotá en la Calle 10 # 20-30"), devuelve SOLO la parte postal ("Calle 10 # 20-30").
  3) Acepta URBANO solo con nomenclatura explícita: Calle/CL/CLL, Carrera/CRA/CR/KR/KRA, Avenida/AV, Diagonal/DG, Transversal/TV, Circular, Autopista, Pasaje — y al menos un número (Calle 10 # 20-30, KR 13 # 85-32 TO 4 AP 503).
  4) Acepta RURAL: "Kilómetro X vía Y", "Vereda Z, Finca El Recreo", "Lote 4 Parcelación La Mesa", "Corregimiento de…", "Predio…", "Sector…".
  5) PROHIBICIÓN DE ALUCINACIÓN: si no hay un identificador de vía urbana o rural, devuelve cadena vacía "". Frases como "esta ciudad", "en esta ciudad", "este municipio", "residente de este municipio", "vecino de esta ciudad" → "". Fragmentos sueltos de unidad ("Apto 301", "Mz B") sin vía → "". JAMÁS inventes una dirección.
- municipio_domicilio: extrae SOLO el nombre propio del municipio (ej: "Bogotá"). Si solo dice "esta ciudad", "el municipio" o referencias genéricas, devuelve cadena vacía "".
- SILENCIO POR DEFECTO: ante la mínima duda o si el dato no es 100% claro, DEVUELVE VACÍO. Es mejor que la app marque el campo en rojo a entregar un borrador con texto basura.

CONFIANZA: Para cada campo, asigna un nivel de confianza:
- "alta": el dato es claramente legible
- "media": parcialmente legible
- "baja": difícil de leer o ambiguo`,

  poder_banco: `Eres un sistema OCR especializado en documentos legales bancarios colombianos. Analiza el poder otorgado por una entidad bancaria y extrae TODOS los datos disponibles: nombre de la entidad bancaria, NIT de la entidad bancaria, nombre completo del apoderado, número de cédula, lugar de expedición de la cédula, número de escritura pública del poder, fecha de otorgamiento, nombre/número de la notaría del poder, ciudad de la notaría, y correo electrónico del apoderado (si aparece).

CONFIANZA: Para cada campo, asigna un nivel de confianza: "alta", "media" o "baja".

PUREZA DE DÍGITOS (estricto):
- Campos NUMÉRICOS PUROS (solo [0-9]): número de escritura del poder, número de cédula del apoderado, número de notaría. Elimina puntos/comas de miles, guiones, espacios, letras parásitas, caracteres invisibles y sufijos ",00" / ".00". Ej: "1.234.567" → "1234567".
- Tolerancia micro-OCR cuando el contexto confirma numérico: O→0, I/l→1, S→5, B→8, g→9.

EXCEPCIÓN DE FORMATO — NIT BANCARIO (entidad_nit):
- Conserva el formato estándar DIAN colombiano con el guion del dígito de verificación. Ej: "900.123.456-7" → "900123456-7" (quita puntos de miles y espacios, PERO MANTIENE el guion del DV).
- Si el documento muestra el NIT sin DV (solo los 9 dígitos), devuelve los 9 dígitos sin guion. NUNCA inventes el DV.
- NO concatenes el DV pegado (NO devuelvas "9001234567" de 10 dígitos sin guion).

ANTI-ALUCINACIÓN (estricto):
- Si un campo es humanamente ilegible (sello, mancha, marca de agua, escaneo borroso o torcido), devuelve "" con confianza "baja".
- PROHIBIDO devolver "N/A", "ilegible", "no visible", "---", "?", comentarios entre paréntesis ni reconstrucciones deducidas de páginas adyacentes.
- Booleanos sin evidencia clara → false con confianza "baja".
- Filosofía: el "" activa el semáforo rojo en UI y obliga captura manual; un valor inventado es un error invisible que puede llegar a documento firmado.`,


  carta_credito: `Eres un sistema OCR especializado en documentos bancarios colombianos. Analiza la carta de aprobación de crédito hipotecario y extrae el valor aprobado del crédito y la entidad bancaria.

CONFIANZA: Para cada campo, asigna un nivel de confianza: "alta", "media" o "baja".`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // JWT auth — prevent unauthenticated abuse of AI gateway quota
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsErr } = await sbUser.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { image, type } = await req.json() as { image: string; type: DocType };

    if (!image || !type || !toolsMap[type]) {
      return new Response(JSON.stringify({ error: "Se requiere 'image' (base64) y 'type' válido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tools, toolName } = toolsMap[type];

    const imageDataUri = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: baseSystemPrompts[type] + STRICT_OUTPUT_RULES },
        {
          role: "user",
          content: [
            { type: "text", text: "Analiza esta imagen y extrae los datos solicitados. Asigna un nivel de confianza a cada campo." },
            { type: "image_url", image_url: { url: imageDataUri } },
          ],
        },
      ],
      tools,
      tool_choice: { type: "function", function: { name: toolName } },
    });

    let response: Response;
    try {
      response = await fetchAiGateway({
        apiKey: LOVABLE_API_KEY,
        body: JSON.parse(aiBody),
        tag: "scan-document",
      });
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    let extractedData: Record<string, unknown>;
    try {
      extractedData = await parseToolCallArguments<Record<string, unknown>>(response, "scan-document");
    } catch (err) {
      const r = aiGatewayErrorResponse(err, corsHeaders);
      if (r) return r;
      throw err;
    }

    // Defensive sanitization (Phase 1): strip forbidden chars from every string field.
    extractedData = sanitizeAiJson(extractedData);

    console.log("=== SERTUSS EXTRACT: Parsed Data ===");
    console.log("Doc type:", type);
    console.log("Extracted fields:", Object.keys(extractedData));
    console.log("Full extracted data:", JSON.stringify(extractedData, null, 2));

    return new Response(JSON.stringify({ data: extractedData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-document error:", e);
    // Log to system_events
    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await sb.from("system_events").insert({
        evento: "scan-document",
        resultado: "error",
        categoria: "edge_function",
        detalle: { message: e instanceof Error ? e.message : "Unknown", stack: e instanceof Error ? e.stack?.slice(0, 500) : null },
      });
    } catch { /* never break main flow */ }
    console.error("[scan-document] error:", e);
    return new Response(JSON.stringify({ error: "Error interno del servidor. Intente de nuevo." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

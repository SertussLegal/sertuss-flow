// Tool schema para OCR del Poder General del Banco.
//
// Plan v5: schema profundo (cadena Poderdante → Apoderado → Instrumento →
// Facultades → Vigencia) ADITIVO. Los campos planos legacy (entidad_bancaria,
// apoderado_nombre, etc.) se conservan para no romper consumidores actuales
// hasta que POWER_V5_ENABLED se active globalmente.

import { confField } from "../../shared/confFields.ts";

export const poderBancoTool = {
  type: "function" as const,
  function: {
    name: "extract_poder_banco",
    description: "Extrae datos del poder otorgado por una entidad bancaria. Devuelve schema profundo (poderdante → apoderado → instrumento → facultades → vigencia) Y campos planos legacy. Cada campo individual incluye nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        // ─────────────────────────────────────────────────────────────
        // Bloque legacy plano (mantener para back-compat hasta sunset).
        // ─────────────────────────────────────────────────────────────
        entidad_bancaria: confField("Nombre de la entidad bancaria"),
        apoderado_nombre: confField("Nombre completo del apoderado del banco (persona natural firmante)"),
        apoderado_cedula: confField("Número de cédula del apoderado del banco"),
        apoderado_expedida_en: confField("Lugar de expedición de la cédula del apoderado"),
        escritura_poder_num: confField("Número de la escritura pública del poder"),
        fecha_poder: confField("Fecha de otorgamiento del poder (DD-MM-AAAA)"),
        notaria_poder: confField("Nombre o número de la notaría donde se otorgó el poder"),
        notaria_poder_ciudad: confField("Ciudad de la notaría donde se otorgó el poder"),
        apoderado_email: confField("Correo electrónico del apoderado, si aparece"),

        // ─────────────────────────────────────────────────────────────
        // K — Determinación robusta de cadena de representación.
        // TERNARIO: true | false | null. null = ambiguo → captura humana.
        // ─────────────────────────────────────────────────────────────
        has_apoderado_banco_v3: {
          type: "string",
          enum: ["true", "false", "null"],
          description: "Resultado del árbol de decisión K. 'true' = hay apoderado vía escritura de mandato; 'false' = el banco firma directo (RL de Superfinanciera); 'null' = AMBIGUO (página suelta, hoja de firmas sin cláusula). Aplicar el árbol descrito en el prompt — NO asumir 'false' por defecto.",
        },
        motivos_incompletitud: {
          type: "array",
          items: { type: "string" },
          description: "Códigos estables que explican por qué has_apoderado_banco_v3='null'. Ej: ['paginas_parciales_sin_clausula_de_poder', 'firma_aislada_sin_contexto']. Cadena vacía si la lectura es concluyente.",
        },

        // ─────────────────────────────────────────────────────────────
        // Poderdante (la entidad que otorga el poder — el banco).
        // ─────────────────────────────────────────────────────────────
        poderdante: {
          type: "object",
          description: "Entidad bancaria que otorga el poder. Datos del certificado de existencia y representación de la Superintendencia Financiera, si aparece.",
          properties: {
            entidad_nombre: { type: "string", description: "Razón social completa en MAYÚSCULAS. Ej: 'BANCO DAVIVIENDA S.A.'" },
            entidad_nit: { type: "string", description: "NIT con DV en formato '900123456-7'. Sin puntos de miles. null si no es legible." },
            entidad_constitucion_escritura: { type: "string", description: "Escritura pública de constitución del banco, si aparece. Ej: '3892/1972 Notaría 14'. null si no aparece." },
            representante_legal_nombre: { type: "string", description: "Nombre completo del RL que firma EN NOMBRE del banco al otorgar este poder (NO confundir con el apoderado destinatario). null si no aparece." },
            representante_legal_cedula: { type: "string", description: "Cédula del RL del banco. Solo dígitos. null si no es legible." },
            representante_legal_cargo: { type: "string", description: "Cargo del firmante en el banco. Ej: 'SUPLENTE DEL PRESIDENTE'. null si no aparece." },
          },
          additionalProperties: false,
        },

        // ─────────────────────────────────────────────────────────────
        // Apoderado (a quién se le confiere el poder).
        // Puede ser persona natural O jurídica con sus propios RL.
        // ─────────────────────────────────────────────────────────────
        apoderado: {
          type: "object",
          description: "Destinatario del poder. Si es persona jurídica (sociedad), incluye sus representantes legales designados para firmar la cancelación.",
          properties: {
            tipo: {
              type: "string",
              enum: ["natural", "juridica"],
              description: "'natural' = persona natural firma directamente. 'juridica' = sociedad apoderada con sus propios representantes (cadena de 3 niveles).",
            },
            // Caso natural
            nombre: { type: "string", description: "Si tipo='natural': nombre completo en MAYÚSCULAS." },
            cedula: { type: "string", description: "Si tipo='natural': cédula. Solo dígitos." },
            // Caso jurídica
            sociedad_razon_social: { type: "string", description: "Si tipo='juridica': razón social en MAYÚSCULAS. Ej: 'CONECTIVA GLOBAL S.A.S.'" },
            sociedad_nit: { type: "string", description: "Si tipo='juridica': NIT con DV. Ej: '900666582-8'." },
            sociedad_constitucion: { type: "string", description: "Si tipo='juridica': documento de constitución. Ej: 'Doc privado, CCB 21/10/2013 #01775236'. null si no aparece." },
            sociedad_reformas: { type: "string", description: "Si tipo='juridica': reformas relevantes (ej: razón social). Ej: 'Acta 3/2023 cambio de razón social'. null si no aplica." },
            representantes: {
              type: "array",
              description: "Si tipo='juridica': RLs y suplentes designados para firmar la cancelación. Cada uno es un objeto con nombre/cedula/cargo.",
              items: {
                type: "object",
                properties: {
                  nombre: { type: "string", description: "Nombre completo en MAYÚSCULAS." },
                  cedula: { type: "string", description: "Cédula. Solo dígitos." },
                  cargo: { type: "string", description: "Ej: 'REPRESENTANTE LEGAL', 'PRIMER SUPLENTE', 'GERENTE'." },
                  email: { type: "string", description: "Email si aparece. null si no." },
                  es_firmante: { type: "boolean", description: "true por defecto. El abogado puede desmarcar en la UI a los RLs que no firmarán la cancelación; el backend filtra el loop {#apoderado_representantes} para renderizar solo firmantes." },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },

        // ─────────────────────────────────────────────────────────────
        // Instrumento (la escritura pública del poder mismo).
        // ─────────────────────────────────────────────────────────────
        instrumento_poder: {
          type: "object",
          description: "Datos de la escritura pública que constituye el poder. Esta escritura es de UN nivel arriba en la cadena (el banco la otorgó; quien la firma a favor del banco es el notario).",
          properties: {
            escritura_num: { type: "string", description: "Número de escritura. Solo dígitos. Ej: '16390'." },
            fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD si se puede inferir. Ej: '2025-09-15'. null si solo aparece en letras y no es deducible." },
            fecha_texto: { type: "string", description: "Fecha tal como aparece en el documento, formato notarial libre. Ej: 'QUINCE (15) DE SEPTIEMBRE DE DOS MIL VEINTICINCO (2025)'." },
            notaria_numero: { type: "string", description: "Número de notaría. Solo dígitos. Ej: '29'." },
            notaria_ciudad: { type: "string", description: "Ciudad. MAYÚSCULAS. Ej: 'BOGOTA D.C.'." },
            notario_titular_nombre: { type: "string", description: "Nombre del notario titular. null si no aparece." },
            notario_encargado_nombre: { type: "string", description: "Si firma un encargado/interino, su nombre. null si no aplica." },
            resolucion_encargo: { type: "string", description: "Número/fecha de la resolución que designa al encargado. null si no aplica." },
          },
          additionalProperties: false,
        },

        // ─────────────────────────────────────────────────────────────
        // Facultades específicas para cancelación de hipoteca.
        // ─────────────────────────────────────────────────────────────
        facultades: {
          type: "object",
          description: "Facultades específicas que el poder confiere para el proceso de CANCELACIÓN DE HIPOTECA. Marcar true SOLO si aparece textualmente.",
          properties: {
            cancela_total: { type: "boolean", description: "Faculta para cancelar TOTALMENTE hipotecas." },
            cancela_parcial: { type: "boolean", description: "Faculta para cancelar PARCIALMENTE hipotecas." },
            cancela_hipotecas: { type: "boolean", description: "Mención genérica de 'cancelar hipotecas'." },
            libera_gravamenes: { type: "boolean", description: "Faculta para liberar/levantar gravámenes en general." },
            cancela_hipotecas_cedidas: { type: "boolean", description: "Faculta para cancelar hipotecas que el banco haya recibido por CESIÓN." },
            texto_literal: { type: "string", description: "Transcripción literal (máx 500 chars) de la cláusula de facultades. null si la página de facultades no es legible." },
          },
          additionalProperties: false,
        },

        // ─────────────────────────────────────────────────────────────
        // Vigencia y sustitución.
        // ─────────────────────────────────────────────────────────────
        vigencia: {
          type: "object",
          description: "Régimen de vigencia del poder.",
          properties: {
            tipo: {
              type: "string",
              enum: ["indefinida", "hasta_fecha", "hasta_terminacion_contrato"],
              description: "'indefinida' = no se fija plazo; 'hasta_fecha' = plazo cierto; 'hasta_terminacion_contrato' = atada a un contrato de mandato/prestación de servicios.",
            },
            fecha_limite: { type: "string", description: "Si tipo='hasta_fecha': fecha límite en YYYY-MM-DD. null en otros casos." },
            descripcion: { type: "string", description: "Descripción textual breve del régimen, si ayuda a clarificar." },
          },
          additionalProperties: false,
        },
        sustitucion_permitida: { type: "boolean", description: "true SOLO si el poder permite expresamente al apoderado SUSTITUIR el mandato en otra persona. Por defecto false (la prohibición es la regla notarial general)." },

        // ─────────────────────────────────────────────────────────────
        // Anexos referenciados (certificados, etc.).
        // ─────────────────────────────────────────────────────────────
        anexos: {
          type: "array",
          description: "Anexos mencionados o adjuntos al poder. Ej: certificados de Superfinanciera, Cámara de Comercio.",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string", description: "'superfinanciera' | 'camara_comercio' | 'otro'." },
              descripcion: { type: "string", description: "Texto breve identificando el anexo." },
              fecha: { type: "string", description: "Fecha del anexo en YYYY-MM-DD si está disponible." },
            },
            additionalProperties: false,
          },
        },
      },
      // Requeridos mínimos: el bloque legacy plano para no romper consumidores.
      required: ["entidad_bancaria", "apoderado_nombre", "apoderado_cedula"],
      additionalProperties: false,
    },
  },
};

export const poderBancoTools = [poderBancoTool];
export const PODER_BANCO_TOOL_NAME = "extract_poder_banco";

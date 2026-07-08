// ============================================================================
// poderBancoExtractor/tool.ts — Schema v6 ISOMÓRFICO del OCR de Poder Banco.
//
// Fuente única. Consumido por:
//   - edge `scan-document/core/poderBanco/tool.ts` (re-export)
//   - edge `procesar-cancelacion/index.ts` (extractor v6 dedicado)
//   - cliente (tipos / futura UI de edición avanzada)
//
// 🛡️ PUREZA: solo TS puro. No importa Deno, npm, ni infra. `confField` se
// inlinea aquí para no depender de `scan-document/shared/confFields.ts`.
// ============================================================================

const confField = (desc: string) => ({
  type: "object" as const,
  properties: {
    valor: { type: "string", description: desc },
    confianza: { type: "string", enum: ["alta", "media", "baja"], description: "Nivel de confianza" },
  },
  required: ["valor", "confianza"],
  additionalProperties: false,
});

export const PODER_BANCO_TOOL_NAME = "extract_poder_banco";

export const poderBancoTool = {
  type: "function" as const,
  function: {
    name: PODER_BANCO_TOOL_NAME,
    description:
      "Extrae datos del poder otorgado por una entidad bancaria. Devuelve schema profundo (poderdante → apoderado → instrumento → facultades → vigencia) Y campos planos legacy. Cada campo individual incluye nivel de confianza.",
    parameters: {
      type: "object",
      properties: {
        // ── Legacy plano (back-compat) ──────────────────────────────────
        entidad_bancaria: confField("Nombre de la entidad bancaria"),
        apoderado_nombre: confField("Nombre completo del apoderado del banco (persona natural firmante)"),
        apoderado_cedula: confField("Número de cédula del apoderado del banco. Si el número aparece pero está borroso/tachado/cortado y no puedes leerlo con certeza, devuelve exactamente 'NO_LEGIBLE' (no inventes dígitos plausibles)."),
        apoderado_expedida_en: confField("Lugar de expedición de la cédula del apoderado"),
        escritura_poder_num: confField("Número de la escritura pública del poder. Si aparece pero es ilegible, devuelve exactamente 'NO_LEGIBLE'."),
        fecha_poder: confField("Fecha de otorgamiento del poder (DD-MM-AAAA). Si aparece pero es ilegible, devuelve exactamente 'NO_LEGIBLE'."),
        notaria_poder: confField("Nombre o número de la notaría donde se otorgó el poder"),
        notaria_poder_ciudad: confField("Ciudad de la notaría donde se otorgó el poder"),
        apoderado_email: confField("Correo electrónico del apoderado, si aparece"),

        // ── Determinación cadena de representación (Regla K) ────────────
        has_apoderado_banco_v3: {
          type: "string",
          enum: ["true", "false", "null"],
          description:
            "Resultado del árbol de decisión K. 'true' = hay apoderado vía escritura de mandato; 'false' = el banco firma directo (RL de Superfinanciera); 'null' = AMBIGUO (página suelta, hoja de firmas sin cláusula). Aplicar el árbol descrito en el prompt — NO asumir 'false' por defecto.",
        },
        motivos_incompletitud: {
          type: "array",
          items: { type: "string" },
          description:
            "Códigos estables que explican por qué has_apoderado_banco_v3='null'. Ej: ['paginas_parciales_sin_clausula_de_poder', 'firma_aislada_sin_contexto']. Cadena vacía si la lectura es concluyente.",
        },

        // ── Poderdante (banco) ──────────────────────────────────────────
        poderdante: {
          type: "object",
          description:
            "Entidad bancaria que otorga el poder. Datos del certificado de existencia y representación de la Superintendencia Financiera, si aparece.",
          properties: {
            entidad_nombre: { type: "string", description: "Razón social completa en MAYÚSCULAS. Ej: 'BANCO DAVIVIENDA S.A.'" },
            entidad_nit: { type: "string", description: "NIT con DV en formato '900123456-7'. Sin puntos de miles. null si no es legible." },
            entidad_constitucion_escritura: { type: "string", description: "Escritura pública de constitución del banco, si aparece. Ej: '3892/1972 Notaría 14'. null si no aparece." },
            representante_legal_nombre: { type: "string", description: "Nombre completo del RL que firma EN NOMBRE del banco al otorgar este poder (NO confundir con el apoderado destinatario). null si no aparece." },
            representante_legal_cedula: { type: "string", description: "Cédula del RL del banco. Solo dígitos. null si no es legible." },
            representante_legal_cargo: { type: "string", description: "Cargo del firmante en el banco. Ej: 'SUPLENTE DEL PRESIDENTE'. null si no aparece." },
            representante_legal_cedula_expedida_en: { type: "string", description: "Ciudad de expedición de la cédula del RL del banco. Ej: 'BOGOTA D.C.'. null si no aparece." },
          },
          additionalProperties: false,
        },

        // ── Apoderado (destinatario) ────────────────────────────────────
        apoderado: {
          type: "object",
          description:
            "Destinatario del poder. Si es persona jurídica (sociedad), incluye sus representantes legales designados para firmar la cancelación.",
          properties: {
            tipo: {
              type: "string",
              enum: ["natural", "juridica"],
              description:
                "'natural' = persona natural firma directamente. 'juridica' = sociedad apoderada con sus propios representantes (cadena de 3 niveles).",
            },
            nombre: { type: "string", description: "Si tipo='natural': nombre completo en MAYÚSCULAS." },
            cedula: { type: "string", description: "Si tipo='natural': cédula. Solo dígitos." },
            sociedad_razon_social: { type: "string", description: "Si tipo='juridica': razón social en MAYÚSCULAS. Ej: 'CONECTIVA GLOBAL S.A.S.'" },
            sociedad_nit: { type: "string", description: "Si tipo='juridica': NIT con DV. Ej: '900666582-8'." },
            sociedad_constitucion: {
              type: "object",
              description:
                "Si tipo='juridica': datos de constitución de la sociedad apoderada. Requerido para probar el tracto sucesivo ante la ORIP.",
              properties: {
                tipo_documento: { type: "string", enum: ["documento_privado", "escritura_publica"], description: "Naturaleza del acto de constitución." },
                numero: { type: "string", description: "Número del documento/escritura de constitución. Solo dígitos si es escritura. null si no aparece." },
                fecha: { type: "string", description: "Fecha de constitución en YYYY-MM-DD. null si solo hay letras no deducibles." },
                fecha_texto: { type: "string", description: "Fecha literal como aparece en el documento. Ej: 'DIECIOCHO (18) DE OCTUBRE DE DOS MIL TRECE (2013)'." },
                camara_comercio_ciudad: { type: "string", description: "Ciudad de la Cámara de Comercio donde se inscribió. MAYÚSCULAS. Ej: 'BOGOTA'." },
                camara_comercio_fecha: { type: "string", description: "Fecha de inscripción en la Cámara en YYYY-MM-DD. null si no aparece." },
                camara_comercio_numero: { type: "string", description: "Número de inscripción en la Cámara. Ej: '01775236'." },
                libro: { type: "string", description: "Libro del registro mercantil. Ej: 'IX'." },
                razon_social_anterior: { type: "string", description: "Razón social previa si hubo cambio (ej: 'PROYECTOS LEGALES S.A.S.'). null si no aplica." },
                reforma_acta_numero: { type: "string", description: "Número del acta de reforma que cambió la razón social. null si no aplica." },
                reforma_acta_fecha_texto: { type: "string", description: "Fecha literal del acta de reforma. null si no aplica." },
                reforma_camara_fecha_texto: { type: "string", description: "Fecha literal de inscripción en Cámara del acta de reforma. null si no aplica." },
              },
              additionalProperties: false,
            },
            sociedad_reformas: { type: "string", description: "Si tipo='juridica': reformas relevantes (ej: razón social). null si no aplica." },
            representantes: {
              type: "array",
              description: "Si tipo='juridica': RLs y suplentes designados para firmar la cancelación.",
              items: {
                type: "object",
                properties: {
                  nombre: { type: "string", description: "Nombre completo en MAYÚSCULAS." },
                  cedula: { type: "string", description: "Cédula. Solo dígitos." },
                  cargo: { type: "string", description: "Ej: 'REPRESENTANTE LEGAL', 'PRIMER SUPLENTE', 'GERENTE'." },
                  email: { type: "string", description: "Email si aparece. null si no." },
                  es_firmante: { type: "boolean", description: "true por defecto. El abogado desmarca en la UI quienes NO firmarán." },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },

        // ── Instrumento poder ───────────────────────────────────────────
        instrumento_poder: {
          type: "object",
          description: "Datos de la escritura pública que constituye el poder.",
          properties: {
            escritura_num: { type: "string", description: "Número de escritura. Solo dígitos. Ej: '16390'." },
            fecha: { type: "string", description: "Fecha en formato YYYY-MM-DD si se puede inferir." },
            fecha_texto: { type: "string", description: "Fecha tal como aparece, formato notarial libre." },
            notaria_numero: { type: "string", description: "Número de notaría. Solo dígitos." },
            notaria_ciudad: { type: "string", description: "Ciudad. MAYÚSCULAS." },
            notario_titular_nombre: { type: "string", description: "Nombre del notario titular. null si no aparece." },
            notario_encargado_nombre: { type: "string", description: "Si firma un encargado/interino, su nombre. null si no aplica." },
            resolucion_encargo: { type: "string", description: "Número/fecha de la resolución que designa al encargado. null si no aplica." },
          },
          additionalProperties: false,
        },

        // ── Facultades ──────────────────────────────────────────────────
        facultades: {
          type: "object",
          description: "Facultades específicas para CANCELACIÓN DE HIPOTECA. Marcar true SOLO si aparece textualmente.",
          properties: {
            cancela_total: { type: "boolean" },
            cancela_parcial: { type: "boolean" },
            cancela_hipotecas: { type: "boolean" },
            libera_gravamenes: { type: "boolean" },
            cancela_hipotecas_cedidas: { type: "boolean" },
            texto_literal: { type: "string", description: "Transcripción literal (máx 500 chars) de la cláusula de facultades." },
          },
          additionalProperties: false,
        },

        // ── Vigencia ────────────────────────────────────────────────────
        vigencia: {
          type: "object",
          description: "Régimen de vigencia del poder.",
          properties: {
            tipo: {
              type: "string",
              enum: ["indefinida", "hasta_fecha", "hasta_terminacion_contrato"],
            },
            fecha_limite: { type: "string" },
            descripcion: { type: "string" },
          },
          additionalProperties: false,
        },
        sustitucion_permitida: { type: "boolean", description: "true SOLO si permite expresamente sustituir el mandato." },

        // ── Anexos ──────────────────────────────────────────────────────
        anexos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tipo: { type: "string" },
              descripcion: { type: "string" },
              fecha: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      required: ["entidad_bancaria", "apoderado_nombre", "apoderado_cedula"],
      additionalProperties: false,
    },
  },
};

export const poderBancoTools = [poderBancoTool];

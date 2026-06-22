// Tool schema for OCR of Colombian "certificado de tradición y libertad".
// Verbatim from legacy scan-document/index.ts (toolsByCertificado).
// Houses the "índice más alto" rule inside inmueble.direccion.description.

import { confBoolField, confField } from "../../shared/confFields.ts";

export const certificadoTradicionTool = {
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
            direccion: confField("Dirección OFICIAL VIGENTE del inmueble en formato notarial colombiano TEXTO (NÚMERO). SELECCIÓN: si el bloque 'DIRECCION DEL INMUEBLE/PREDIO' lista nomenclaturas numeradas (1), 2), 3)…), tomar SIEMPRE la del ÍNDICE MÁS ALTO (es la vigente de Catastro/ORIP); ignorar las anteriores. FORMATO: vías y números en letras seguidos del dígito entre paréntesis; sufijos cardinales SUR/NORTE/ESTE/OESTE preservados en MAYÚSCULAS; SEPARADOR DE PLACA: se conserva como el SÍMBOLO '-' (guion ASCII rodeado de espacios), NUNCA se verbaliza como la palabra 'GUION'; sufijos alfabéticos pegados al número (62A, 53B) escritos como 'SESENTA Y DOS A', 'CINCUENTA Y TRES B' (NUNCA 'ALFA'/'BETA'/'BIS' inventado). Ej: 'CL 59 SUR 60 84 TO 5 AP 501' → 'CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84) TORRE CINCO (5) APARTAMENTO QUINIENTOS UNO (501)'. NO incluir nombre del conjunto/edificio, ni ciudad/municipio, ni la coletilla '(DIRECCION CATASTRAL)'."),
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
};

export const certificadoTradicionTools = [certificadoTradicionTool];
export const CERTIFICADO_TRADICION_TOOL_NAME = "extract_certificado_tradicion";

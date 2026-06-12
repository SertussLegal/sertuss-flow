// Tool schema for OCR of an antecedent public deed. Verbatim from legacy
// scan-document/index.ts (toolsByEscritura).

import { confField } from "../../shared/confFields.ts";

export const escrituraAntecedenteTool = {
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
};

export const escrituraAntecedenteTools = [escrituraAntecedenteTool];
export const ESCRITURA_ANTECEDENTE_TOOL_NAME = "extract_escritura_antecedente";

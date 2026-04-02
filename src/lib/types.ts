export interface Organization {
  id: string;
  name: string;
  nit: string | null;
  address: string | null;
  credit_balance: number;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  organization_id: string | null;
  role: "owner" | "admin" | "operator";
  created_at: string;
}

export interface ActivityLog {
  id: string;
  organization_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: "owner" | "admin" | "operator";
  invited_by: string;
  accepted_at: string | null;
  created_at: string;
}

export interface Persona {
  id: string;
  nombre_completo: string;
  numero_cedula: string;
  estado_civil: string;
  direccion: string;
  municipio_domicilio: string;
  es_persona_juridica: boolean;
  razon_social: string;
  nit: string;
  representante_legal_nombre: string;
  representante_legal_cedula: string;
  es_pep: boolean;
  actua_mediante_apoderado: boolean;
  apoderado_persona_nombre: string;
  apoderado_persona_cedula: string;
  apoderado_persona_municipio: string;
  lugar_expedicion?: string;
}

export interface Inmueble {
  matricula_inmobiliaria: string;
  tipo_identificador_predial: "chip" | "cedula_catastral";
  identificador_predial: string;
  departamento: string;
  municipio: string;
  codigo_orip: string;
  tipo_predio: "urbano" | "rural";
  direccion: string;
  area: string;
  area_construida: string;
  area_privada: string;
  linderos: string;
  avaluo_catastral: string;
  escritura_ph: string;
  reformas_ph: string;
  es_propiedad_horizontal: boolean;
  matricula_matriz?: string;
  nupre?: string;
  estrato?: string;
  valorizacion?: string;
}

export interface Actos {
  tipo_acto: string;
  valor_compraventa: string;
  es_hipoteca: boolean;
  valor_hipoteca: string;
  entidad_bancaria: string;
  apoderado_nombre: string;
  apoderado_cedula: string;
  apoderado_expedida_en?: string;
  apoderado_escritura_poder?: string;
  apoderado_fecha_poder?: string;
  apoderado_notaria_poder?: string;
  apoderado_notaria_ciudad?: string;
  apoderado_email?: string;
  pago_inicial?: string;
  saldo_financiado?: string;
  fecha_credito?: string;
  entidad_nit?: string;
  entidad_domicilio?: string;
}

export interface Tramite {
  id: string;
  radicado: string;
  tipo: string;
  fecha: string;
  status: "pendiente" | "validado" | "word_generado";
  vendedores: Persona[];
  compradores: Persona[];
  inmueble: Inmueble;
  actos: Actos;
}

// Confidence level for AI-extracted fields
export type NivelConfianza = "alta" | "media" | "baja";

export interface ConfianzaField {
  valor: string;
  confianza: NivelConfianza;
}

export interface ConfianzaBoolField {
  valor: boolean;
  confianza: NivelConfianza;
}

export interface LogExtraccion {
  id: string;
  tramite_id: string;
  data_ia: Record<string, unknown>;
  data_final: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export const createEmptyPersona = (): Persona => ({
  id: crypto.randomUUID(),
  nombre_completo: "",
  numero_cedula: "",
  estado_civil: "",
  direccion: "",
  municipio_domicilio: "",
  es_persona_juridica: false,
  razon_social: "",
  nit: "",
  representante_legal_nombre: "",
  representante_legal_cedula: "",
  es_pep: false,
  actua_mediante_apoderado: false,
  apoderado_persona_nombre: "",
  apoderado_persona_cedula: "",
  apoderado_persona_municipio: "",
  lugar_expedicion: "",
});

export const createEmptyInmueble = (): Inmueble => ({
  matricula_inmobiliaria: "",
  tipo_identificador_predial: "chip",
  identificador_predial: "",
  departamento: "",
  municipio: "",
  codigo_orip: "",
  tipo_predio: "urbano",
  direccion: "",
  area: "",
  area_construida: "",
  area_privada: "",
  linderos: "",
  avaluo_catastral: "",
  escritura_ph: "",
  reformas_ph: "",
  es_propiedad_horizontal: false,
});

export const createEmptyActos = (): Actos => ({
  tipo_acto: "",
  valor_compraventa: "",
  es_hipoteca: false,
  valor_hipoteca: "",
  entidad_bancaria: "",
  apoderado_nombre: "",
  apoderado_cedula: "",
  apoderado_expedida_en: "",
  apoderado_escritura_poder: "",
  apoderado_fecha_poder: "",
  apoderado_notaria_poder: "",
  apoderado_notaria_ciudad: "",
  apoderado_email: "",
  pago_inicial: "",
  saldo_financiado: "",
  fecha_credito: "",
  entidad_nit: "",
  entidad_domicilio: "",
});

export interface NotariaStyle {
  id: string;
  organization_id: string;
  nombre_notaria: string;
  ciudad: string;
  estilo_linderos: string;
  notario_titular: string;
  clausulas_personalizadas: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CustomVariable {
  id: string;
  originalText: string;
  variableName: string;
  value: string;
}

export interface SugerenciaIA {
  tipo: "discrepancia" | "estilo";
  texto_original: string;
  texto_sugerido: string;
  mensaje: string;
  campo?: string;
}

export interface ResultadoEditorPro {
  texto_final_word: string;
  sugerencias_ia: SugerenciaIA[];
}

// Helper to unwrap confidence fields from AI response
export function unwrapConfianza(
  field: ConfianzaField | string | undefined
): { valor: string; confianza: NivelConfianza } {
  if (!field) return { valor: "", confianza: "alta" };
  if (typeof field === "string") return { valor: field, confianza: "alta" };
  return { valor: field.valor || "", confianza: field.confianza || "alta" };
}

export function unwrapConfianzaBool(
  field: ConfianzaBoolField | boolean | undefined
): { valor: boolean; confianza: NivelConfianza } {
  if (field == null) return { valor: false, confianza: "alta" };
  if (typeof field === "boolean") return { valor: field, confianza: "alta" };
  return { valor: !!field.valor, confianza: field.confianza || "alta" };
}

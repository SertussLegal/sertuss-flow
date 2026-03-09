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
  estrato: string;
  area: string;
  linderos: string;
  valorizacion: string;
  avaluo_catastral: string;
  escritura_ph: string;
  reformas_ph: string;
}

export interface Actos {
  tipo_acto: string;
  valor_compraventa: string;
  es_hipoteca: boolean;
  valor_hipoteca: string;
  entidad_bancaria: string;
  apoderado_nombre: string;
  apoderado_cedula: string;
  afectacion_vivienda_familiar: boolean;
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
  estrato: "",
  area: "",
  linderos: "",
  valorizacion: "",
  avaluo_catastral: "",
  escritura_ph: "",
  reformas_ph: "",
});

export const createEmptyActos = (): Actos => ({
  tipo_acto: "",
  valor_compraventa: "",
  es_hipoteca: false,
  valor_hipoteca: "",
  entidad_bancaria: "",
  apoderado_nombre: "",
  apoderado_cedula: "",
  afectacion_vivienda_familiar: false,
});

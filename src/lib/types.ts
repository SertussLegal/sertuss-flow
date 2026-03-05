export interface Persona {
  id: string;
  nombre_completo: string;
  numero_cedula: string;
  estado_civil: string;
  direccion: string;
  es_persona_juridica: boolean;
  razon_social: string;
  nit: string;
  representante_legal_nombre: string;
  representante_legal_cedula: string;
  es_pep: boolean;
}

export interface Inmueble {
  matricula_inmobiliaria: string;
  tipo_identificador_predial: "chip" | "predial_nacional";
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
  es_persona_juridica: false,
  razon_social: "",
  nit: "",
  representante_legal_nombre: "",
  representante_legal_cedula: "",
  es_pep: false,
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

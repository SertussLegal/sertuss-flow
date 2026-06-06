/**
 * docxFieldMap — Mapa declarativo único de tags de la plantilla Word.
 *
 * ⚠️ REGLA DE ORDEN:
 * Cualquier tag nuevo añadido a una plantilla `.docx` debe registrarse aquí
 * PRIMERO. Si no figura, no será resuelto por `getConsolidatedDocxData` y
 * `DocxPreview` mostrará "___________". A medida que se sumen nuevos actos
 * notariales (Sucesiones, Divorcios, Cancelación de Hipoteca, etc.) este
 * mapa centraliza los alias y mantiene una única fuente de verdad entre el
 * visor en pantalla y el archivo descargado.
 *
 * El mapa NO ejecuta lógica: solo declara qué claves del modelo consolidado
 * resuelven cada tag. La resolución real ocurre en `docxConsolidation.ts`.
 */

export interface DocxFieldDescriptor {
  /** Tag tal como aparece en la plantilla, sin llaves: "matricula_inmobiliaria". */
  tag: string;
  /** Otras claves que deben resolverse al mismo valor (root + nested). */
  aliases: string[];
  /** Categoría para el reporte de cobertura. */
  group:
    | "notaria"
    | "inmueble"
    | "actos"
    | "personas"
    | "antecedentes"
    | "rph"
    | "apoderado_banco"
    | "flags"
    | "audit"
    | "other";
  /** Si `true`, ausencia bloquea el render con un modal preventivo (ver `docxCriticalFields`). */
  critical?: boolean;
  /** Descripción para el log de cobertura. */
  description?: string;
}

/**
 * Catálogo declarativo. Mantener ordenado por grupo para facilitar
 * la inspección manual.
 */
export const DOCX_FIELD_MAP: ReadonlyArray<DocxFieldDescriptor> = [
  // ── Notaría del trámite ────────────────────────────────────────
  { tag: "notaria_numero", aliases: [], group: "notaria" },
  { tag: "notaria_numero_letras", aliases: [], group: "notaria" },
  { tag: "notaria_numero_letras_lower", aliases: [], group: "notaria" },
  { tag: "notaria_numero_letras_femenino", aliases: [], group: "notaria" },
  { tag: "notaria_ordinal", aliases: [], group: "notaria" },
  { tag: "notaria_circulo", aliases: [], group: "notaria" },
  { tag: "notaria_circulo_proper", aliases: [], group: "notaria" },
  { tag: "notaria_departamento", aliases: [], group: "notaria" },
  { tag: "notario_nombre", aliases: [], group: "notaria" },
  { tag: "notario_decreto", aliases: [], group: "notaria" },
  { tag: "notario_tipo", aliases: [], group: "notaria" },
  { tag: "escritura_numero", aliases: [], group: "notaria" },
  { tag: "fecha_escritura_corta", aliases: [], group: "notaria" },

  // ── Inmueble (root + nested) ───────────────────────────────────
  {
    tag: "matricula_inmobiliaria",
    aliases: [
      "matricula",
      "inmueble.matricula",
      "inmueble.matricula_inmobiliaria",
    ],
    group: "inmueble",
    critical: true,
  },
  {
    tag: "cedula_catastral",
    aliases: [
      "chip",
      "identificador_predial",
      "inmueble.cedula_catastral",
      "inmueble.chip",
    ],
    group: "inmueble",
    critical: true,
  },
  {
    tag: "direccion_inmueble",
    aliases: [
      "inmueble.direccion",
      "inmueble.ubicacion",
      "ubicacion_inmueble",
      "ubicacion_predio",
    ],
    group: "inmueble",
    critical: true,
  },
  {
    tag: "nombre_edificio_conjunto",
    aliases: ["inmueble.nombre_edificio_conjunto", "inmueble_nombre"],
    group: "inmueble",
  },
  { tag: "linderos_especiales", aliases: ["inmueble.linderos_especiales"], group: "inmueble" },
  { tag: "linderos_generales", aliases: ["inmueble.linderos_generales"], group: "inmueble" },
  { tag: "coeficiente_letras", aliases: ["inmueble.coeficiente_letras"], group: "inmueble" },
  { tag: "coeficiente_numero", aliases: ["inmueble.coeficiente_numero", "coeficiente_copropiedad"], group: "inmueble" },
  { tag: "municipio_inmueble", aliases: ["inmueble.municipio"], group: "inmueble" },
  { tag: "departamento_inmueble", aliases: ["inmueble.departamento"], group: "inmueble" },
  { tag: "orip_ciudad", aliases: ["inmueble.orip_ciudad"], group: "inmueble" },
  { tag: "inmueble.orip_zona", aliases: [], group: "inmueble" },
  { tag: "inmueble.predial_anio", aliases: [], group: "inmueble" },
  { tag: "inmueble.predial_num", aliases: [], group: "inmueble" },
  { tag: "inmueble.predial_valor", aliases: [], group: "inmueble" },
  { tag: "inmueble.idu_num", aliases: [], group: "inmueble" },
  { tag: "inmueble.idu_fecha", aliases: [], group: "inmueble" },
  { tag: "inmueble.idu_vigencia", aliases: [], group: "inmueble" },
  { tag: "inmueble.admin_fecha", aliases: [], group: "inmueble" },
  { tag: "inmueble.admin_vigencia", aliases: [], group: "inmueble" },
  { tag: "inmueble.es_rph", aliases: [], group: "inmueble" },
  { tag: "inmueble.estrato", aliases: ["estrato"], group: "inmueble" },
  { tag: "inmueble.nupre", aliases: ["nupre"], group: "inmueble" },

  // ── Actos / Compraventa / Hipoteca ─────────────────────────────
  { tag: "actos.cuantia_compraventa_letras", aliases: ["valor_compraventa_letras"], group: "actos", critical: true },
  { tag: "actos.cuantia_compraventa_numero", aliases: [], group: "actos", critical: true },
  { tag: "actos.cuantia_hipoteca_letras", aliases: ["valor_hipoteca_letras"], group: "actos" },
  { tag: "actos.cuantia_hipoteca_numero", aliases: [], group: "actos" },
  {
    tag: "actos.entidad_bancaria",
    aliases: ["entidad_bancaria", "banco_nombre"],
    group: "actos",
  },
  { tag: "actos.entidad_nit", aliases: ["banco_nit", "entidad_nit"], group: "actos" },
  { tag: "actos.entidad_domicilio", aliases: ["entidad_domicilio"], group: "actos" },
  { tag: "actos.pago_inicial_letras", aliases: [], group: "actos" },
  { tag: "actos.pago_inicial_numero", aliases: [], group: "actos" },
  { tag: "actos.saldo_financiado_letras", aliases: [], group: "actos" },
  { tag: "actos.saldo_financiado_numero", aliases: [], group: "actos" },
  { tag: "actos.fecha_escritura_letras", aliases: [], group: "actos" },
  { tag: "actos.credito_dia_letras", aliases: [], group: "actos" },
  { tag: "actos.credito_dia_num", aliases: [], group: "actos" },
  { tag: "actos.credito_mes", aliases: [], group: "actos" },
  { tag: "actos.credito_anio_letras", aliases: [], group: "actos" },
  { tag: "actos.credito_anio_num", aliases: [], group: "actos" },
  { tag: "actos.afectacion_vivienda", aliases: ["afectacion_vivienda"], group: "actos" },
  { tag: "actos.redam_resultado", aliases: [], group: "actos" },

  // ── Personas (loops {#vendedores}/{#compradores}) ──────────────
  { tag: "vendedores", aliases: [], group: "personas", critical: true },
  { tag: "compradores", aliases: [], group: "personas", critical: true },
  { tag: "nombre", aliases: [], group: "personas" },
  { tag: "cedula", aliases: [], group: "personas" },
  { tag: "expedida_en", aliases: [], group: "personas" },
  { tag: "estado_civil", aliases: [], group: "personas" },
  { tag: "domicilio", aliases: [], group: "personas" },
  { tag: "direccion_residencia", aliases: [], group: "personas" },
  { tag: "telefono", aliases: [], group: "personas" },
  { tag: "actividad_economica", aliases: [], group: "personas" },
  { tag: "email", aliases: [], group: "personas" },
  { tag: "es_pep", aliases: [], group: "personas" },
  { tag: "acepta_notificaciones", aliases: [], group: "personas" },

  // ── Antecedentes (escritura previa) ────────────────────────────
  { tag: "antecedentes.modo", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.adquirido_de", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_num_letras", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_num_numero", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_dia_letras", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_dia_num", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_mes", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_anio_letras", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.escritura_anio_num", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.notaria_previa_numero", aliases: [], group: "antecedentes" },
  { tag: "antecedentes.notaria_previa_circulo", aliases: [], group: "antecedentes" },

  // ── RPH ────────────────────────────────────────────────────────
  { tag: "rph.escritura_num_letras", aliases: [], group: "rph" },
  { tag: "rph.escritura_num_numero", aliases: [], group: "rph" },
  { tag: "rph.escritura_dia_letras", aliases: [], group: "rph" },
  { tag: "rph.escritura_dia_num", aliases: [], group: "rph" },
  { tag: "rph.escritura_mes", aliases: [], group: "rph" },
  { tag: "rph.escritura_anio_letras", aliases: [], group: "rph" },
  { tag: "rph.escritura_anio_num", aliases: [], group: "rph" },
  { tag: "rph.notaria_numero", aliases: [], group: "rph" },
  { tag: "rph.notaria_ciudad", aliases: [], group: "rph" },
  { tag: "rph.matricula_matriz", aliases: [], group: "rph" },

  // ── Apoderado banco ────────────────────────────────────────────
  { tag: "apoderado_banco.nombre", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.cedula", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.expedida_en", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.escritura_poder_num", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.poder_dia_letras", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.poder_dia_num", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.poder_mes", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.poder_anio_letras", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.poder_anio_num", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.notaria_poder_num", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.notaria_poder_ciudad", aliases: [], group: "apoderado_banco" },
  { tag: "apoderado_banco.email", aliases: [], group: "apoderado_banco" },

  // ── Flags booleanos ────────────────────────────────────────────
  { tag: "tiene_hipoteca", aliases: ["has_hipoteca"], group: "flags" },
  { tag: "has_credito", aliases: [], group: "flags" },
  { tag: "has_apoderado_banco", aliases: [], group: "flags" },
  { tag: "has_antecedente", aliases: [], group: "flags" },
  { tag: "has_afectacion_familiar", aliases: [], group: "flags" },
  { tag: "has_predial", aliases: [], group: "flags" },
  { tag: "has_coeficiente", aliases: [], group: "flags" },
  { tag: "has_carta_credito", aliases: [], group: "flags" },
  { tag: "has_ph", aliases: [], group: "flags" },
  { tag: "has_linderos", aliases: [], group: "flags" },
  { tag: "has_linderos_especiales", aliases: [], group: "flags" },
  { tag: "has_linderos_generales", aliases: [], group: "flags" },
];

/** Conjunto plano con todos los tags + aliases para lookup O(1). */
export const ALL_KNOWN_KEYS: ReadonlySet<string> = new Set(
  DOCX_FIELD_MAP.flatMap((d) => [d.tag, ...d.aliases]),
);

/**
 * Reporte de cobertura para desarrollo. Compara la lista de tags extraídos
 * de la plantilla con los registrados aquí. NO falla el build; solo loggea.
 */
export function reportTagCoverage(templateTags: string[]): void {
  if (!import.meta.env.DEV) return;
  if (typeof console === "undefined") return;
  const known = ALL_KNOWN_KEYS;
  const total = templateTags.length;
  const resolved = templateTags.filter((t) => known.has(t));
  const orphan = templateTags.filter((t) => !known.has(t));
  const pct = total > 0 ? Math.round((resolved.length / total) * 1000) / 10 : 100;
  /* eslint-disable no-console */
  console.groupCollapsed(
    `%c[Sertuss DocxFieldMap] Cobertura: ${pct}% (${resolved.length}/${total})`,
    "color:#E4B800;font-weight:bold;",
  );
  if (orphan.length > 0) {
    console.warn(
      `Tags sin resolver (registra en docxFieldMap.ts si son nuevos):`,
      orphan,
    );
  } else {
    console.log("Todos los tags de la plantilla están registrados.");
  }
  console.groupEnd();
  /* eslint-enable no-console */
}

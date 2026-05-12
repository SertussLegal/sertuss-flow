/**
 * docxCriticalFields — Verificación preventiva de datos mínimos antes de
 * generar el `.docx`. NO bloquea el flujo: levanta un modal informativo
 * para que el usuario decida continuar o volver a editar.
 */

const PLACEHOLDER = "___________";

export interface CriticalFieldDescriptor {
  /** Path con notación de puntos (ej. "inmueble.matricula"). */
  path: string;
  /** Etiqueta legible para mostrar al usuario. */
  label: string;
  /** Si es array, basta con que UN elemento tenga la sub-clave. */
  sub?: string;
}

export interface MissingCriticalField {
  path: string;
  label: string;
}

/**
 * Catálogo por tipo de acto. Crece a medida que se sumen nuevos actos.
 * "_default" cubre cualquier `tipo_acto` no enumerado.
 */
export const CRITICAL_FIELDS_BY_ACTO: Record<string, CriticalFieldDescriptor[]> = {
  _default: [
    { path: "matricula_inmobiliaria", label: "Matrícula Inmobiliaria" },
    { path: "cedula_catastral", label: "Cédula Catastral / CHIP" },
    { path: "direccion_inmueble", label: "Dirección del inmueble" },
    { path: "actos.cuantia_compraventa_numero", label: "Valor de compraventa" },
    { path: "vendedores", label: "Vendedores (nombre)", sub: "nombre" },
    { path: "compradores", label: "Compradores (nombre)", sub: "nombre" },
    { path: "vendedores", label: "Vendedores (cédula)", sub: "cedula" },
    { path: "compradores", label: "Compradores (cédula)", sub: "cedula" },
  ],
  Hipoteca: [
    { path: "actos.entidad_bancaria", label: "Entidad bancaria" },
    { path: "actos.entidad_nit", label: "NIT del banco" },
    { path: "actos.cuantia_hipoteca_numero", label: "Valor de hipoteca" },
  ],
  "Compraventa con Hipoteca": [
    { path: "actos.entidad_bancaria", label: "Entidad bancaria" },
    { path: "actos.entidad_nit", label: "NIT del banco" },
    { path: "actos.cuantia_hipoteca_numero", label: "Valor de hipoteca" },
  ],
};

function readPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = data;
  for (const p of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const t = v.trim();
    return !t || t === PLACEHOLDER;
  }
  if (typeof v === "boolean" || typeof v === "number") return false;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

/**
 * Devuelve la lista de campos críticos vacíos. Si está vacía, el usuario
 * puede generar el Word sin advertencia.
 */
export function checkCriticalEmpty(
  data: Record<string, unknown>,
  tipoActo: string,
): MissingCriticalField[] {
  const base = CRITICAL_FIELDS_BY_ACTO._default;
  const extra =
    CRITICAL_FIELDS_BY_ACTO[tipoActo] ??
    Object.entries(CRITICAL_FIELDS_BY_ACTO).find(([k]) =>
      tipoActo?.toLowerCase().includes(k.toLowerCase()) && k !== "_default",
    )?.[1] ??
    [];
  const checks = [...base, ...extra];

  const missing: MissingCriticalField[] = [];
  for (const c of checks) {
    const v = readPath(data, c.path);
    if (c.sub) {
      // Array of objects: cada item debe tener la sub-clave.
      if (!Array.isArray(v) || v.length === 0) {
        missing.push({ path: c.path, label: c.label });
        continue;
      }
      const allEmpty = v.every((item) => isEmpty((item as Record<string, unknown>)?.[c.sub!]));
      if (allEmpty) missing.push({ path: `${c.path}[].${c.sub}`, label: c.label });
    } else if (isEmpty(v)) {
      missing.push({ path: c.path, label: c.label });
    }
  }
  return missing;
}

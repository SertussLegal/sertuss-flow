// _patterns.ts — Fase 2 · Paso B (agrupación determinista)
//
// Compara data_ia vs data_final por trámite, clasifica diferencias y agrupa
// por (campoRaiz, tipo) contando frecuencia por trámites distintos.
// Claude NO cuenta ni detecta patrones — solo redacta sobre lo que llegue aquí.

export type DiffTipo =
  | "solo_ia_vacio"
  | "solo_final_vacio"
  | "valor_distinto"
  | "formato_normalizado"
  | "booleano_flip";

export interface Diff {
  tramiteId: string;
  campo: string;                    // dot-path: "personas[0].lugar_expedicion"
  campoRaiz: string;                // "lugar_expedicion"
  tipo: DiffTipo;
  valorIA: unknown;
  valorFinal: unknown;
  contexto: Record<string, unknown>;
}

export interface Pattern {
  campoRaiz: string;
  tipo: DiffTipo;
  frecuencia: number;
  evidencia: Array<{
    tramiteId: string;
    valorIA: unknown;
    valorFinal: unknown;
    contexto: Record<string, unknown>;
  }>;
}

// Whitelist: por cada campoRaiz, qué "hermanos" acompañan al valor en el
// payload que se envía a Claude. Sin nombres, cédulas, teléfonos ni valores
// monetarios ajenos al campo del patrón.
const CONTEXT_WHITELIST: Record<string, string[]> = {
  lugar_expedicion: ["municipio_domicilio", "tipo_identificacion"],
  matricula_inmobiliaria: ["departamento", "municipio", "tipo_predio"],
  identificador_predial: ["municipio", "tipo_identificador_predial"],
  tipo_identificador_predial: ["municipio"],
  valor_hipoteca: ["es_hipoteca", "entidad_bancaria"],
  es_hipoteca: ["entidad_bancaria"],
  entidad_nit: ["entidad_bancaria"],
  entidad_domicilio: ["entidad_bancaria"],
  representante_legal_nombre: ["es_persona_juridica", "razon_social"],
  representante_legal_cedula: ["es_persona_juridica", "razon_social"],
  estado_civil: [],
  actividad_economica: ["es_persona_juridica"],
  es_propiedad_horizontal: ["tipo_predio"],
  escritura_ph_notaria: ["es_propiedad_horizontal"],
  coeficiente_copropiedad: ["es_propiedad_horizontal"],
  afectacion_vivienda_familiar: ["estado_civil"],
  apoderado_persona_cedula: ["actua_mediante_apoderado"],
  apoderado_persona_nombre: ["actua_mediante_apoderado"],
  tipo_acto: [],
  valor_compraventa: [],
};

const isEmpty = (v: unknown): boolean =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

const normalize = (v: unknown): string =>
  String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[-_.]/g, "");

function classifyDiff(vi: unknown, vf: unknown): DiffTipo | null {
  const eIA = isEmpty(vi);
  const eF = isEmpty(vf);
  if (eIA && eF) return null;
  if (eIA && !eF) return "solo_ia_vacio";
  if (!eIA && eF) return "solo_final_vacio";
  if (typeof vi === "boolean" && typeof vf === "boolean") {
    return vi !== vf ? "booleano_flip" : null;
  }
  if (String(vi) === String(vf)) return null;
  if (normalize(vi) === normalize(vf)) return "formato_normalizado";
  return "valor_distinto";
}

// Extrae campoRaiz de un path tipo "personas[0].lugar_expedicion" → "lugar_expedicion"
function rootField(path: string): string {
  const parts = path.split(".");
  return parts[parts.length - 1];
}

function parentPath(path: string): string[] {
  const parts = path.split(".");
  return parts.slice(0, -1);
}

// Recorrido acotado: solo los shapes que conocemos del dominio (personas[],
// inmueble, actos, inmuebles[]). No entramos a objetos anidados desconocidos.
function enumerateFieldPaths(dataIA: any, dataFinal: any): string[] {
  const paths = new Set<string>();

  // Objetos escalares raíz conocidos
  const singleObjects = ["inmueble", "actos"];
  for (const root of singleObjects) {
    const combined = { ...(dataIA?.[root] ?? {}), ...(dataFinal?.[root] ?? {}) };
    for (const k of Object.keys(combined)) {
      if (typeof combined[k] === "object" && combined[k] !== null && !Array.isArray(combined[k])) continue;
      paths.add(`${root}.${k}`);
    }
  }

  // Arrays de personas / inmuebles (pareamos por índice, es lo que hay)
  const arrayRoots = ["personas", "vendedores", "compradores", "inmuebles"];
  for (const root of arrayRoots) {
    const arrIA = Array.isArray(dataIA?.[root]) ? dataIA[root] : [];
    const arrF = Array.isArray(dataFinal?.[root]) ? dataFinal[root] : [];
    const maxLen = Math.max(arrIA.length, arrF.length);
    for (let i = 0; i < maxLen; i++) {
      const combined = { ...(arrIA[i] ?? {}), ...(arrF[i] ?? {}) };
      for (const k of Object.keys(combined)) {
        if (typeof combined[k] === "object" && combined[k] !== null && !Array.isArray(combined[k])) continue;
        paths.add(`${root}[${i}].${k}`);
      }
    }
  }

  return Array.from(paths);
}

function getPath(obj: any, path: string): unknown {
  if (!obj) return undefined;
  const tokens = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: any = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}

function extractContext(dataFinal: any, path: string): Record<string, unknown> {
  const root = rootField(path);
  const siblings = CONTEXT_WHITELIST[root];
  if (!siblings) return {};
  const parent = parentPath(path).join(".");
  const ctx: Record<string, unknown> = {};
  for (const s of siblings) {
    const p = parent ? `${parent}.${s}` : s;
    const v = getPath(dataFinal, p);
    if (v !== undefined) ctx[s] = v;
  }
  return ctx;
}

/** Compara data_ia contra data_final de un trámite y devuelve todas las diferencias significativas. */
export function diffTramite(
  tramiteId: string,
  dataIA: unknown,
  dataFinal: unknown,
): Diff[] {
  if (!dataFinal || typeof dataFinal !== "object") return [];
  const diffs: Diff[] = [];
  const paths = enumerateFieldPaths(dataIA, dataFinal);
  for (const p of paths) {
    const vi = getPath(dataIA, p);
    const vf = getPath(dataFinal, p);
    const tipo = classifyDiff(vi, vf);
    if (!tipo) continue;
    diffs.push({
      tramiteId,
      campo: p,
      campoRaiz: rootField(p),
      tipo,
      valorIA: vi,
      valorFinal: vf,
      contexto: extractContext(dataFinal, p),
    });
  }
  return diffs;
}

/** Agrupa diffs por (campoRaiz, tipo), descarta frecuencia<2, top 20 por frecuencia. */
export function groupPatterns(all: Diff[], opts: { minFrecuencia?: number; topN?: number } = {}): Pattern[] {
  const minFrecuencia = opts.minFrecuencia ?? 2;
  const topN = opts.topN ?? 20;

  const map = new Map<string, Pattern>();
  const seen = new Map<string, Set<string>>();

  for (const d of all) {
    const key = `${d.campoRaiz}::${d.tipo}`;
    if (!map.has(key)) {
      map.set(key, { campoRaiz: d.campoRaiz, tipo: d.tipo, frecuencia: 0, evidencia: [] });
      seen.set(key, new Set());
    }
    seen.get(key)!.add(d.tramiteId);
    const evidenceList = map.get(key)!.evidencia;
    if (evidenceList.length < 5) {
      evidenceList.push({
        tramiteId: d.tramiteId,
        valorIA: d.valorIA,
        valorFinal: d.valorFinal,
        contexto: d.contexto,
      });
    }
  }

  const out: Pattern[] = [];
  for (const [key, p] of map) {
    p.frecuencia = seen.get(key)!.size;
    if (p.frecuencia >= minFrecuencia) out.push(p);
  }

  out.sort((a, b) => b.frecuencia - a.frecuencia);
  return out.slice(0, topN);
}

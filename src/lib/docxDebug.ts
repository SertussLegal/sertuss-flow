/**
 * DocxDebug — herramientas de auditoría para `doc.render(structuredData)`.
 *
 * Permite detectar mismatches entre los tags `{xxx}` definidos en la plantilla
 * Word y las claves disponibles en el objeto `structuredData` que se inyecta.
 *
 * Tres capas de uso:
 *  - `extractTemplateTags`: lee los tags reales de la plantilla.
 *  - `flattenStructuredData`: aplana el objeto inyectado.
 *  - `diffTagsVsData`: produce el reporte (missing / unused / empty).
 *
 * Toggle de UI persistente: localStorage `sertuss.debugDocx = "1"`.
 */

import PizZip from "pizzip";

const STORAGE_KEY = "sertuss.debugDocx";

// ── Toggle persistente ───────────────────────────────────────────────────

export function isDebugDocxEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.location.search.includes("debug=docx")) return true;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDebugDocx(enabled: boolean): void {
  try {
    if (typeof window === "undefined") return;
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// ── Extracción de tags desde el .docx ────────────────────────────────────

/**
 * Lee los tags `{xxx}`, `{#xxx}`, `{/xxx}`, `{^xxx}` de todos los XML
 * relevantes (document, headers, footers) de la plantilla Word.
 */
export async function extractTemplateTags(zipContent: ArrayBuffer): Promise<string[]> {
  try {
    const zip = new PizZip(zipContent);
    const xmlFiles = Object.keys(zip.files).filter(
      (name) =>
        name.startsWith("word/") &&
        name.endsWith(".xml") &&
        (name.includes("document") || name.includes("header") || name.includes("footer")),
    );

    const found = new Set<string>();
    // Word frecuentemente fragmenta los tags entre <w:t> runs; por eso primero
    // limpiamos las etiquetas XML para reconstruir el texto plano.
    const tagRegex = /\{[#/^]?([a-zA-Z0-9_.-]+)\}/g;

    for (const fileName of xmlFiles) {
      const file = zip.file(fileName);
      if (!file) continue;
      const xml = file.asText();
      // Strip tags de Word para que los `{x}` partidos vuelvan a ser contiguos
      const text = xml.replace(/<[^>]+>/g, "");
      let m: RegExpExecArray | null;
      while ((m = tagRegex.exec(text)) !== null) {
        if (m[1]) found.add(m[1]);
      }
    }

    return Array.from(found).sort();
  } catch (err) {
    console.warn("[docxDebug] No se pudieron extraer tags de la plantilla:", err);
    return [];
  }
}

// ── Aplanado del structuredData ──────────────────────────────────────────

const PLACEHOLDER = "___________";

export interface FlatEntry {
  key: string;
  value: unknown;
  type: "string" | "boolean" | "number" | "array" | "object" | "null";
  isEmpty: boolean;
}

/**
 * Aplana un objeto anidado en pares clave-valor con notación de puntos.
 * Arrays → `vendedores[0].nombre`. Objetos planos → `inmueble.matricula`.
 */
export function flattenStructuredData(
  data: unknown,
  prefix = "",
): Record<string, FlatEntry> {
  const out: Record<string, FlatEntry> = {};

  const walk = (val: unknown, path: string) => {
    if (val === null || val === undefined) {
      out[path] = { key: path, value: val, type: "null", isEmpty: true };
      return;
    }
    if (typeof val === "string") {
      out[path] = {
        key: path,
        value: val,
        type: "string",
        isEmpty: !val.trim() || val.trim() === PLACEHOLDER,
      };
      return;
    }
    if (typeof val === "number") {
      out[path] = { key: path, value: val, type: "number", isEmpty: false };
      return;
    }
    if (typeof val === "boolean") {
      out[path] = { key: path, value: val, type: "boolean", isEmpty: false };
      return;
    }
    if (Array.isArray(val)) {
      if (val.length === 0) {
        out[path] = { key: path, value: [], type: "array", isEmpty: true };
        return;
      }
      val.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof val === "object") {
      const entries = Object.entries(val as Record<string, unknown>);
      if (entries.length === 0) {
        out[path] = { key: path, value: {}, type: "object", isEmpty: true };
        return;
      }
      for (const [k, v] of entries) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };

  walk(data, prefix);
  return out;
}

// ── Diff plantilla ↔ datos ───────────────────────────────────────────────

export interface DocxDiff {
  /** Tags que la plantilla espera pero no existen como clave en data → `___________` */
  missing: string[];
  /** Claves enviadas en data que ningún tag consume → posibles aliases muertos */
  unused: string[];
  /** Tags presentes pero con valor vacío/placeholder */
  empty: string[];
  /** Tags presentes con valor utilizable */
  mapped: string[];
  /** Tags resueltos dentro de un loop `{#section}…{/section}` (scope local). */
  scoped: string[];
  /** Mapa sección → sub-tags consumidos por el loop. */
  sectionsResolved: Record<string, string[]>;
}

/**
 * Compara los tags de la plantilla con el flat data.
 * Considera coincidencia exacta y también por "raíz" (un tag `inmueble`
 * matchea cualquier `inmueble.*` ya que es una sección/loop).
 */
export function diffTagsVsData(
  tags: string[],
  flat: Record<string, FlatEntry>,
): DocxDiff {
  const flatKeys = Object.keys(flat);
  const flatKeySet = new Set(flatKeys);
  const tagSet = new Set(tags);

  // ── Detectar arrays/secciones en el flat: cualquier raíz `R` con claves `R[i].x`
  //    se trata como sección iterable. Recolectamos sub-claves locales y si todos
  //    los items tienen valor vacío en esa sub-clave para marcarlas como "empty".
  const sectionRoots = new Set<string>();
  const sectionLocalKeys: Record<string, Set<string>> = {};
  const sectionItemCount: Record<string, number> = {};
  const sectionEmptyTally: Record<string, Record<string, number>> = {};

  const arrayKeyRe = /^([a-zA-Z0-9_]+)\[(\d+)\](?:\.(.+))?$/;
  for (const k of flatKeys) {
    const m = arrayKeyRe.exec(k);
    if (!m) continue;
    const [, root, idxStr, sub] = m;
    sectionRoots.add(root);
    sectionItemCount[root] = Math.max(sectionItemCount[root] ?? 0, parseInt(idxStr, 10) + 1);
    if (!sub) continue;
    // Solo registramos la primera "hoja" del sub-path como tag local del loop
    // (Docxtemplater resuelve `{nombre}` o `{cedula}` en scope local).
    const local = sub.split(/[.[]/)[0];
    if (!sectionLocalKeys[root]) sectionLocalKeys[root] = new Set();
    sectionLocalKeys[root].add(local);
    if (!sectionEmptyTally[root]) sectionEmptyTally[root] = {};
    const e = flat[k];
    if (e?.isEmpty) {
      sectionEmptyTally[root][local] = (sectionEmptyTally[root][local] ?? 0) + 1;
    }
  }

  const missing: string[] = [];
  const empty: string[] = [];
  const mapped: string[] = [];
  const scoped: string[] = [];
  const sectionsResolved: Record<string, string[]> = {};

  for (const tag of tags) {
    // Match exacto (ej. "matricula_inmobiliaria")
    if (flatKeySet.has(tag)) {
      const e = flat[tag];
      if (e.isEmpty) empty.push(tag);
      else mapped.push(tag);
      continue;
    }
    // Match por sección/loop (ej. tag "vendedores" → existe "vendedores[0].nombre")
    const sectionMatch = flatKeys.find((k) => k === tag || k.startsWith(`${tag}.`) || k.startsWith(`${tag}[`));
    if (sectionMatch) {
      mapped.push(tag);
      continue;
    }
    // Match scoped: el tag corresponde a una sub-clave dentro de algún array.
    // Docxtemplater resuelve `{nombre}` en `{#vendedores}…{nombre}…{/vendedores}`.
    let resolvedInSection: string | null = null;
    for (const root of sectionRoots) {
      if (sectionLocalKeys[root]?.has(tag)) {
        resolvedInSection = root;
        break;
      }
    }
    if (resolvedInSection) {
      scoped.push(tag);
      const items = sectionItemCount[resolvedInSection] ?? 0;
      const emptyCount = sectionEmptyTally[resolvedInSection]?.[tag] ?? 0;
      // Si TODOS los items del array tienen este sub-valor vacío → empty;
      // de lo contrario → mapped.
      if (items > 0 && emptyCount >= items) empty.push(tag);
      else mapped.push(tag);
      if (!sectionsResolved[resolvedInSection]) sectionsResolved[resolvedInSection] = [];
      sectionsResolved[resolvedInSection].push(tag);
      continue;
    }
    missing.push(tag);
  }

  // Aliases sin uso: claves en data que no son consumidas por ningún tag.
  const unused: string[] = [];
  for (const key of flatKeys) {
    // Si es exactamente un tag → usado.
    if (tagSet.has(key)) continue;
    // Si su raíz (antes del primer `.` o `[`) es un tag → usado por un loop/sección.
    const root = key.split(/[.[]/)[0];
    if (tagSet.has(root)) continue;
    // Padres intermedios (ej. "inmueble" cuando el tag es "inmueble.matricula"):
    // si algún tag empieza con `key.` lo consideramos consumido.
    if (tags.some((t) => t.startsWith(`${key}.`))) continue;
    // Sub-clave de un array cuyo tag local existe (resuelto por loop scoped):
    // p.ej. `vendedores[0].nombre` consumido por `{nombre}` dentro de `{#vendedores}`.
    const arrM = arrayKeyRe.exec(key);
    if (arrM) {
      const [, arrRoot, , sub] = arrM;
      if (sub) {
        const local = sub.split(/[.[]/)[0];
        if (sectionLocalKeys[arrRoot]?.has(local) && tagSet.has(local)) continue;
      }
    }
    unused.push(key);
  }

  return {
    missing: missing.sort(),
    unused: unused.sort(),
    empty: Array.from(new Set(empty)).sort(),
    mapped: Array.from(new Set(mapped)).sort(),
    scoped: scoped.sort(),
    sectionsResolved: Object.fromEntries(
      Object.entries(sectionsResolved).map(([k, v]) => [k, Array.from(new Set(v)).sort()]),
    ),
  };
}

// ── Payload de auditoría completo ────────────────────────────────────────

export interface RescuedTagEntry {
  tag: string;
  raw: string;
  file: string;
  paragraphIndex: number;
  inTable: boolean;
  runsFused: number;
}

export interface CrossParagraphEntry {
  hint: string;
  file: string;
  paragraphIndex: number;
  inTable: boolean;
}

export interface DocxAuditPayload {
  tramiteId: string;
  template: string;
  tipoActo: string;
  timestamp: string;
  renderMs?: number;
  counts: {
    tags: number;
    flatKeys: number;
    mapped: number;
    missing: number;
    unused: number;
    empty: number;
    scoped: number;
    rescued: number;
    crossParagraph: number;
  };
  diff: DocxDiff;
  flat: Record<string, FlatEntry>;
  rescued: RescuedTagEntry[];
  crossParagraph: CrossParagraphEntry[];
}

export function buildAuditPayload(args: {
  tramiteId: string;
  template: string;
  tipoActo: string;
  tags: string[];
  structuredData: unknown;
  renderMs?: number;
  rescued?: RescuedTagEntry[];
  crossParagraph?: CrossParagraphEntry[];
}): DocxAuditPayload {
  const flat = flattenStructuredData(args.structuredData);
  const diff = diffTagsVsData(args.tags, flat);
  const rescued = args.rescued ?? [];
  const crossParagraph = args.crossParagraph ?? [];
  return {
    tramiteId: args.tramiteId,
    template: args.template,
    tipoActo: args.tipoActo,
    timestamp: new Date().toISOString(),
    renderMs: args.renderMs,
    counts: {
      tags: args.tags.length,
      flatKeys: Object.keys(flat).length,
      mapped: diff.mapped.length,
      missing: diff.missing.length,
      unused: diff.unused.length,
      empty: diff.empty.length,
      scoped: diff.scoped.length,
      rescued: rescued.length,
      crossParagraph: crossParagraph.length,
    },
    diff,
    flat,
    rescued,
    crossParagraph,
  };
}

/**
 * Console.log estructurado y agrupado para inspección rápida en DevTools.
 */
export function logDocxAuditToConsole(payload: DocxAuditPayload): void {
  /* eslint-disable no-console */
  console.groupCollapsed(
    `%c[Sertuss DocxDebug] ${payload.tramiteId} · ${payload.tipoActo || "trámite"} · ${payload.renderMs ?? "?"}ms`,
    "color:#E4B800;font-weight:bold;",
  );
  console.log("Counts:", payload.counts);
  console.log(
    `Missing en data (riesgo de ${PLACEHOLDER}):`,
    payload.diff.missing,
  );
  console.log("Aliases sin uso:", payload.diff.unused);
  console.log("Tags vacíos:", payload.diff.empty);
  if (payload.rescued.length > 0) {
    console.log("Tags rescatados (split runs reconstruidos):", payload.rescued);
  }
  if (payload.crossParagraph.length > 0) {
    console.warn(
      "⚠️ Tags potencialmente partidos entre párrafos (requieren corrección manual en plantilla):",
      payload.crossParagraph,
    );
  }
  const flatRows = Object.values(payload.flat)
    .slice(0, 80)
    .map((e) => ({
      key: e.key,
      value: typeof e.value === "string" ? e.value.slice(0, 80) : e.value,
      type: e.type,
      empty: e.isEmpty,
    }));
  console.table(flatRows);
  console.groupEnd();
  /* eslint-enable no-console */
}

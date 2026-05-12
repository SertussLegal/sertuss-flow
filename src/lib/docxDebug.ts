/**
 * DocxDebug — herramientas de auditoría para `doc.render(structuredData)`.
 *
 * Detecta mismatches entre los tags `{xxx}` de la plantilla Word y las claves
 * disponibles en `structuredData`, con soporte para:
 *  - Loops simples: `{#vendedores}{nombre}{/vendedores}`
 *  - Sub-claves profundas: `{direccion.ciudad}` dentro de un loop
 *  - Loops anidados: `{#compradores}{#apoderados}{nombre}{/}{/}`
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
    const tagRegex = /\{[#/^]?([a-zA-Z0-9_.-]+)\}/g;

    for (const fileName of xmlFiles) {
      const file = zip.file(fileName);
      if (!file) continue;
      const xml = file.asText();
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
  missing: string[];
  unused: string[];
  /** Claves no consumidas directamente pero cuyo valor coincide con un tag mapped (sinónimos). */
  aliased: string[];
  /** Metadata interna o flags no usados por el template (ruido cosmético). */
  ignored: string[];
  empty: string[];
  mapped: string[];
  scoped: string[];
  /** Mapa sección → sub-tags consumidos por el loop (incluye anidados). */
  sectionsResolved: Record<string, string[]>;
}

/** Claves que nunca deben contar como `unused` (metadata + flags condicionales). */
const IGNORED_KEY_RE = /^(__sertuss_|has_)/;

interface SectionInfo {
  /** Local paths (arrays stripped) que existen como datos dentro de la sección. */
  locals: Set<string>;
  /** Cantidad de items observados (índice máximo + 1). */
  items: number;
  /** Por cada local path, cuántos items lo tienen vacío. */
  emptyByLocal: Record<string, number>;
}

const INDEX_RE = /\[(\d+)\]/g;

/**
 * Para una flat key (p.ej. `compradores[0].apoderados[0].nombre`) devuelve
 * todas las "ventanas de scope" que crearía Docxtemplater al iterar arrays:
 *   { section: 'compradores', local: 'apoderados.nombre', emptyContrib }
 *   { section: 'apoderados',  local: 'nombre',            emptyContrib }
 */
function deriveScopes(key: string): Array<{ section: string; local: string }> {
  const out: Array<{ section: string; local: string }> = [];
  const matches = Array.from(key.matchAll(INDEX_RE));
  for (const m of matches) {
    const pos = m.index ?? 0;
    const before = key.slice(0, pos);
    const section = before.split(/[.[]/).pop() || "";
    if (!section) continue;
    let local = key.slice(pos + m[0].length);
    if (local.startsWith(".")) local = local.slice(1);
    local = local.replace(/\[\d+\]/g, "");
    out.push({ section, local });
  }
  return out;
}

export function diffTagsVsData(
  tags: string[],
  flat: Record<string, FlatEntry>,
): DocxDiff {
  const flatKeys = Object.keys(flat);
  const flatKeySet = new Set(flatKeys);
  const tagSet = new Set(tags);

  // 1. Construir mapa de secciones (con soporte para loops anidados).
  const sections: Record<string, SectionInfo> = {};
  for (const k of flatKeys) {
    const scopes = deriveScopes(k);
    const isEmpty = !!flat[k]?.isEmpty;
    // Conteo de items por sección: usamos el índice del array que pertenece
    // a esa sección (el `[i]` cuyo segmento previo es el nombre de la sección).
    const matches = Array.from(k.matchAll(INDEX_RE));
    matches.forEach((m) => {
      const pos = m.index ?? 0;
      const sectionName = k.slice(0, pos).split(/[.[]/).pop() || "";
      if (!sectionName) return;
      const idx = parseInt(m[1], 10);
      const sec = (sections[sectionName] ??= { locals: new Set(), items: 0, emptyByLocal: {} });
      sec.items = Math.max(sec.items, idx + 1);
    });
    for (const { section, local } of scopes) {
      const sec = (sections[section] ??= { locals: new Set(), items: 0, emptyByLocal: {} });
      if (local) {
        sec.locals.add(local);
        const first = local.split(".")[0];
        if (first && first !== local) sec.locals.add(first);
        if (isEmpty) {
          sec.emptyByLocal[local] = (sec.emptyByLocal[local] ?? 0) + 1;
          if (first && first !== local) {
            sec.emptyByLocal[first] = (sec.emptyByLocal[first] ?? 0) + 1;
          }
        }
      }
    }
  }

  const missing: string[] = [];
  const empty: string[] = [];
  const mapped: string[] = [];
  const scoped: string[] = [];
  const sectionsResolved: Record<string, string[]> = {};

  for (const tag of tags) {
    // (a) Match exacto.
    if (flatKeySet.has(tag)) {
      const e = flat[tag];
      if (e.isEmpty) empty.push(tag);
      else mapped.push(tag);
      continue;
    }
    // (b) Match por sección/loop a nivel root (existe `tag.x` o `tag[i]`).
    if (flatKeys.some((k) => k.startsWith(`${tag}.`) || k.startsWith(`${tag}[`))) {
      mapped.push(tag);
      continue;
    }
    // (c) Match scoped en cualquier sección (incluye loops anidados).
    let resolvedSection: string | null = null;
    for (const [sec, info] of Object.entries(sections)) {
      if (info.locals.has(tag)) {
        resolvedSection = sec;
        break;
      }
    }
    if (resolvedSection) {
      scoped.push(tag);
      const info = sections[resolvedSection];
      const emptyCount = info.emptyByLocal[tag] ?? 0;
      if (info.items > 0 && emptyCount >= info.items) empty.push(tag);
      else mapped.push(tag);
      (sectionsResolved[resolvedSection] ??= []).push(tag);
      continue;
    }
    missing.push(tag);
  }

  // (d) Candidatos a unused: claves no consumidas por ningún tag (root o scoped).
  const rawUnused: string[] = [];
  for (const key of flatKeys) {
    if (tagSet.has(key)) continue;
    const rootKey = key.split(/[.[]/)[0];
    if (tagSet.has(rootKey)) continue;
    if (tags.some((t) => t.startsWith(`${key}.`))) continue;
    const scopes = deriveScopes(key);
    const consumedByScope = scopes.some(({ local }) => {
      if (!local) return false;
      if (tagSet.has(local)) return true;
      const first = local.split(".")[0];
      return !!first && tagSet.has(first);
    });
    if (consumedByScope) continue;
    rawUnused.push(key);
  }

  // (e) Reclasificación: ignored (metadata/flags) → aliased (sinónimo de un mapped) → unused real.
  const mappedSet = new Set(mapped);
  const valueSignature = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") return null;
    const s = String(v).trim();
    if (!s || s === PLACEHOLDER) return null;
    return s;
  };
  const mappedValues = new Set<string>();
  for (const tag of mappedSet) {
    const sig = valueSignature(flat[tag]?.value);
    if (sig) mappedValues.add(sig);
  }

  const ignored: string[] = [];
  const aliased: string[] = [];
  const unused: string[] = [];
  for (const key of rawUnused) {
    if (IGNORED_KEY_RE.test(key)) {
      ignored.push(key);
      continue;
    }
    const sig = valueSignature(flat[key]?.value);
    if (sig && mappedValues.has(sig)) {
      aliased.push(key);
      continue;
    }
    unused.push(key);
  }

  return {
    missing: missing.sort(),
    unused: unused.sort(),
    aliased: aliased.sort(),
    ignored: ignored.sort(),
    empty: Array.from(new Set(empty)).sort(),
    mapped: Array.from(new Set(mapped)).sort(),
    scoped: Array.from(new Set(scoped)).sort(),
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
  /** Lista de tags extraídos de la plantilla Word (sin llaves). */
  tags: string[];
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
    tags: args.tags,
  };
}

export function logDocxAuditToConsole(payload: DocxAuditPayload): void {
  /* eslint-disable no-console */
  console.groupCollapsed(
    `%c[Sertuss DocxDebug] ${payload.tramiteId} · ${payload.tipoActo || "trámite"} · ${payload.renderMs ?? "?"}ms`,
    "color:#E4B800;font-weight:bold;",
  );
  console.log("Counts:", payload.counts);
  console.log(`Missing en data (riesgo de ${PLACEHOLDER}):`, payload.diff.missing);
  console.log("Aliases sin uso:", payload.diff.unused);
  console.log("Tags vacíos:", payload.diff.empty);
  console.log("Scoped (resueltos por loop):", payload.diff.scoped);
  console.log("Secciones detectadas:", payload.diff.sectionsResolved);
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

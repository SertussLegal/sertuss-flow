/**
 * docxTagCatalog — Categoriza los tags de la plantilla Word en secciones
 * lógicas para que un usuario final entienda qué `{{tag}}` corresponde a
 * cada línea de su documento físico.
 *
 * Es 100% dinámico: trabaja sobre los tags reales de la plantilla cargada
 * y los datos reales del trámite (`flat`). No hardcodea ninguna plantilla.
 */

import type { DocxDiff, FlatEntry } from "./docxDebug";

export type SectionId =
  | "portada"
  | "comparecencia"
  | "objeto"
  | "precios"
  | "notaria"
  | "otros";

export type TagStatus = "mapped" | "scoped" | "empty" | "missing";

export interface TagCardData {
  /** Tag tal cual se escribe en Word, ej `{{nombre}}` o `{{matricula_inmobiliaria}}` */
  tag: string;
  /** Clave cruda usada en la plantilla (sin llaves) */
  rawKey: string;
  /** Etiqueta amigable para el usuario notarial */
  friendlyLabel: string;
  /** Valor de ejemplo extraído del structuredData (truncado) */
  exampleValue: string;
  status: TagStatus;
}

export interface LoopBlock {
  kind: "loop";
  loopName: string;
  items: TagCardData[];
}

export interface FlatBlock {
  kind: "flat";
  card: TagCardData;
}

export type SectionBlock = LoopBlock | FlatBlock;

export interface TagSection {
  id: SectionId;
  title: string;
  description: string;
  blocks: SectionBlock[];
}

// ── Diccionario de etiquetas amigables ───────────────────────────────────

const FRIENDLY_LABELS: Record<string, string> = {
  // Portada
  numero_escritura: "Número de escritura",
  fecha_otorgamiento: "Fecha de otorgamiento",
  fecha_escritura: "Fecha de la escritura",
  cuantia: "Cuantía",
  cuantia_letras: "Cuantía en letras",
  radicado: "Radicado",
  acto: "Tipo de acto",
  acto_principal: "Acto principal",
  // Comparecencia
  nombre: "Nombre completo",
  nombres: "Nombres",
  apellidos: "Apellidos",
  cedula: "Cédula de ciudadanía",
  identificacion: "Número de identificación",
  tipo_identificacion: "Tipo de identificación",
  estado_civil: "Estado civil",
  nacionalidad: "Nacionalidad",
  profesion: "Profesión",
  domicilio: "Domicilio",
  direccion: "Dirección",
  telefono: "Teléfono",
  email: "Correo electrónico",
  // Inmueble
  matricula_inmobiliaria: "Matrícula inmobiliaria",
  matricula: "Matrícula inmobiliaria",
  chip: "CHIP catastral",
  cedula_catastral: "Cédula catastral",
  direccion_inmueble: "Dirección del inmueble",
  area: "Área",
  area_construida: "Área construida",
  area_privada: "Área privada",
  linderos: "Linderos",
  // Precios
  precio: "Precio de venta",
  precio_letras: "Precio en letras",
  precio_numero: "Precio en números",
  valor: "Valor",
  valor_hipoteca: "Valor de la hipoteca",
  valor_hipoteca_letras: "Valor de hipoteca en letras",
  monto: "Monto",
  // Notaría
  notaria_numero: "Número de notaría",
  notaria_circulo: "Círculo notarial",
  notario_nombre: "Nombre del notario",
  notaria_direccion: "Dirección de la notaría",
};

function humanize(key: string): string {
  // Última parte de un path con dots, sin índices
  const last = key.split(".").pop() ?? key;
  const clean = last.replace(/\[\d+\]/g, "");
  if (FRIENDLY_LABELS[clean]) return FRIENDLY_LABELS[clean];
  return clean
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Clasificación por patrones ───────────────────────────────────────────

interface SectionMeta {
  id: SectionId;
  title: string;
  description: string;
  patterns: RegExp[];
}

const SECTION_DEFS: SectionMeta[] = [
  {
    id: "portada",
    title: "Portada y Calificación",
    description: "Datos de cabecera del instrumento: número, fecha, cuantía y radicado.",
    patterns: [
      /^numero_escritura/i,
      /^fecha/i,
      /^cuantia/i,
      /^radicado/i,
      /^acto/i,
    ],
  },
  {
    id: "comparecencia",
    title: "Comparecencia",
    description: "Datos personales de las partes que intervienen en el acto.",
    patterns: [/^parte_/i, /^representante/i, /^apoderado/i],
    // Loops principales: vendedores, compradores, etc. se detectan por sectionsResolved.
  },
  {
    id: "objeto",
    title: "Objeto y Linderos",
    description: "Identificación física y jurídica del inmueble.",
    patterns: [
      /^inmueble/i,
      /^direccion(_inmueble)?$/i,
      /matricula/i,
      /^chip$/i,
      /catastral/i,
      /linderos/i,
      /^area/i,
    ],
  },
  {
    id: "precios",
    title: "Precios y Financiero",
    description: "Montos, hipotecas y valores en números y letras.",
    patterns: [
      /^precio/i,
      /^valor/i,
      /hipoteca/i,
      /^monto/i,
      /_letras$/i,
      /_numero$/i,
    ],
  },
  {
    id: "notaria",
    title: "Datos de Notaría",
    description: "Información de la notaría que protocoliza el acto.",
    patterns: [/^notaria/i, /^notario/i, /^circulo/i],
  },
];

const LOOP_SECTION_HINTS: Record<string, SectionId> = {
  vendedores: "comparecencia",
  compradores: "comparecencia",
  apoderados: "comparecencia",
  representantes: "comparecencia",
  partes: "comparecencia",
  otorgantes: "comparecencia",
  inmuebles: "objeto",
  hipotecas: "precios",
};

function classify(key: string): SectionId {
  for (const def of SECTION_DEFS) {
    if (def.patterns.some((re) => re.test(key))) return def.id;
  }
  return "otros";
}

// ── Helpers de valor / estado ────────────────────────────────────────────

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function stringifyExample(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "___________") return "—";
    return truncate(t);
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return truncate(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

function findExampleForLoopKey(
  loopName: string,
  localKey: string,
  flat: Record<string, FlatEntry>,
): string {
  // Busca el primer item del array (índice 0 o el más bajo) que tenga valor.
  const candidates = Object.keys(flat).filter((k) => {
    const re = new RegExp(`(^|\\.)${loopName}\\[\\d+\\]\\.${localKey.replace(/\./g, "\\.")}$`);
    return re.test(k);
  });
  candidates.sort();
  for (const c of candidates) {
    const entry = flat[c];
    if (entry && !entry.isEmpty) return stringifyExample(entry.value);
  }
  // Si todos están vacíos, devuelve el primero igual para mostrar "—"
  if (candidates.length > 0) return stringifyExample(flat[candidates[0]].value);
  return "—";
}

// ── API principal ────────────────────────────────────────────────────────

export function buildTagCatalog(
  tags: string[],
  flat: Record<string, FlatEntry>,
  diff: DocxDiff,
): TagSection[] {
  const sections: Record<SectionId, TagSection> = {
    portada: { id: "portada", ...sectionMetaOf("portada"), blocks: [] },
    comparecencia: { id: "comparecencia", ...sectionMetaOf("comparecencia"), blocks: [] },
    objeto: { id: "objeto", ...sectionMetaOf("objeto"), blocks: [] },
    precios: { id: "precios", ...sectionMetaOf("precios"), blocks: [] },
    notaria: { id: "notaria", ...sectionMetaOf("notaria"), blocks: [] },
    otros: { id: "otros", ...sectionMetaOf("otros"), blocks: [] },
  };

  const mappedSet = new Set(diff.mapped);
  const emptySet = new Set(diff.empty);
  const missingSet = new Set(diff.missing);
  const sectionsResolved = diff.sectionsResolved ?? {};
  const loopNames = new Set(Object.keys(sectionsResolved));

  // 1) Loops → un LoopBlock por cada sección detectada.
  for (const [loopName, subKeys] of Object.entries(sectionsResolved)) {
    if (subKeys.length === 0) continue;
    const targetId: SectionId =
      LOOP_SECTION_HINTS[loopName] ??
      classify(subKeys[0] ?? loopName);

    const items: TagCardData[] = subKeys.map((sub) => ({
      tag: `{{${sub}}}`,
      rawKey: sub,
      friendlyLabel: humanize(sub),
      exampleValue: findExampleForLoopKey(loopName, sub, flat),
      status: "scoped" as TagStatus,
    }));

    sections[targetId].blocks.push({ kind: "loop", loopName, items });
  }

  // 2) Tags planos (no resueltos por loop). Excluimos los que ya viven dentro
  //    de un loop (sus claves locales aparecen en sectionsResolved[loop]).
  const subKeysInLoops = new Set<string>();
  for (const [loop, subs] of Object.entries(sectionsResolved)) {
    for (const s of subs) subKeysInLoops.add(`${loop}::${s}`);
  }

  for (const tag of tags) {
    // Si el tag pertenece a algún loop ya cubierto, lo saltamos.
    let consumedByLoop = false;
    for (const loop of loopNames) {
      if (subKeysInLoops.has(`${loop}::${tag}`)) {
        consumedByLoop = true;
        break;
      }
    }
    if (consumedByLoop) continue;
    // Tampoco mostramos los markers de sección/cierre.
    if (loopNames.has(tag)) continue;

    const status: TagStatus = mappedSet.has(tag)
      ? "mapped"
      : emptySet.has(tag)
        ? "empty"
        : missingSet.has(tag)
          ? "missing"
          : "mapped";

    const entry = flat[tag];
    const example = entry ? stringifyExample(entry.value) : "—";

    const card: TagCardData = {
      tag: `{{${tag}}}`,
      rawKey: tag,
      friendlyLabel: humanize(tag),
      exampleValue: example,
      status,
    };

    sections[classify(tag)].blocks.push({ kind: "flat", card });
  }

  // Ordenar tarjetas planas alfabéticamente dentro de cada sección.
  for (const sec of Object.values(sections)) {
    sec.blocks.sort((a, b) => {
      if (a.kind === "loop" && b.kind === "loop") return a.loopName.localeCompare(b.loopName);
      if (a.kind === "loop") return -1;
      if (b.kind === "loop") return 1;
      return a.card.friendlyLabel.localeCompare(b.card.friendlyLabel);
    });
  }

  // Devolver solo secciones con contenido, en orden definido.
  const order: SectionId[] = ["portada", "comparecencia", "objeto", "precios", "notaria", "otros"];
  return order.map((id) => sections[id]).filter((s) => s.blocks.length > 0);
}

function sectionMetaOf(id: SectionId): { title: string; description: string } {
  if (id === "otros") {
    return {
      title: "Otros",
      description: "Tags adicionales que no encajan en las categorías principales.",
    };
  }
  const def = SECTION_DEFS.find((d) => d.id === id)!;
  return { title: def.title, description: def.description };
}

/**
 * docxRunNormalizer — Reconstrucción de tags `{xxx}` fragmentados entre
 * múltiples `<w:r>` (runs) de Word.
 *
 * Word fragmenta tags por correctores ortográficos (`<w:proofErr/>`),
 * cambios de `rsid`, formato local, bookmarks o comentarios. Aunque
 * Docxtemplater intenta tolerarlo, los delimitadores personalizados de
 * Sertuss (`{` / `}`) y secciones `{#x}{/x}` se benefician de un
 * pre-procesado explícito.
 *
 * Esta normalización ocurre **en memoria** sobre el `PizZip` ya cargado.
 * Si el XML resultante no parsea, se hace rollback automático de ese
 * archivo para no corromper el `.docx`.
 *
 * Cubre párrafos sueltos y párrafos dentro de tablas (los `<w:p>` dentro
 * de `<w:tc>` se procesan igual que los del cuerpo).
 */

import type PizZip from "pizzip";
import { isDebugDocxEnabled } from "./docxDebug";

// ── Tipos ────────────────────────────────────────────────────────────────

export interface RescuedTag {
  tag: string; // "matricula_inmobiliaria"
  raw: string; // "{matricula_inmobiliaria}"
  file: string; // "word/document.xml"
  paragraphIndex: number; // índice del <w:p> dentro del archivo
  inTable: boolean; // true si el <w:p> está dentro de <w:tc>
  runsFused: number; // número de runs que cedieron texto al primer run
}

export interface CrossParagraphIssue {
  /** Texto truncado encontrado al final de un párrafo (incluye `{` huérfano). */
  hint: string;
  file: string;
  paragraphIndex: number;
  inTable: boolean;
}

export interface NormalizeResult {
  rescued: RescuedTag[];
  crossParagraph: CrossParagraphIssue[];
  filesProcessed: string[];
  xmlValid: { ok: boolean; errors: string[] };
}

interface NormalizeOpts {
  /** Imprime [DocxDebug] por cada rescate. Si se omite, usa `isDebugDocxEnabled()`. */
  verbose?: boolean;
}

// ── Validación XML ───────────────────────────────────────────────────────

export function validateXml(xml: string): { ok: boolean; error?: string } {
  if (typeof DOMParser === "undefined") return { ok: true };
  try {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const err = doc.getElementsByTagName("parsererror")[0];
    if (err) return { ok: false, error: err.textContent?.slice(0, 200) || "parsererror" };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Helpers de regex sobre XML ───────────────────────────────────────────

const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/;
// Tags válidos: {x}, {#x}, {/x}, {^x}. Permitimos `.` `_` `-` y dígitos.
const TAG_RE = /\{[#/^]?[a-zA-Z0-9_.\-]+\}/g;

function isParagraphInTable(xmlBefore: string): boolean {
  // Heurística: el último `<w:tc>` aún no está cerrado por un `</w:tc>` antes
  // del párrafo actual.
  const lastOpen = xmlBefore.lastIndexOf("<w:tc");
  if (lastOpen < 0) return false;
  const lastClose = xmlBefore.lastIndexOf("</w:tc>");
  return lastOpen > lastClose;
}

interface RunInfo {
  /** offset absoluto del `<w:r>` dentro del párrafo */
  start: number;
  /** offset absoluto justo después del `</w:r>` */
  end: number;
  /** XML completo del run */
  xml: string;
  /** offset absoluto del primer carácter dentro de `<w:t>` */
  textStart: number;
  /** offset absoluto del último carácter dentro de `<w:t>` (exclusive) */
  textEnd: number;
  /** texto plano contenido en `<w:t>` */
  text: string;
}

function extractRunsFromParagraph(paragraphXml: string): RunInfo[] {
  const runs: RunInfo[] = [];
  RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_RE.exec(paragraphXml)) !== null) {
    const xml = m[0];
    const tm = TEXT_RE.exec(xml);
    if (!tm) continue; // run sin <w:t> (p. ej. solo <w:tab/>)
    const innerStart = tm.index + tm[0].indexOf(">", 0) + 1; // offset relativo al run
    // Recalculamos limpio:
    const openIdx = xml.search(/<w:t(?:\s[^>]*)?>/);
    if (openIdx < 0) continue;
    const openTagMatch = xml.slice(openIdx).match(/^<w:t(?:\s[^>]*)?>/);
    if (!openTagMatch) continue;
    const textStartRel = openIdx + openTagMatch[0].length;
    const closeIdx = xml.indexOf("</w:t>", textStartRel);
    if (closeIdx < 0) continue;
    runs.push({
      start: m.index,
      end: m.index + xml.length,
      xml,
      textStart: m.index + textStartRel,
      textEnd: m.index + closeIdx,
      text: xml.slice(textStartRel, closeIdx),
    });
  }
  return runs;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Asegura `xml:space="preserve"` en el `<w:t>` del run dado, devolviendo el run con el nuevo texto. */
function rewriteRunText(runXml: string, newText: string): string {
  const openMatch = runXml.match(/<w:t(?:\s[^>]*)?>/);
  if (!openMatch) return runXml;
  const closeIdx = runXml.indexOf("</w:t>", openMatch.index! + openMatch[0].length);
  if (closeIdx < 0) return runXml;
  let openTag = openMatch[0];
  if (!/xml:space=/.test(openTag)) {
    openTag = openTag.replace("<w:t", '<w:t xml:space="preserve"');
  }
  return (
    runXml.slice(0, openMatch.index!) +
    openTag +
    encodeXmlText(newText) +
    "</w:t>" +
    runXml.slice(closeIdx + "</w:t>".length)
  );
}

// ── Normalización por párrafo ────────────────────────────────────────────

interface ParagraphRescue {
  newXml: string;
  rescued: Array<{ tag: string; raw: string; runsFused: number }>;
  crossHint?: string;
}

function normalizeParagraph(paragraphXml: string): ParagraphRescue {
  const runs = extractRunsFromParagraph(paragraphXml);
  if (runs.length < 2) {
    // Aún así reportar `{` huérfano sin `}` en el último run para detectar
    // tags partidos entre párrafos.
    const last = runs[0];
    if (last) {
      const decoded = decodeXmlEntities(last.text);
      if (/\{[#/^]?[a-zA-Z0-9_.\-]*$/.test(decoded.trim())) {
        return { newXml: paragraphXml, rescued: [], crossHint: decoded.trim().slice(-40) };
      }
    }
    return { newXml: paragraphXml, rescued: [] };
  }

  // Texto concatenado y mapa offset-concat → índice de run
  let concat = "";
  const ownership: number[] = []; // ownership[i] = índice de run que aporta el char i
  runs.forEach((r, idx) => {
    const decoded = decodeXmlEntities(r.text);
    for (let i = 0; i < decoded.length; i++) ownership.push(idx);
    concat += decoded;
  });

  // ¿Hay tags? Si todos los tags caben dentro de un único run, no hay nada que rescatar.
  const tagMatches: Array<{ raw: string; start: number; end: number }> = [];
  TAG_RE.lastIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = TAG_RE.exec(concat)) !== null) {
    tagMatches.push({ raw: tm[0], start: tm.index, end: tm.index + tm[0].length });
  }

  // Detectar `{` huérfano al final → posible cross-paragraph
  const trimmed = concat.replace(/\s+$/, "");
  let crossHint: string | undefined;
  const orphan = trimmed.match(/\{[#/^]?[a-zA-Z0-9_.\-]*$/);
  if (orphan && !trimmed.endsWith("}")) {
    crossHint = orphan[0].slice(-40);
  }

  if (tagMatches.length === 0) {
    return { newXml: paragraphXml, rescued: [], crossHint };
  }

  // Identificar tags partidos (ownership[start] !== ownership[end-1])
  const rescuedList: Array<{ tag: string; raw: string; runsFused: number; startRun: number; endRun: number }> = [];
  for (const t of tagMatches) {
    const startRun = ownership[t.start];
    const endRun = ownership[t.end - 1];
    if (startRun !== endRun) {
      const tagName = t.raw.replace(/^\{[#/^]?/, "").replace(/\}$/, "");
      rescuedList.push({
        tag: tagName,
        raw: t.raw,
        runsFused: endRun - startRun,
        startRun,
        endRun,
      });
    }
  }

  if (rescuedList.length === 0) {
    return { newXml: paragraphXml, rescued: [], crossHint };
  }

  // Reescritura: por cada rescate, mover el rango [startRun..endRun] al primer run.
  // Procesamos de adelante hacia atrás para no invalidar offsets posteriores en `concat`.
  // Sin embargo el XML lo reescribimos de derecha a izquierda sobre el paragraphXml.
  // Construimos un plan: por cada run involucrado, su nuevo texto.
  const newRunTexts = runs.map((r) => decodeXmlEntities(r.text));

  // Ordenamos los rescates por startRun ascendente; si se solapan, los fusionamos.
  rescuedList.sort((a, b) => a.startRun - b.startRun);

  for (const r of rescuedList) {
    // Texto consolidado = concat de newRunTexts[startRun..endRun]
    // Pero ya pudimos haber tocado esos runs en un rescate anterior; en ese caso
    // tomamos lo que haya quedado.
    let consolidated = "";
    for (let i = r.startRun; i <= r.endRun; i++) consolidated += newRunTexts[i];
    // El primer run conserva todo el texto consolidado; los siguientes quedan vacíos.
    newRunTexts[r.startRun] = consolidated;
    for (let i = r.startRun + 1; i <= r.endRun; i++) newRunTexts[i] = "";
  }

  // Si ningún run cambió en realidad (caso defensivo), abortamos.
  const changed = runs.some((r, i) => newRunTexts[i] !== decodeXmlEntities(r.text));
  if (!changed) return { newXml: paragraphXml, rescued: [], crossHint };

  // Reescribir runs de derecha a izquierda
  let out = paragraphXml;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    const newRunXml = rewriteRunText(r.xml, newRunTexts[i]);
    out = out.slice(0, r.start) + newRunXml + out.slice(r.end);
  }

  return {
    newXml: out,
    rescued: rescuedList.map((r) => ({ tag: r.tag, raw: r.raw, runsFused: r.runsFused })),
    crossHint,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────

const TARGET_FILE_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;

export function normalizeDocxRuns(zip: PizZip, opts: NormalizeOpts = {}): NormalizeResult {
  const verbose = opts.verbose ?? isDebugDocxEnabled();
  const rescued: RescuedTag[] = [];
  const crossParagraph: CrossParagraphIssue[] = [];
  const filesProcessed: string[] = [];
  const xmlErrors: string[] = [];

  const files = Object.keys(zip.files).filter((n) => TARGET_FILE_RE.test(n));

  for (const fileName of files) {
    const f = zip.file(fileName);
    if (!f) continue;
    const original = f.asText();
    let paragraphIdx = -1;
    let mutated = false;

    const newXml = original.replace(PARA_RE, (paraXml, offset: number) => {
      paragraphIdx++;
      const inTable = isParagraphInTable(original.slice(0, offset));
      const result = normalizeParagraph(paraXml);

      if (result.rescued.length > 0) {
        mutated = true;
        for (const r of result.rescued) {
          rescued.push({
            tag: r.tag,
            raw: r.raw,
            file: fileName,
            paragraphIndex: paragraphIdx,
            inTable,
            runsFused: r.runsFused,
          });
          if (verbose) {
            // eslint-disable-next-line no-console
            console.info(
              `[DocxDebug] Tag detectado y reconstruido: ${r.raw}` +
                (inTable ? " (dentro de tabla)" : "") +
                ` · runs fusionados: ${r.runsFused} · ${fileName}#p${paragraphIdx}`,
            );
          }
        }
      }

      if (result.crossHint) {
        crossParagraph.push({
          hint: result.crossHint,
          file: fileName,
          paragraphIndex: paragraphIdx,
          inTable,
        });
        if (verbose) {
          // eslint-disable-next-line no-console
          console.warn(
            `[DocxDebug] Posible tag cortado entre párrafos: "${result.crossHint}" · ${fileName}#p${paragraphIdx}` +
              (inTable ? " (dentro de tabla)" : "") +
              " — la plantilla necesita corrección manual.",
          );
        }
      }

      return result.newXml;
    });

    if (mutated) {
      const v = validateXml(newXml);
      if (v.ok) {
        zip.file(fileName, newXml);
        filesProcessed.push(fileName);
      } else {
        xmlErrors.push(`${fileName}: ${v.error}`);
        // rollback implícito: no escribimos
        if (verbose) {
          // eslint-disable-next-line no-console
          console.warn(`[DocxDebug] Rollback en ${fileName} por XML inválido: ${v.error}`);
        }
      }
    }
  }

  return {
    rescued,
    crossParagraph,
    filesProcessed,
    xmlValid: { ok: xmlErrors.length === 0, errors: xmlErrors },
  };
}

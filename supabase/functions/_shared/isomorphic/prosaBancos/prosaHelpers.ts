// ============================================================================
// prosaBancos/prosaHelpers — ISOMÓRFICO (Deno + Vite). Helpers puros de
// composición notarial de sociedades apoderadas y cargo de RL bancario.
//
// Diseño defensivo: cada helper degrada con gracia cuando el OCR falla
// parcialmente. Sin imports externos (solo legalProse local + types).
//
// Motivación: los defectos A/B/C detectados sobre Davivienda se repetirán
// en cualquier banco que use el mismo `poderBancoExtractor` compartido.
// Los helpers viven acá, no dentro de `davivienda.ts`.
// ============================================================================

import { numeroConLetras, fechaProsa } from "./legalProse.ts";
import type { ApoderadoPayload, PoderdantePayload } from "./types.ts";

function nn(s?: string | null): boolean {
  return typeof s === "string" && s.trim().length > 0;
}
function up(s?: string | null): string {
  return (s ?? "").toString().trim().toUpperCase();
}

/**
 * Fecha ISO (YYYY-MM-DD/DD-MM-YYYY) o fecha textual → prosa lowercase.
 * Devuelve "" si nada utilizable.
 */
export function fechaOTextoProsa(fecha?: string | null, fechaTexto?: string | null): string {
  if (nn(fecha)) {
    const p = fechaProsa(fecha!);
    if (p) return p;
  }
  if (nn(fechaTexto)) return fechaTexto!.trim().toLowerCase();
  return "";
}

// ── describirConstitucionSociedad ──────────────────────────────────────────

type SociedadConstitucion = NonNullable<ApoderadoPayload["sociedad_constitucion"]>;

interface DescribirConstitucionInput {
  sociedad_razon_social?: string | null;
  sociedad_constitucion?: SociedadConstitucion | null;
}

export interface DescribirConstitucionOpts {
  /** Frase que precede la fecha de constitución. Default: "de asamblea de accionistas". */
  sufijoFechaConstitucion?: string;
}

/**
 * Frase notarial de constitución de la sociedad apoderada.
 * Defensivo:
 *   - Omite el "número" del acto si tipo_documento='documento_privado'
 *     (aun si viene poblado por error de extracción).
 *   - Menciona la reforma con lo que tenga disponible: no calla todo por
 *     falta de 1-2 subcampos.
 *   - Devuelve "" si no hay NADA que decir.
 */
export function describirConstitucionSociedad(
  apoderado: DescribirConstitucionInput,
  opts?: DescribirConstitucionOpts,
): string {
  const c = apoderado.sociedad_constitucion || {};
  const razonActual = up(apoderado.sociedad_razon_social);
  const sufijoFecha = opts?.sufijoFechaConstitucion ?? "de asamblea de accionistas";
  const partes: string[] = [];

  // ── Bloque 1: acto constitutivo (tipo + fecha + número condicional) ──
  const esDocPrivado = c.tipo_documento === "documento_privado";
  const esEscrituraPublica = c.tipo_documento === "escritura_publica";
  const debeMostrarNumero = esEscrituraPublica && nn(c.numero);
  if (nn(c.tipo_documento) || nn(c.fecha) || nn(c.fecha_texto) || debeMostrarNumero) {
    const docTipo = esEscrituraPublica ? "escritura pública" : "documento privado";
    const numTxt = debeMostrarNumero
      ? `número ${numeroConLetras(c.numero!, "masculine")} `
      : "";
    const fechaTxt = fechaOTextoProsa(c.fecha, c.fecha_texto);
    if (fechaTxt) {
      const sufijo = esDocPrivado || esEscrituraPublica ? ` ${sufijoFecha}` : "";
      partes.push(
        `sociedad constituida mediante ${docTipo} ${numTxt}del ${fechaTxt}${sufijo}`.replace(/\s+/g, " ").trim(),
      );
    } else if (numTxt) {
      partes.push(`sociedad constituida mediante ${docTipo} ${numTxt.trim()}`.trim());
    } else {
      partes.push(`sociedad constituida mediante ${docTipo}`);
    }
  }

  // ── Bloque 2: inscripción en Cámara de Comercio ──
  if (nn(c.camara_comercio_ciudad) || nn(c.camara_comercio_fecha) || nn(c.camara_comercio_numero) || nn(c.libro)) {
    const cciu = nn(c.camara_comercio_ciudad) ? c.camara_comercio_ciudad!.trim().toLowerCase() : "";
    const cfecha = fechaOTextoProsa(c.camara_comercio_fecha, null);
    const cnum = nn(c.camara_comercio_numero) ? c.camara_comercio_numero!.trim() : "";
    const libro = nn(c.libro) ? c.libro!.trim() : "";
    let s = `inscrita en la cámara de comercio${cciu ? " de " + cciu : ""}`;
    if (cfecha) s += ` el ${cfecha}`;
    if (cnum) s += ` bajo el número ${cnum}`;
    if (libro) s += ` del libro ${libro}`;
    partes.push(s);
  }

  // ── Bloque 3: reforma societaria (degradación con gracia) ──
  if (nn(c.razon_social_anterior)) {
    const nombreAnterior = up(c.razon_social_anterior);
    let s = `se constituyó inicialmente como ${nombreAnterior}`;
    const actaNumTxt = nn(c.reforma_acta_numero)
      ? ` número ${numeroConLetras(c.reforma_acta_numero!, "masculine")}`
      : "";
    const actaFechaTxt = nn(c.reforma_acta_fecha_texto)
      ? ` del ${c.reforma_acta_fecha_texto!.trim().toLowerCase()}`
      : "";
    const camFechaTxt = nn(c.reforma_camara_fecha_texto)
      ? ` el ${c.reforma_camara_fecha_texto!.trim().toLowerCase()}`
      : "";
    const tieneAlgunaReforma = actaNumTxt || actaFechaTxt || camFechaTxt;
    const cambioSufijo = razonActual ? ` por ${razonActual}` : "";

    if (tieneAlgunaReforma) {
      // Frase canónica: menciona los subcampos que sí están.
      const camaraFragmento = camFechaTxt
        ? `, inscrita en la Cámara de comercio${camFechaTxt}`
        : "";
      s += `, posteriormente mediante acta${actaNumTxt}${actaFechaTxt} ${sufijoFecha}${camaraFragmento}, cambio su razón social${cambioSufijo}`;
    } else if (razonActual) {
      // Degradación: sin fechas de reforma pero sí razón anterior + actual.
      s += ` y posteriormente cambió su razón social${cambioSufijo}`;
    }
    partes.push(s);
  }

  return partes.join(", ");
}

// ── describirCargoRL ────────────────────────────────────────────────────────

const CARGO_GENERICO_RE = /^\s*representante\s+legal\s*$/i;

/**
 * Fragmento notarial que describe la condición del RL del banco firmante.
 *
 * - Cargo específico (ej: "SUPLENTE DEL PRESIDENTE") → frase canónica:
 *   "obrando en su condición de <cargo> y como tal representante legal del <banco>".
 * - Cargo ausente o genérico ("representante legal" en cualquier casing)
 *   → sin doble mención: "obrando en su condición de representante legal del <banco>".
 */
export function describirCargoRL(cargo: string | null | undefined, nombreBanco: string): string {
  const banco = (nombreBanco ?? "").trim();
  const cargoLimpio = (cargo ?? "").toString().trim();
  if (!cargoLimpio || CARGO_GENERICO_RE.test(cargoLimpio)) {
    return `obrando en su condición de representante legal del ${banco}`;
  }
  return `obrando en su condición de ${cargoLimpio.toLowerCase()} y como tal representante legal del ${banco}`;
}

// Re-export tipo para consumidores.
export type { PoderdantePayload };

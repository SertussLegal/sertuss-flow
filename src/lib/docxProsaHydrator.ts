/**
 * docxProsaHydrator — Convierte campos numéricos/fecha del modelo consolidado
 * en su versión en letras (prosa notarial colombiana). Se ejecuta DESPUÉS de
 * `getConsolidatedDocxData` y `applyManualOverrides`, y ANTES de `doc.render`.
 *
 * Garantía: la plantilla NUNCA debe calcular nada. Si un tag pide letras,
 * aquí ya viene la prosa lista. Esto evita el patrón "envío número, plantilla
 * imprime ___________".
 */

import { fechaProsa, montoProsa, numeroConLetras } from "@/lib/legalProse";
import {
  coeficienteToLetras,
  numeroNotariaToLetras,
} from "@/lib/legalFormatters";
import type { ConsolidatedDocxData } from "@/lib/docxConsolidation";

const PLACEHOLDER = "___________";

const isBlank = (v: unknown): boolean => {
  if (v == null) return true;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return !t || t === PLACEHOLDER;
};

const stripCurrencySuffix = (s: string): string => {
  // "CIENTO ... DE PESOS ($100.000.000)" → "CIENTO ... DE PESOS"
  const idx = s.indexOf(" ($");
  return idx >= 0 ? s.slice(0, idx) : s;
};

function hydrateMonto(numericValue: string | undefined | null): {
  letras: string;
  numero: string;
} {
  if (!numericValue || isBlank(numericValue)) {
    return { letras: PLACEHOLDER, numero: PLACEHOLDER };
  }
  const numero = montoProsa(numericValue); // "CIENTO... ($100.000.000)"
  if (!numero) return { letras: PLACEHOLDER, numero: PLACEHOLDER };
  return { letras: stripCurrencySuffix(numero), numero };
}

function hydrateNumeroEnLetras(value: unknown): string {
  if (isBlank(value)) return PLACEHOLDER;
  const out = numeroConLetras(String(value), "masculine");
  return out || PLACEHOLDER;
}

function hydrateAnioLetras(value: unknown): string {
  if (isBlank(value)) return PLACEHOLDER;
  const n = parseInt(String(value).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return PLACEHOLDER;
  // "mil novecientos setenta y uno (1971)"
  return numeroConLetras(n, "masculine");
}

function hydrateDiaLetras(value: unknown): string {
  if (isBlank(value)) return PLACEHOLDER;
  const n = parseInt(String(value).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0 || n > 31) return PLACEHOLDER;
  return numeroConLetras(n, "masculine");
}

function hydrateFechaBlock(block: Record<string, unknown> | undefined): void {
  if (!block || typeof block !== "object") return;
  // dia_letras
  if (isBlank(block.dia_letras) && !isBlank(block.dia_num)) {
    block.dia_letras = hydrateDiaLetras(block.dia_num);
  }
  // anio_letras
  if (isBlank(block.anio_letras) && !isBlank(block.anio_num)) {
    block.anio_letras = hydrateAnioLetras(block.anio_num);
  }
}

/**
 * Hidrata todos los campos en letras del modelo consolidado.
 * Idempotente: solo escribe donde encuentra placeholder.
 */
export function hydrateProsa(data: ConsolidatedDocxData): ConsolidatedDocxData {
  // Clonado defensivo para no mutar el input.
  const out = JSON.parse(JSON.stringify(data)) as ConsolidatedDocxData;

  const actos = out.actos as Record<string, unknown> | undefined;
  const antecedentes = out.antecedentes as Record<string, unknown> | undefined;
  const rph = out.rph as Record<string, unknown> | undefined;
  const apoderado = out.apoderado_banco as Record<string, unknown> | undefined;
  const inmueble = out.inmueble as Record<string, unknown> | undefined;

  // ── Notaría: derivar letras si solo hay número ─────────────────
  const notNumero = String(out.notaria_numero ?? "").replace(/\D/g, "");
  if (notNumero && (isBlank(out.notaria_numero_letras) || out.notaria_numero_letras === PLACEHOLDER)) {
    const letras = numeroNotariaToLetras(notNumero);
    if (letras) {
      out.notaria_numero_letras = letras;
      out.notaria_numero_letras_lower = letras.toLowerCase();
      const upper = letras.toUpperCase();
      out.notaria_numero_letras_femenino = upper.endsWith("O")
        ? upper.slice(0, -1) + "A"
        : upper;
    }
  }

  // ── Coeficiente ────────────────────────────────────────────────
  if (inmueble && isBlank(inmueble.coeficiente_letras) && !isBlank(inmueble.coeficiente_numero)) {
    const txt = coeficienteToLetras(String(inmueble.coeficiente_numero));
    if (txt) inmueble.coeficiente_letras = txt;
  }
  if (isBlank(out.coeficiente_letras) && !isBlank(out.coeficiente_numero)) {
    const txt = coeficienteToLetras(String(out.coeficiente_numero));
    if (txt) out.coeficiente_letras = txt;
  }

  // ── Actos: cuantías y fechas de crédito ────────────────────────
  if (actos) {
    // Si vino solo el numérico, regenera letras
    const cvNum = actos.cuantia_compraventa_numero;
    if (!isBlank(cvNum) && isBlank(actos.cuantia_compraventa_letras)) {
      // cvNum suele venir ya como "CIENTO... ($100.000.000)" — extraer numérico crudo
      const raw = String(cvNum).match(/\$([\d.,]+)/)?.[1] ?? String(cvNum);
      const m = hydrateMonto(raw.replace(/\./g, "").replace(/,\d{2}$/, ""));
      actos.cuantia_compraventa_letras = m.letras;
    }
    const hipNum = actos.cuantia_hipoteca_numero;
    if (!isBlank(hipNum) && isBlank(actos.cuantia_hipoteca_letras)) {
      const raw = String(hipNum).match(/\$([\d.,]+)/)?.[1] ?? String(hipNum);
      const m = hydrateMonto(raw.replace(/\./g, "").replace(/,\d{2}$/, ""));
      actos.cuantia_hipoteca_letras = m.letras;
    }

    hydrateFechaBlock({
      get dia_letras() { return actos.credito_dia_letras; },
      set dia_letras(v) { actos.credito_dia_letras = v; },
      get dia_num() { return actos.credito_dia_num; },
      set dia_num(v) { actos.credito_dia_num = v; },
      get anio_letras() { return actos.credito_anio_letras; },
      set anio_letras(v) { actos.credito_anio_letras = v; },
      get anio_num() { return actos.credito_anio_num; },
      set anio_num(v) { actos.credito_anio_num = v; },
    } as Record<string, unknown>);
  }

  // ── Antecedentes: fecha + número de escritura en letras ────────
  if (antecedentes) {
    if (isBlank(antecedentes.escritura_num_letras) && !isBlank(antecedentes.escritura_num_numero)) {
      antecedentes.escritura_num_letras = hydrateNumeroEnLetras(antecedentes.escritura_num_numero);
    }
    hydrateFechaBlock({
      get dia_letras() { return antecedentes.escritura_dia_letras; },
      set dia_letras(v) { antecedentes.escritura_dia_letras = v; },
      get dia_num() { return antecedentes.escritura_dia_num; },
      set dia_num(v) { antecedentes.escritura_dia_num = v; },
      get anio_letras() { return antecedentes.escritura_anio_letras; },
      set anio_letras(v) { antecedentes.escritura_anio_letras = v; },
      get anio_num() { return antecedentes.escritura_anio_num; },
      set anio_num(v) { antecedentes.escritura_anio_num = v; },
    } as Record<string, unknown>);
  }

  // ── RPH ────────────────────────────────────────────────────────
  if (rph) {
    if (isBlank(rph.escritura_num_letras) && !isBlank(rph.escritura_num_numero)) {
      rph.escritura_num_letras = hydrateNumeroEnLetras(rph.escritura_num_numero);
    }
    hydrateFechaBlock({
      get dia_letras() { return rph.escritura_dia_letras; },
      set dia_letras(v) { rph.escritura_dia_letras = v; },
      get dia_num() { return rph.escritura_dia_num; },
      set dia_num(v) { rph.escritura_dia_num = v; },
      get anio_letras() { return rph.escritura_anio_letras; },
      set anio_letras(v) { rph.escritura_anio_letras = v; },
      get anio_num() { return rph.escritura_anio_num; },
      set anio_num(v) { rph.escritura_anio_num = v; },
    } as Record<string, unknown>);
  }

  // ── Apoderado banco: fecha del poder ───────────────────────────
  if (apoderado) {
    hydrateFechaBlock({
      get dia_letras() { return apoderado.poder_dia_letras; },
      set dia_letras(v) { apoderado.poder_dia_letras = v; },
      get dia_num() { return apoderado.poder_dia_num; },
      set dia_num(v) { apoderado.poder_dia_num = v; },
      get anio_letras() { return apoderado.poder_anio_letras; },
      set anio_letras(v) { apoderado.poder_anio_letras = v; },
      get anio_num() { return apoderado.poder_anio_num; },
      set anio_num(v) { apoderado.poder_anio_num = v; },
    } as Record<string, unknown>);
  }

  // ── Fecha legal larga (fecha_escritura_letras) ─────────────────
  if (actos && isBlank(actos.fecha_escritura_letras)) {
    // Si el trámite tiene fecha en raw, convertir. No siempre la tenemos.
    const fechaRaw = (out as Record<string, unknown>).__fecha_escritura_raw;
    if (typeof fechaRaw === "string" && fechaRaw) {
      const txt = fechaProsa(fechaRaw);
      if (txt) actos.fecha_escritura_letras = txt;
    }
  }

  return out;
}

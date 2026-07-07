/**
 * Fase 1 (2026-07): reemplaza al auditor Claude en vivo.
 * Helper determinista puro: sin red, sin IA, sin BD.
 * Evalúa un subset alto-ROI de reglas y devuelve los N hallazgos más importantes
 * priorizados por severidad (error > advertencia > sugerencia).
 *
 * Reglas cubiertas en esta fase (7):
 *   R1 personas_sin_cedula                → error
 *   R2 sin_vendedores_o_compradores       → error
 *   R3 inmueble_sin_matricula             → error
 *   R4 cuantia_faltante                   → error (compraventa, hipoteca)
 *   R5 chip_o_catastro_faltante           → advertencia
 *   R6 lugar_expedicion_faltante          → advertencia
 *   R7 notaria_tramite_incompleta         → error
 */

export type Nivel = "error" | "advertencia" | "sugerencia";

export interface DeterministicIssue {
  nivel: Nivel;
  campo: string;
  explicacion: string;
  codigo_regla: string;
}

export interface ComputeInput {
  tipoActo: string;
  vendedores: any[];
  compradores: any[];
  inmueble: any;
  actos: any;
  notariaTramite?: any;
}

const SEV: Record<Nivel, number> = { error: 0, advertencia: 1, sugerencia: 2 };

const isBogota = (municipio?: string) =>
  !!municipio && /bogot[aá]/i.test(municipio);

const slotOcupado = (p: any) =>
  !!(p?.nombre_completo || p?.numero_cedula || p?.razon_social || p?.nit);

export function computeTopIssues(input: ComputeInput, max = 3): DeterministicIssue[] {
  const out: DeterministicIssue[] = [];
  const { tipoActo, vendedores, compradores, inmueble, actos, notariaTramite } = input;

  // R2 — al menos un vendedor y un comprador
  const vendReales = (vendedores || []).filter(slotOcupado);
  const compReales = (compradores || []).filter(slotOcupado);
  if (vendReales.length === 0)
    out.push({
      nivel: "error", campo: "Vendedores", codigo_regla: "R2_sin_vendedores",
      explicacion: "No hay vendedores registrados.",
    });
  if (compReales.length === 0)
    out.push({
      nivel: "error", campo: "Compradores", codigo_regla: "R2_sin_compradores",
      explicacion: "No hay compradores registrados.",
    });

  // R1 — cada persona ocupada debe tener cédula (o NIT si es PJ)
  const check = (label: string, list: any[]) =>
    list.forEach((p, i) => {
      if (!slotOcupado(p)) return;
      const id = p.es_persona_juridica ? p.nit : p.numero_cedula;
      if (!id || !String(id).trim())
        out.push({
          nivel: "error",
          campo: `${label} ${i + 1}${p.nombre_completo ? ` (${p.nombre_completo})` : ""}`,
          codigo_regla: "R1_persona_sin_id",
          explicacion: p.es_persona_juridica
            ? "Falta NIT de la persona jurídica."
            : "Falta número de cédula.",
        });
    });
  check("Vendedor", vendedores || []);
  check("Comprador", compradores || []);

  // R3 — inmueble sin matrícula
  if (!inmueble?.matricula_inmobiliaria || !String(inmueble.matricula_inmobiliaria).trim())
    out.push({
      nivel: "error", campo: "Inmueble", codigo_regla: "R3_sin_matricula",
      explicacion: "Falta matrícula inmobiliaria.",
    });

  // R4 — cuantía
  const requiereCuantia = /compraventa|hipoteca/i.test(tipoActo || "");
  if (requiereCuantia) {
    const cv = Number(String(actos?.valor_compraventa || "").replace(/\D/g, "") || 0);
    if (/compraventa/i.test(tipoActo) && (!cv || cv <= 0))
      out.push({
        nivel: "error", campo: "Actos · Valor de compraventa",
        codigo_regla: "R4_cuantia_compraventa",
        explicacion: "El valor de la compraventa está vacío o en cero.",
      });
    if (actos?.es_hipoteca || /hipoteca/i.test(tipoActo)) {
      const vh = Number(String(actos?.valor_hipoteca || "").replace(/\D/g, "") || 0);
      if (!vh || vh <= 0)
        out.push({
          nivel: "error", campo: "Actos · Valor de hipoteca",
          codigo_regla: "R4_cuantia_hipoteca",
          explicacion: "El valor de la hipoteca está vacío o en cero.",
        });
    }
  }

  // R5 — CHIP en Bogotá / catastral fuera de Bogotá
  const idPredial = String(inmueble?.identificador_predial || "").trim();
  if (!idPredial) {
    if (isBogota(inmueble?.municipio))
      out.push({
        nivel: "advertencia", campo: "Inmueble · CHIP",
        codigo_regla: "R5_chip_faltante",
        explicacion: "En Bogotá el CHIP es obligatorio; está vacío.",
      });
    else
      out.push({
        nivel: "advertencia", campo: "Inmueble · Cédula catastral",
        codigo_regla: "R5_catastral_faltante",
        explicacion: "Falta cédula catastral del inmueble.",
      });
  }

  // R6 — lugar de expedición
  const sinLugar = [...(vendedores || []), ...(compradores || [])]
    .filter(slotOcupado)
    .filter((p) => !p.es_persona_juridica && !String(p.lugar_expedicion || "").trim());
  if (sinLugar.length > 0)
    out.push({
      nivel: "advertencia", campo: "Personas · Lugar de expedición",
      codigo_regla: "R6_lugar_expedicion",
      explicacion: `Falta lugar de expedición en ${sinLugar.length} persona(s).`,
    });

  // R7 — notaría del trámite
  if (notariaTramite) {
    const faltan: string[] = [];
    if (!String(notariaTramite.numero_notaria || "").trim()) faltan.push("número");
    if (!String(notariaTramite.circulo || "").trim()) faltan.push("círculo");
    if (!String(notariaTramite.nombre_notario || "").trim()) faltan.push("notario");
    if (faltan.length)
      out.push({
        nivel: "error", campo: "Datos de la notaría",
        codigo_regla: "R7_notaria_incompleta",
        explicacion: `Falta ${faltan.join(", ")} en los datos de la notaría del trámite.`,
      });
  }

  return out
    .sort((a, b) => SEV[a.nivel] - SEV[b.nivel])
    .slice(0, max);
}

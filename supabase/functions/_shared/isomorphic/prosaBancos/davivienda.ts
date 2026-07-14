// ============================================================================
// prosaBancos/davivienda — ISOMÓRFICO (Deno + Vite).
// Redacción canónica INMUTABLE del Banco Davivienda.
//
// Snapshot literal de los ejemplos oficiales (persona natural + persona
// jurídica) provistos por el equipo legal. Cualquier cambio requiere
// aprobación explícita del área jurídica + actualización de tests de
// snapshot/paridad (`__contract__/parity.test.ts` + `davivienda_test.ts` Deno).
//
// Este archivo es la ÚNICA fuente de verdad. La edge function
// `supabase/functions/_shared/prosaBancos/davivienda.ts` re-exporta desde aquí.
// ============================================================================

import { numeroConLetras, fechaProsa } from "./legalProse.ts";
import { describirConstitucionSociedad, describirCargoRL, fechaOTextoProsa } from "./prosaHelpers.ts";
import type { ProsaBancoTemplate, ProsaContext } from "./types.ts";

const NOMBRE_BANCO = "BANCO DAVIVIENDA S.A.";
const NIT_BANCO = "860.034.313-7";

const ESCRITURA_CONSTITUCION_BANCO =
  "escritura pública número tres mil ochocientos noventa y dos (3892) de fecha dieciséis (16) de octubre de mil novecientos setenta y dos (1972) otorgada en la Notaría Catorce (14) del Círculo de Bogotá D.C.";

function up(s?: string | null): string {
  return (s ?? "").toString().trim().toUpperCase();
}
function low(s?: string | null): string {
  return (s ?? "").toString().trim();
}
function nn(s?: string | null): boolean {
  return typeof s === "string" && s.trim().length > 0;
}
function collapseSpaces(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/ *\n+ */g, " ").trim();
}
function ced(s?: string | null): string {
  return (s ?? "").toString().replace(/\D/g, "");
}
function fechaOTexto(fecha?: string | null, fechaTexto?: string | null): string {
  if (nn(fecha)) {
    const p = fechaProsa(fecha!);
    if (p) return p;
  }
  if (nn(fechaTexto)) return fechaTexto!.trim().toLowerCase();
  return "";
}

function descripcionConstitucionSociedad(ctx: ProsaContext): string {
  const c = ctx.apoderado.sociedad_constitucion || {};
  const partes: string[] = [];

  if (nn(c.tipo_documento) || nn(c.fecha) || nn(c.fecha_texto) || nn(c.numero)) {
    const docTipo = c.tipo_documento === "escritura_publica" ? "escritura pública" : "documento privado";
    const numTxt = nn(c.numero) ? `número ${numeroConLetras(c.numero!, "masculine")} ` : "";
    const fechaTxt = fechaOTexto(c.fecha, c.fecha_texto);
    if (fechaTxt) {
      partes.push(`sociedad constituida mediante ${docTipo} ${numTxt}del ${fechaTxt} de asamblea de accionistas`);
    } else {
      partes.push(`sociedad constituida mediante ${docTipo}${numTxt ? " " + numTxt.trim() : ""}`);
    }
  }

  if (nn(c.camara_comercio_ciudad) || nn(c.camara_comercio_fecha) || nn(c.camara_comercio_numero) || nn(c.libro)) {
    const cciu = nn(c.camara_comercio_ciudad) ? c.camara_comercio_ciudad!.trim().toLowerCase() : "";
    const cfecha = fechaOTexto(c.camara_comercio_fecha, null);
    const cnum = nn(c.camara_comercio_numero) ? c.camara_comercio_numero!.trim() : "";
    const libro = nn(c.libro) ? c.libro!.trim() : "";
    let s = `inscrita en la cámara de comercio${cciu ? " de " + cciu : ""}`;
    if (cfecha) s += ` el ${cfecha}`;
    if (cnum) s += ` bajo el número ${cnum}`;
    if (libro) s += ` del libro ${libro}`;
    partes.push(s);
  }

  if (nn(c.razon_social_anterior)) {
    let s = `se constituyó inicialmente como ${up(c.razon_social_anterior)}`;
    const actaNum = nn(c.reforma_acta_numero) ? ` número ${numeroConLetras(c.reforma_acta_numero!, "masculine")}` : "";
    const actaFecha = nn(c.reforma_acta_fecha_texto) ? ` del ${c.reforma_acta_fecha_texto!.trim().toLowerCase()}` : "";
    const camFecha = nn(c.reforma_camara_fecha_texto) ? ` el ${c.reforma_camara_fecha_texto!.trim().toLowerCase()}` : "";
    if (actaNum || actaFecha || camFecha) {
      s += `, posteriormente mediante acta${actaNum}${actaFecha} de asamblea de accionistas, inscrita en la Cámara de comercio${camFecha}, cambio su razón social por ${up(ctx.apoderado.sociedad_razon_social)}`;
    }
    partes.push(s);
  }

  return partes.join(", ");
}

/** Sufijo de notas adicionales del usuario (v5 Modal Híbrido). */
function notasSufijo(ctx: ProsaContext): string {
  const n = (ctx.notas_adicionales ?? "").trim();
  if (!n) return "";
  return ` ${n}`;
}

function comparecenciaNatural(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre);
  const cedula = ced(ctx.apoderado.cedula);
  const ciudadFirma = low(ctx.ciudad_firma) || "Bogotá";
  const escrituraTxt = nn(ctx.apoderado.escritura_poder_num)
    ? `escritura pública número ${numeroConLetras(ctx.apoderado.escritura_poder_num!, "masculine")}`
    : "escritura pública número ___________";
  const fechaTxt = fechaOTexto(ctx.apoderado.escritura_poder_fecha, null) || "___________";
  const notariaNum = nn(ctx.apoderado.escritura_poder_notaria_num)
    ? numeroConLetras(ctx.apoderado.escritura_poder_notaria_num!, "feminine")
    : "___________";

  const s = `COMPARECIÓ: ${nombre}, colombiana, mayor de edad, domiciliada y residente de ${ciudadFirma}, identificada con la cédula de ciudadanía número ${cedula || "___________"}, manifestó: PRIMERO.- Que en su calidad de APODERADA GENERAL del ${NOMBRE_BANCO} NIT: ${NIT_BANCO}, establecimiento Bancario con domicilio principal en la ciudad de ${ciudadFirma}. En virtud del poder general a el otorgado mediante ${escrituraTxt} del ${fechaTxt} otorgada en la notaría ${notariaNum} de ${ciudadFirma}, documento cuya copia se presenta para su protocolización con este instrumento público.${notasSufijo(ctx)}`;
  return collapseSpaces(s);
}

function comparecenciaJuridica(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre) || up((ctx.apoderado.representantes ?? [])[0]?.nombre);
  const cedula = ced(ctx.apoderado.cedula) || ced((ctx.apoderado.representantes ?? [])[0]?.cedula);
  const razonSocial = up(ctx.apoderado.sociedad_razon_social);
  const nitSociedad = ctx.apoderado.sociedad_nit?.trim() || "___________";
  const constitucion = descripcionConstitucionSociedad(ctx);

  const rlBancoNombre = up(ctx.poderdante.representante_legal_nombre) || "___________";
  const rlBancoCed = ced(ctx.poderdante.representante_legal_cedula) || "___________";
  const rlBancoCiu = low(ctx.poderdante.representante_legal_cedula_expedida_en) || "Bogotá D.C.";
  const rlBancoCargo = low(ctx.poderdante.representante_legal_cargo).toLowerCase() || "representante legal";

  const escrituraPoderNum = nn(ctx.instrumento.escritura_num)
    ? numeroConLetras(ctx.instrumento.escritura_num!, "masculine")
    : "___________";
  const escrituraPoderFecha = fechaOTexto(ctx.instrumento.fecha, ctx.instrumento.fecha_texto) || "___________";
  const notariaPoderNum = nn(ctx.instrumento.notaria_numero)
    ? numeroConLetras(ctx.instrumento.notaria_numero!, "feminine")
    : "___________";
  const notariaPoderCiu = low(ctx.instrumento.notaria_ciudad) || "Bogotá D.C.";
  const ciudadFirma = low(ctx.ciudad_firma) || "Bogotá D.C.";

  const s = `COMPARECIÓ: ${nombre || "___________"}, mayor de edad, vecino(a) y domiciliado(a) en la ciudad de ${ciudadFirma}, identificado(a) con la cédula de ciudadanía número ${cedula || "___________"}, manifestó: PRIMERO.- Que en su calidad de representante legal de la sociedad ${razonSocial || "___________"} con NIT. ${nitSociedad}${constitucion ? ", " + constitucion : ""}, sociedad que actúa como apoderada general del ${NOMBRE_BANCO}, NIT: ${NIT_BANCO}, establecimiento de crédito legalmente constituido, por ${ESCRITURA_CONSTITUCION_BANCO}, con domicilio principal en la ciudad de Bogotá D.C., como consta en el poder general conferido por el doctor ${rlBancoNombre}, mayor de edad, domiciliado en la ciudad de Bogotá D.C., identificado con cédula de ciudadanía número ${rlBancoCed} expedida en ${rlBancoCiu}, obrando en su condición de ${rlBancoCargo} y como tal representante legal del ${NOMBRE_BANCO}, mediante la escritura pública número ${escrituraPoderNum} del ${escrituraPoderFecha} otorgado en la Notaría ${notariaPoderNum} del Círculo de ${notariaPoderCiu}, cuya copia se protocoliza en el presente instrumento.${notasSufijo(ctx)}`;
  return collapseSpaces(s);
}

function antefirmaNatural(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre) || "___________";
  const cedula = ced(ctx.apoderado.cedula) || "___________";
  return collapseSpaces(
    `${nombre}\nC.C. No.${cedula}\nAPODERADO GENERAL DE ${NOMBRE_BANCO} – NIT. ${NIT_BANCO}`
      .replace(/\n/g, " \n "),
  ).replace(/\s+\n\s+/g, "\n");
}

function antefirmaJuridica(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre) || up((ctx.apoderado.representantes ?? [])[0]?.nombre) || "___________";
  const cedula = ced(ctx.apoderado.cedula) || ced((ctx.apoderado.representantes ?? [])[0]?.cedula) || "___________";
  const razonSocial = up(ctx.apoderado.sociedad_razon_social) || "___________";
  const nitSociedad = ctx.apoderado.sociedad_nit?.trim() || "___________";
  return `${nombre}\nC.C. No.${cedula}\nEn calidad de representante legal de la sociedad ${razonSocial} con NIT. ${nitSociedad} sociedad que a su vez obra en calidad de apoderada general de ${NOMBRE_BANCO}, NIT: ${NIT_BANCO}`;
}

function notaAutorizacionNatural(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre) || "___________";
  return collapseSpaces(
    `El Suscrito Notario en uso de las atribuciones contempladas en el Artículo doce (12) del Decreto dos mil ciento cuarenta y ocho (2148) de mil novecientos ochenta y tres (1983) y en virtud que ${nombre}, APODERADA GENERAL, tiene registrada su firma en esta Notaría AUTORIZA que el presente instrumento sea suscrito por la persona fuera del recinto notarial en las oficinas de la entidad que representa.`,
  );
}

function notaAutorizacionJuridica(ctx: ProsaContext): string {
  const nombre = up(ctx.apoderado.nombre) || up((ctx.apoderado.representantes ?? [])[0]?.nombre) || "___________";
  const razonSocial = up(ctx.apoderado.sociedad_razon_social) || "___________";
  const nitSociedad = ctx.apoderado.sociedad_nit?.trim() || "___________";
  return collapseSpaces(
    `El Suscrito Notario en uso de las atribuciones contempladas en el Artículo doce (12) del Decreto dos mil ciento cuarenta y ocho (2148) de mil novecientos ochenta y tres (1983) y en virtud que ${nombre}, en calidad de representante legal de la sociedad ${razonSocial} con NIT. ${nitSociedad} sociedad que a su vez obra en calidad de apoderada general de ${NOMBRE_BANCO}, NIT: ${NIT_BANCO}, tiene registrada su firma en esta Notaría AUTORIZA que el presente instrumento sea suscrito por la persona fuera del recinto notarial en las oficinas de la entidad que representa.`,
  );
}

function isJuridica(ctx: ProsaContext): boolean {
  return ctx.apoderado.tipo === "juridica" || ctx.apoderado.tipo_override === "juridica";
}

export const daviviendaTemplate: ProsaBancoTemplate = {
  nitBanco: NIT_BANCO,
  nitAliases: ["860034313-7", "8600343137", "860034313"],
  nombreBanco: NOMBRE_BANCO,
  renderComparecencia: (ctx) => (isJuridica(ctx) ? comparecenciaJuridica(ctx) : comparecenciaNatural(ctx)),
  renderAntefirma: (ctx) => (isJuridica(ctx) ? antefirmaJuridica(ctx) : antefirmaNatural(ctx)),
  renderNotaAutorizacion: (ctx) => (isJuridica(ctx) ? notaAutorizacionJuridica(ctx) : notaAutorizacionNatural(ctx)),
};

/**
 * clausulaBuilder — Redactor adaptativo de cláusulas notariales.
 *
 * Cada función devuelve un fragmento HTML (o "" para colapsar el bloque
 * cuando faltan datos críticos). Pensado para ser invocado tanto desde el
 * cliente (DocxPreview) como pre-computado en la Edge Function antes de
 * pasar el contexto a Gemini.
 */

import { escrituraProsa, fechaProsa, montoProsa } from "@/lib/legalProse";

// ── Tipos relajados (el shape real vive en src/lib/types.ts pero queremos
//    que los helpers funcionen también desde Deno con datos arbitrarios). ─

type AnyRec = Record<string, unknown>;

function s(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function asArrayReformas(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(s).filter(Boolean);
  const txt = s(raw);
  if (!txt) return [];
  return txt
    .split(/[\n;|]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ── Cláusula Primera: Identificación del inmueble ────────────────────────

export function buildClausulaIdentificacionInmueble(
  inmueble: AnyRec | null | undefined,
  _antecedentes?: AnyRec | null,
): string {
  if (!inmueble) return "";

  const direccion = s(inmueble.direccion);
  const matricula = s(inmueble.matricula_inmobiliaria);
  const chip = s(inmueble.identificador_predial);
  const municipio = s(inmueble.municipio);
  const departamento = s(inmueble.departamento);
  const coef = s(inmueble.coeficiente_copropiedad);

  const partes: string[] = [];
  if (direccion) partes.push(`<strong>UBICACIÓN DEL INMUEBLE:</strong> ${direccion}`);
  if (municipio || departamento) {
    const lugar = [municipio, departamento].filter(Boolean).join(", ");
    if (lugar) partes.push(`Ubicado en ${lugar}`);
  }
  const ids: string[] = [];
  if (matricula) ids.push(`folio de matrícula inmobiliaria número <strong>${matricula}</strong>`);
  if (chip) ids.push(`cédula catastral número <strong>${chip}</strong>`);
  if (coef) ids.push(`un coeficiente de copropiedad del <strong>${coef}</strong>`);
  if (ids.length) {
    partes.push(`A este inmueble le corresponde el ${ids.join(", la ")}.`);
  }

  if (!partes.length) return "";
  return `<p>${partes.join(". ")}</p>`;
}

// ── Parágrafo Primero: Régimen de Propiedad Horizontal ───────────────────

export function buildParagrafoRegimenPH(inmueble: AnyRec | null | undefined): string {
  if (!inmueble) return "";
  if (inmueble.es_propiedad_horizontal !== true) return "";

  const conjunto = s(inmueble.nombre_edificio_conjunto);
  const escritura = escrituraProsa({
    numero: inmueble.escritura_ph_numero as string,
    fecha: inmueble.escritura_ph_fecha as string,
    notariaNumero: inmueble.escritura_ph_notaria_numero as string,
    circulo: inmueble.escritura_ph_ciudad as string,
  });
  if (!escritura) return "";

  const reformas = asArrayReformas(inmueble.reformas_ph);
  const reformasProsa = reformas
    .map((r) => {
      // Si la reforma ya viene como string preformateado, lo embebemos tal cual.
      // Si fuese un objeto JSON serializado, también lo intentamos parsear.
      try {
        const obj = JSON.parse(r);
        return escrituraProsa({
          numero: obj.numero,
          fecha: obj.fecha,
          notariaNumero: obj.notariaNumero,
          circulo: obj.circulo,
        });
      } catch {
        return r;
      }
    })
    .filter((x): x is string => !!x);

  let texto =
    `<strong>PARÁGRAFO PRIMERO.- RÉGIMEN DE PROPIEDAD HORIZONTAL:</strong> ` +
    `El(los) inmueble(s) antes identificado(s) hace(n) parte del edificio, agrupación o conjunto` +
    (conjunto ? ` denominado <strong>${conjunto}</strong>` : "") +
    `, el cual fue sometido al Régimen de Propiedad Horizontal con el lleno de los requisitos legales, ` +
    `según consta en la ${escritura}`;

  for (const r of reformasProsa) {
    texto += `, y además reformado mediante ${r}`;
  }
  texto += ".";
  return `<p>${texto}</p>`;
}

// ── Cláusula Segunda: Procedencia (adquisición previa) ───────────────────

export function buildClausulaProcedencia(
  antecedentes: AnyRec | null | undefined,
  vendedorNombre: string,
): string {
  const vendedor = (s(vendedorNombre) || "EL VENDEDOR").toUpperCase();
  const titulo = (antecedentes?.titulo_antecedente as AnyRec | undefined) ?? antecedentes ?? {};

  const escritura = escrituraProsa({
    numero: (titulo.numero_documento ?? titulo.numero_escritura) as string,
    fecha: (titulo.fecha_documento ?? titulo.fecha) as string,
    notariaNumero: (titulo.notaria_numero ?? titulo.notaria_documento) as string,
    circulo: (titulo.ciudad_documento ?? titulo.circulo) as string,
  });

  const modo = s(titulo.tipo_documento ?? titulo.modo_adquisicion ?? "COMPRAVENTA").toUpperCase();
  const adquiridoDe = s(titulo.adquirido_de);

  if (!escritura) {
    return (
      `<p><strong>SEGUNDO.-</strong> El inmueble fue adquirido por <strong>${vendedor}</strong> ` +
      `mediante título previo cuya información se completará al momento del otorgamiento.</p>`
    );
  }

  let texto = `<strong>SEGUNDO.-</strong> El inmueble fue adquirido por <strong>${vendedor}</strong> por ${modo}`;
  if (adquiridoDe) texto += ` realizada a ${adquiridoDe.toUpperCase()}`;
  texto += `, mediante ${escritura}.`;
  return `<p>${texto}</p>`;
}

// ── Cláusula Cuarta: Precio y forma de pago ──────────────────────────────

export function buildClausulaPrecio(actos: AnyRec | null | undefined): string {
  if (!actos) return "";
  const precio = montoProsa(s(actos.valor_compraventa));
  if (!precio) return "";

  let texto = `<strong>CUARTO.-</strong> Que el precio de esta compraventa es la suma de ${precio} <strong>MONEDA CORRIENTE</strong>`;

  const esHipoteca = actos.es_hipoteca === true;
  const pagoInicial = montoProsa(s(actos.pago_inicial));
  const saldo = montoProsa(s(actos.saldo_financiado) || s(actos.valor_hipoteca));
  const banco = s(actos.entidad_bancaria);

  if (esHipoteca && (pagoInicial || saldo)) {
    texto += `, que se pagarán de la siguiente forma: `;
    if (pagoInicial) {
      texto += `<strong>a)</strong> La suma de ${pagoInicial} <strong>MONEDA CORRIENTE</strong>, que LA PARTE COMPRADORA ha entregado a LA PARTE VENDEDORA y este declara recibidos a satisfacción. `;
    }
    if (saldo) {
      texto += `<strong>b)</strong> El saldo, es decir la suma de ${saldo} <strong>MONEDA CORRIENTE</strong>, que LA PARTE COMPRADORA entregará a LA PARTE VENDEDORA con el producto de un préstamo que para tal fin tramita ante ${banco ? `el <strong>${banco.toUpperCase()}</strong>` : "la entidad financiera respectiva"}.`;
    }
  } else {
    texto += `, que LA PARTE COMPRADORA ha entregado a LA PARTE VENDEDORA y este declara recibidos a satisfacción.`;
  }
  return `<p>${texto}</p>`;
}

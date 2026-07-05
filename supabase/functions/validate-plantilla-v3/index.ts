// ============================================================================
// validate-plantilla-v3 — Edge function EFÍMERA (Plan v7)
// Valida la plantilla `davivienda/formato cancelacion hipoteca v3.docx`:
//   - ?mode=inspect          → OOXML + tags canónicos + huérfanos
//   - ?mode=render-natural   → Render Docxtemplater con prosa Natural
//   - ?mode=render-juridica  → Render Docxtemplater con prosa Jurídica
//
// DESTRUIR tras entregar el reporte. No forma parte del runtime productivo.
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import PizZip from "npm:pizzip@3.1.7";
import Docxtemplater from "npm:docxtemplater@3.50.0";

import { getProsaBanco } from "../_shared/prosaBancos/index.ts";
import type { ProsaContext } from "../_shared/prosaBancos/types.ts";

const BUCKET = "cancelaciones-plantillas";
const TEMPLATE_PATH = "davivienda/formato cancelacion hipoteca v3.docx";
const DAVIVIENDA_NIT = "860.034.313-7";

// Catálogo de tags conocidos — copia literal del subset de DOCX_FIELD_MAP
// (edge functions no importan desde src/). Solo se usa para detectar huérfanos.
const KNOWN_TAGS = new Set<string>([
  "notaria_numero","notaria_numero_letras","notaria_numero_letras_lower","notaria_numero_letras_femenino",
  "notaria_ordinal","notaria_circulo","notaria_circulo_proper","notaria_departamento",
  "notario_nombre","notario_decreto","notario_tipo","escritura_numero","fecha_escritura_corta",
  "matricula_inmobiliaria","cedula_catastral","direccion_inmueble","nombre_edificio_conjunto",
  "linderos_especiales","linderos_generales","coeficiente_letras","coeficiente_numero",
  "municipio_inmueble","departamento_inmueble","orip_ciudad",
  "inmueble.orip_zona","inmueble.predial_anio","inmueble.predial_num","inmueble.predial_valor",
  "inmueble.idu_num","inmueble.idu_fecha","inmueble.idu_vigencia",
  "inmueble.admin_fecha","inmueble.admin_vigencia","inmueble.es_rph","inmueble.estrato","inmueble.nupre",
  "actos.cuantia_compraventa_letras","actos.cuantia_compraventa_numero",
  "actos.cuantia_hipoteca_letras","actos.cuantia_hipoteca_numero",
  "actos.entidad_bancaria","actos.entidad_nit","actos.entidad_domicilio",
  "actos.pago_inicial_letras","actos.pago_inicial_numero",
  "actos.saldo_financiado_letras","actos.saldo_financiado_numero",
  "actos.fecha_escritura_letras",
  "actos.credito_dia_letras","actos.credito_dia_num","actos.credito_mes",
  "actos.credito_anio_letras","actos.credito_anio_num",
  "actos.afectacion_vivienda","actos.redam_resultado",
  "vendedores","compradores",
  "nombre","cedula","expedida_en","estado_civil","domicilio","direccion_residencia",
  "telefono","actividad_economica","email","es_pep","acepta_notificaciones",
  "antecedentes.modo","antecedentes.adquirido_de",
  "antecedentes.escritura_num_letras","antecedentes.escritura_num_numero",
  "antecedentes.escritura_dia_letras","antecedentes.escritura_dia_num","antecedentes.escritura_mes",
  "antecedentes.escritura_anio_letras","antecedentes.escritura_anio_num",
  "antecedentes.notaria_previa_numero","antecedentes.notaria_previa_circulo",
  "rph.escritura_num_letras","rph.escritura_num_numero",
  "rph.escritura_dia_letras","rph.escritura_dia_num","rph.escritura_mes",
  "rph.escritura_anio_letras","rph.escritura_anio_num",
  "rph.notaria_numero","rph.notaria_ciudad","rph.matricula_matriz",
  "apoderado_banco.nombre","apoderado_banco.cedula","apoderado_banco.expedida_en",
  "apoderado_banco.escritura_poder_num",
  "apoderado_banco.poder_dia_letras","apoderado_banco.poder_dia_num","apoderado_banco.poder_mes",
  "apoderado_banco.poder_anio_letras","apoderado_banco.poder_anio_num",
  "apoderado_banco.notaria_poder_num","apoderado_banco.notaria_poder_ciudad","apoderado_banco.email",
  "comparecencia_prosa","antefirma_prosa","nota_autorizacion_prosa",
  "tiene_hipoteca","has_hipoteca","has_credito","has_apoderado_banco","has_antecedente",
  "has_afectacion_familiar","has_predial","has_coeficiente","has_carta_credito",
  "has_ph","has_linderos","has_linderos_especiales","has_linderos_generales",
  "matricula","chip","identificador_predial","estrato","nupre",
  "valor_compraventa_letras","valor_hipoteca_letras","entidad_bancaria","banco_nombre",
  "banco_nit","entidad_nit","entidad_domicilio","afectacion_vivienda",
  "ubicacion_inmueble","ubicacion_predio","inmueble_nombre",
  // Loop scopes
  "vendedor","comprador","persona","representante","representantes",
]);

// ── Normalización de runs Word (lógica embebida de docxRunNormalizer) ──
// Word puede fragmentar `{comparecencia_prosa}` en múltiples <w:r>/<w:t> por
// cambios de formato invisibles. Concatenamos texto plano ignorando runs.
function extractPlainTextFromDocumentXml(xml: string): string {
  // Extrae todos los <w:t ...>texto</w:t> en orden y los concatena.
  // Preserva `xml:space="preserve"` implícitamente porque el contenido va tal cual.
  const matches = xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
  const parts: string[] = [];
  for (const m of matches) {
    parts.push(
      m[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"),
    );
  }
  return parts.join("");
}

function extractDocxtemplaterTags(plainText: string): string[] {
  const set = new Set<string>();
  // Ignoramos secciones/loops ({#tag}, {/tag}) para el reporte de huérfanos.
  const re = /\{([#/^]?)([^{}]+?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plainText)) !== null) {
    const tag = m[2].trim();
    if (tag.length === 0) continue;
    set.add(tag);
  }
  return [...set].sort();
}

function buildContextNatural(): ProsaContext {
  return {
    apoderado: {
      tipo: "natural",
      nombre: "ANA MARIA MONTOYA ECHEVERRY",
      cedula: "41939243",
      escritura_poder_num: "7364",
      escritura_poder_fecha: "2023-05-26",
      escritura_poder_notaria_num: "29",
    },
    poderdante: {},
    instrumento: {},
    ciudad_firma: "Bogotá",
  };
}

function buildContextJuridica(): ProsaContext {
  return {
    apoderado: {
      tipo: "juridica",
      nombre: "LINA MAGALY CAMPOS LOSADA",
      cedula: "55069433",
      sociedad_razon_social: "CONECTIVA GLOBAL S.A.S.",
      sociedad_nit: "900.666.582-8",
      sociedad_constitucion: {
        tipo_documento: "documento_privado",
        fecha: "2013-10-18",
        fecha_texto: "dieciocho (18) de octubre de dos mil trece (2013)",
        camara_comercio_ciudad: "BOGOTA",
        camara_comercio_fecha: "2013-10-21",
        camara_comercio_numero: "01775236",
        libro: "IX",
        razon_social_anterior: "PROYECTOS LEGALES S.A.S.",
        reforma_acta_numero: "3",
        reforma_acta_fecha_texto: "doce (12) de diciembre de dos mil veintitrés (2023)",
        reforma_camara_fecha_texto: "veinticuatro (24) de julio de dos mil veinticinco (2025)",
      },
    },
    poderdante: {
      representante_legal_nombre: "FELIX ROZO CAGUA",
      representante_legal_cedula: "79382406",
      representante_legal_cargo: "SUPLENTE DEL PRESIDENTE",
      representante_legal_cedula_expedida_en: "Bogotá D.C.",
    },
    instrumento: {
      escritura_num: "16390",
      fecha: "2025-09-18",
      notaria_numero: "29",
      notaria_ciudad: "Bogotá D.C.",
    },
    ciudad_firma: "Bogotá D.C.",
  };
}

async function downloadTemplate(): Promise<Uint8Array> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase.storage.from(BUCKET).download(TEMPLATE_PATH);
  if (error || !data) throw new Error(`Download failed: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

function inspect(bytes: Uint8Array) {
  let ooxml_ok = false;
  let zip: PizZip | null = null;
  const errors: string[] = [];
  try {
    zip = new PizZip(bytes);
    const doc = zip.file("word/document.xml");
    const ctypes = zip.file("[Content_Types].xml");
    ooxml_ok = !!doc && !!ctypes;
    if (!doc) errors.push("Missing word/document.xml");
    if (!ctypes) errors.push("Missing [Content_Types].xml");
  } catch (e) {
    errors.push(`PizZip failure: ${(e as Error).message}`);
    return { ooxml_ok: false, errors, tags: [], canonical: {}, orphans: [] };
  }

  const xml = zip!.file("word/document.xml")!.asText();
  const plain = extractPlainTextFromDocumentXml(xml);
  const tags = extractDocxtemplaterTags(plain);

  const canonical = {
    comparecencia_prosa: tags.includes("comparecencia_prosa"),
    antefirma_prosa: tags.includes("antefirma_prosa"),
    nota_autorizacion_prosa: tags.includes("nota_autorizacion_prosa"),
  };
  const orphans = tags.filter((t) => !KNOWN_TAGS.has(t));
  return { ooxml_ok, errors, tags, canonical, orphans, plain_snippet_len: plain.length };
}

function render(bytes: Uint8Array, ctx: ProsaContext) {
  const template = getProsaBanco(DAVIVIENDA_NIT);
  if (!template) throw new Error("Davivienda template not found in registry");
  const comparecencia = template.renderComparecencia(ctx);
  const antefirma = template.renderAntefirma(ctx);
  const nota = template.renderNotaAutorizacion(ctx);

  const zip = new PizZip(bytes);
  const docx = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "", // NullGetter estricto: variables ausentes → vacío
  });
  docx.render({
    comparecencia_prosa: comparecencia,
    antefirma_prosa: antefirma,
    nota_autorizacion_prosa: nota,
  });
  const outBytes = docx.getZip().generate({ type: "uint8array" });
  const outZip = new PizZip(outBytes);
  const outXml = outZip.file("word/document.xml")!.asText();
  const outPlain = extractPlainTextFromDocumentXml(outXml);

  const residualTags = extractDocxtemplaterTags(outPlain).filter(
    (t) => t === "comparecencia_prosa" || t === "antefirma_prosa" || t === "nota_autorizacion_prosa",
  );

  const requiredMarkers = ctx.apoderado.tipo === "juridica"
    ? [
        "BANCO DAVIVIENDA S.A.",
        "NIT: 860.034.313-7",
        "sociedad que actúa como apoderada general",
        "CONECTIVA GLOBAL S.A.S.",
        "FELIX ROZO CAGUA",
      ]
    : [
        "BANCO DAVIVIENDA S.A.",
        "NIT: 860.034.313-7",
        "APODERADA GENERAL",
        "ANA MARIA MONTOYA ECHEVERRY",
        "notaría veintinueve (29)",
      ];
  const markers: Record<string, boolean> = {};
  for (const m of requiredMarkers) markers[m] = outPlain.includes(m);

  const corruptEscapes =
    /&amp;amp;|&lt;|&gt;/.test(outPlain);

  const idx = outPlain.indexOf("BANCO DAVIVIENDA");
  const snippet = idx >= 0 ? outPlain.slice(Math.max(0, idx - 80), idx + 320) : outPlain.slice(0, 400);

  return {
    render_ok: residualTags.length === 0 && Object.values(markers).every(Boolean) && !corruptEscapes,
    residual_tags: residualTags,
    markers,
    corrupt_escapes: corruptEscapes,
    prosa_lengths: {
      comparecencia: comparecencia.length,
      antefirma: antefirma.length,
      nota: nota.length,
    },
    snippet,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "inspect";
    const bytes = await downloadTemplate();

    let result: unknown;
    if (mode === "inspect") result = inspect(bytes);
    else if (mode === "render-natural") result = render(bytes, buildContextNatural());
    else if (mode === "render-juridica") result = render(bytes, buildContextJuridica());
    else result = { error: `unknown mode: ${mode}` };

    return new Response(JSON.stringify({ mode, ...(result as object) }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message, stack: (e as Error).stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

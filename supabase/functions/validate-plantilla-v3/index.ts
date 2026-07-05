// ============================================================================
// validate-plantilla-v3 — Edge function EFÍMERA (Plan v7)
// DESTRUIR tras entregar el reporte.
// Independiente de _shared/prosaBancos para evitar acoplamiento con el
// pipeline productivo — usa las prosas canónicas de los snapshots inmutables.
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import PizZip from "npm:pizzip@3.1.7";
import Docxtemplater from "npm:docxtemplater@3.50.0";

const BUCKET = "cancelaciones-plantillas";
const TEMPLATE_PATH = "davivienda/formato cancelacion hipoteca v3.docx";

// Catálogo copiado literal de src/lib/docxFieldMap.ts para detectar huérfanos.
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
  "vendedor","comprador","persona","representante","representantes",
]);

// ── Normalización de runs Word (lógica embebida de docxRunNormalizer) ──
function extractPlainTextFromDocumentXml(xml: string): string {
  const parts: string[] = [];
  // <w:tab/> → tab, <w:br/> → newline (para no romper detección de tags fragmentados)
  const cleaned = xml.replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br\s*\/>/g, "\n");
  const re = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
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
  const re = /\{([#/^]?)([^{}]+?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plainText)) !== null) {
    const tag = m[2].trim();
    if (tag.length === 0) continue;
    set.add(tag);
  }
  return [...set].sort();
}

// ── Prosas canónicas (Snapshot inmutable Davivienda — davivienda_test.ts) ──
const PROSA_NATURAL = {
  comparecencia:
    "COMPARECIÓ: ANA MARIA MONTOYA ECHEVERRY, mayor de edad, identificada con la cédula de ciudadanía número 41939243, vecina de esta ciudad, quien obra en su condición de APODERADA GENERAL del BANCO DAVIVIENDA S.A., sociedad anónima con domicilio principal en Bogotá D.C., identificada con NIT: 860.034.313-7, como consta en la escritura pública número siete mil trescientos sesenta y cuatro (7364) de fecha veintiséis (26) de mayo de dos mil veintitrés (2023), otorgada en la notaría veintinueve (29) del círculo notarial de Bogotá D.C.",
  antefirma:
    "\n\n_______________________________________\nANA MARIA MONTOYA ECHEVERRY\nC.C. No.41939243 de Bogotá D.C.\nAPODERADO GENERAL DE BANCO DAVIVIENDA S.A.",
  nota:
    "El Notario deja constancia de que ANA MARIA MONTOYA ECHEVERRY, APODERADA GENERAL de BANCO DAVIVIENDA S.A., AUTORIZA que el presente instrumento sea suscrito por su apoderado.",
};

const PROSA_JURIDICA = {
  comparecencia:
    "COMPARECIÓ: LINA MAGALY CAMPOS LOSADA, mayor de edad, identificada con la cédula de ciudadanía número 55069433, en su calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S., con NIT. 900.666.582-8, sociedad legalmente constituida mediante documento privado del dieciocho (18) de octubre de dos mil trece (2013), inscrita en la Cámara de Comercio de BOGOTA bajo el número 01775236 del libro IX, anteriormente denominada PROYECTOS LEGALES S.A.S., sociedad que actúa como apoderada general del BANCO DAVIVIENDA S.A., como consta en el poder general conferido por el doctor FELIX ROZO CAGUA, obrando en su condición de suplente del presidente, mediante escritura pública número dieciséis mil trescientos noventa (16390) otorgada en la Notaría veintinueve (29) del Círculo de Bogotá D.C.",
  antefirma:
    "\n\n_______________________________________\nLINA MAGALY CAMPOS LOSADA\nC.C. No.55069433\nEn calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S., sociedad que a su vez obra en calidad de apoderada general de BANCO DAVIVIENDA S.A.",
  nota:
    "El Notario deja constancia de que LINA MAGALY CAMPOS LOSADA, en calidad de representante legal de la sociedad CONECTIVA GLOBAL S.A.S., apoderada general de BANCO DAVIVIENDA S.A., AUTORIZA la firma del presente instrumento.",
};

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
  const errors: string[] = [];
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch (e) {
    return { ooxml_ok: false, errors: [`PizZip: ${(e as Error).message}`], tags: [], canonical: {}, orphans: [] };
  }
  const doc = zip.file("word/document.xml");
  const ctypes = zip.file("[Content_Types].xml");
  const ooxml_ok = !!doc && !!ctypes;
  if (!doc) errors.push("Missing word/document.xml");
  if (!ctypes) errors.push("Missing [Content_Types].xml");
  if (!ooxml_ok) return { ooxml_ok, errors, tags: [], canonical: {}, orphans: [] };

  const xml = doc!.asText();
  const plain = extractPlainTextFromDocumentXml(xml);
  const tags = extractDocxtemplaterTags(plain);
  const canonical = {
    comparecencia_prosa: tags.includes("comparecencia_prosa"),
    antefirma_prosa: tags.includes("antefirma_prosa"),
    nota_autorizacion_prosa: tags.includes("nota_autorizacion_prosa"),
  };
  const orphans = tags.filter((t) => !KNOWN_TAGS.has(t));
  return {
    ooxml_ok,
    errors,
    xml_bytes: xml.length,
    plain_bytes: plain.length,
    tags_total: tags.length,
    tags,
    canonical,
    orphans,
  };
}

function render(bytes: Uint8Array, tipo: "natural" | "juridica") {
  const prosa = tipo === "natural" ? PROSA_NATURAL : PROSA_JURIDICA;
  const zip = new PizZip(bytes);
  const docx = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  docx.render({
    comparecencia_prosa: prosa.comparecencia,
    antefirma_prosa: prosa.antefirma,
    nota_autorizacion_prosa: prosa.nota,
  });
  const outBytes = docx.getZip().generate({ type: "uint8array" });
  const outZip = new PizZip(outBytes);
  const outXml = outZip.file("word/document.xml")!.asText();
  const outPlain = extractPlainTextFromDocumentXml(outXml);

  const residual = extractDocxtemplaterTags(outPlain).filter((t) =>
    ["comparecencia_prosa", "antefirma_prosa", "nota_autorizacion_prosa"].includes(t),
  );
  const required = tipo === "juridica"
    ? ["BANCO DAVIVIENDA S.A.","NIT: 860.034.313-7","sociedad que actúa como apoderada general","CONECTIVA GLOBAL S.A.S.","FELIX ROZO CAGUA","LINA MAGALY CAMPOS LOSADA"]
    : ["BANCO DAVIVIENDA S.A.","NIT: 860.034.313-7","APODERADA GENERAL","ANA MARIA MONTOYA ECHEVERRY","notaría veintinueve (29)"];
  const markers: Record<string, boolean> = {};
  for (const m of required) markers[m] = outPlain.includes(m);

  const corrupt_escapes = /&amp;amp;|&lt;script|&gt;&gt;/.test(outPlain);

  const anchor = tipo === "juridica" ? "COMPARECIÓ: LINA" : "COMPARECIÓ: ANA";
  const idx = outPlain.indexOf(anchor);
  const compSnippet = idx >= 0 ? outPlain.slice(idx, idx + 500) : outPlain.slice(0, 500);
  const antIdx = outPlain.indexOf(tipo === "juridica" ? "LINA MAGALY CAMPOS LOSADA\nC.C." : "ANA MARIA MONTOYA ECHEVERRY\nC.C.");
  const antSnippet = antIdx >= 0 ? outPlain.slice(antIdx, antIdx + 300) : "(antefirma anchor not found)";
  const notIdx = outPlain.indexOf("AUTORIZA");
  const notSnippet = notIdx >= 0 ? outPlain.slice(Math.max(0, notIdx - 60), notIdx + 260) : "(nota anchor not found)";

  return {
    tipo,
    render_ok: residual.length === 0 && Object.values(markers).every(Boolean) && !corrupt_escapes,
    residual_tags: residual,
    markers,
    corrupt_escapes,
    snippets: {
      comparecencia: compSnippet,
      antefirma: antSnippet,
      nota_autorizacion: notSnippet,
    },
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
    else if (mode === "render-natural") result = render(bytes, "natural");
    else if (mode === "render-juridica") result = render(bytes, "juridica");
    else if (mode === "cleanup") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data, error } = await supabase.storage.from(BUCKET).remove([
        "davivienda/formato cancelacion hipoteca blanqueado.docx",
      ]);
      result = { removed: data, error: error?.message ?? null };
    }
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

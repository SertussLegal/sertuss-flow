import fs from "node:fs";
import PizZip from "pizzip";

const buf = fs.readFileSync("public/template_venta_hipoteca.docx");
const zip = new PizZip(buf);

const TARGET_FILE_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;
const PARA_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
const RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const TAG_RE = /\{[#/^]?[a-zA-Z0-9_.\-]+\}/g;

function decode(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function extractRunsText(paraXml) {
  const runs = [];
  let m;
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(paraXml)) !== null) {
    const xml = m[0];
    const openMatch = xml.match(/<w:t(?:\s[^>]*)?>/);
    if (!openMatch) continue;
    const start = openMatch.index + openMatch[0].length;
    const end = xml.indexOf("</w:t>", start);
    if (end < 0) continue;
    runs.push(decode(xml.slice(start, end)));
  }
  return runs;
}

const TAGS_OF_INTEREST = [
  "inmueble.matricula",
  "inmueble.matricula_inmobiliaria",
  "inmueble.cedula_catastral",
  "inmueble.chip",
  "inmueble.direccion",
  "inmueble.direccion_inmueble",
  "matricula_inmobiliaria",
  "matricula",
  "cedula_catastral",
  "chip",
  "direccion_inmueble",
];

const fragmented = [];
const crossPara = [];
const intactInteresting = [];
const allTagsFound = new Set();

for (const fileName of Object.keys(zip.files).filter((n) => TARGET_FILE_RE.test(n))) {
  const xml = zip.file(fileName).asText();
  let pIdx = -1;
  let m;
  PARA_RE.lastIndex = 0;
  while ((m = PARA_RE.exec(xml)) !== null) {
    pIdx++;
    const paraXml = m[0];
    const runs = extractRunsText(paraXml);
    const concat = runs.join("");

    // owners map
    const owners = [];
    runs.forEach((r, idx) => { for (let i = 0; i < r.length; i++) owners.push(idx); });

    TAG_RE.lastIndex = 0;
    let t;
    while ((t = TAG_RE.exec(concat)) !== null) {
      const raw = t[0];
      const name = raw.replace(/^\{[#/^]?/, "").replace(/\}$/, "");
      allTagsFound.add(name);
      const startRun = owners[t.index];
      const endRun = owners[t.index + raw.length - 1];
      if (startRun !== endRun) {
        fragmented.push({ file: fileName, p: pIdx, tag: name, raw, runs: endRun - startRun + 1 });
      } else if (TAGS_OF_INTEREST.includes(name)) {
        intactInteresting.push({ file: fileName, p: pIdx, tag: name });
      }
    }

    // cross-paragraph: `{` huérfano sin `}` al final
    const trimmed = concat.replace(/\s+$/, "");
    const orphan = trimmed.match(/\{[#/^]?[a-zA-Z0-9_.\-]*$/);
    if (orphan && !trimmed.endsWith("}")) {
      crossPara.push({ file: fileName, p: pIdx, hint: orphan[0].slice(-50) });
    }
  }
}

console.log("=== TAGS DE INTERÉS (matrícula / catastral / dirección) ===");
const interest = [...fragmented.filter(f => TAGS_OF_INTEREST.includes(f.tag)), ...intactInteresting];
if (interest.length === 0) console.log("  (ninguno encontrado en la plantilla)");
for (const i of interest) {
  const status = "runs" in i ? `❌ FRAGMENTADO (${i.runs} runs)` : "✅ intacto (1 run)";
  console.log(`  ${status}  ${i.tag}  @ ${i.file}#p${i.p}`);
}

console.log("\n=== TODOS LOS TAGS FRAGMENTADOS (cualquier tag) ===");
if (fragmented.length === 0) console.log("  ✅ Ninguno. Plantilla limpia a nivel de runs.");
for (const f of fragmented.slice(0, 50)) {
  console.log(`  ❌ {${f.tag}}  · ${f.runs} runs · ${f.file}#p${f.p}`);
}
if (fragmented.length > 50) console.log(`  ... (+${fragmented.length - 50} más)`);

console.log("\n=== TAGS PARTIDOS ENTRE PÁRRAFOS (cross-paragraph) ===");
console.log("    ⚠️  Estos SÍ requieren edición manual en Word — el normalizer no los puede arreglar.");
if (crossPara.length === 0) console.log("  ✅ Ninguno.");
for (const c of crossPara.slice(0, 30)) {
  console.log(`  ⚠️  "${c.hint}"  · ${c.file}#p${c.p}`);
}

console.log("\n=== RESUMEN ===");
console.log(`  Total tags únicos en plantilla: ${allTagsFound.size}`);
console.log(`  Fragmentados (rescatables por normalizer): ${fragmented.length}`);
console.log(`  Partidos entre párrafos (requieren edición manual): ${crossPara.length}`);

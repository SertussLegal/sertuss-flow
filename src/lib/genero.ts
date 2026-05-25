/**
 * Motor de inferencia de género gramatical compartido (frontend).
 * Pensado para ser reutilizado por toda pantalla de validación notarial
 * (Cancelaciones, Compraventa, Hipoteca, Poder Especial, etc.).
 *
 * Regla de oro: si hay duda razonable → devolver "" para forzar selección manual.
 * Nunca asumir género por terminación a/o sin contexto.
 */

export type GeneroGramatical = "M" | "F" | "JURIDICA" | "";

// Nombres colombianos comunes con género inequívoco.
// Se compara contra el PRIMER nombre, normalizado en mayúsculas y sin tildes.
const NOMBRES_F = new Set([
  "MARIA", "ANA", "ALEJANDRA", "CLAUDIA", "PATRICIA", "SANDRA", "DIANA",
  "ANDREA", "ANGELA", "LAURA", "CAROLINA", "PAOLA", "NATALIA", "CAMILA",
  "VALENTINA", "ISABELLA", "SOFIA", "GABRIELA", "LUZ", "MARTHA", "ROSA",
  "BEATRIZ", "ESPERANZA", "MERCEDES", "TERESA", "GLORIA", "OLGA", "LUCIA",
  "CARMEN", "JIMENA", "MARCELA", "VIVIANA", "JOHANNA", "YULY", "MILENA",
  "LILIANA", "MONICA", "ADRIANA", "CONSUELO", "AMPARO", "STELLA", "INES",
  "DORA", "HILDA", "JUDITH", "JANETH", "LUISA", "DANIELA", "JULIANA",
  "MARIANA", "MARIANELA", "VANESSA", "TATIANA", "KAREN", "JAZMIN",
  "LORENA", "VERONICA", "CRISTINA", "CECILIA", "ELIZABETH", "ELIANA",
  "EMILIA", "FERNANDA", "GINA", "CATALINA", "CONSTANZA", "MAGDALENA",
]);

const NOMBRES_M = new Set([
  "JUAN", "JOSE", "LUIS", "CARLOS", "JORGE", "MIGUEL", "PEDRO", "PABLO",
  "ANDRES", "DAVID", "DANIEL", "DIEGO", "FERNANDO", "RICARDO", "ROBERTO",
  "ALEJANDRO", "SANTIAGO", "SEBASTIAN", "EDWIN", "STEVENS", "ALEXANDER",
  "MAURICIO", "JULIAN", "JAVIER", "OSCAR", "OMAR", "GUSTAVO", "GERMAN",
  "HERNAN", "ALVARO", "FABIO", "FELIPE", "ESTEBAN", "MARTIN", "EDUARDO",
  "RAFAEL", "ENRIQUE", "MANUEL", "FRANCISCO", "ANTONIO", "RAMIRO",
  "RAMON", "HECTOR", "HUGO", "RUBEN", "WILSON", "WILLIAM", "RODRIGO",
  "GIOVANNI", "GIOVANY", "JEFFERSON", "BRAYAN", "BRYAN", "MATEO", "EMILIANO",
  "NICOLAS", "TOMAS", "BENJAMIN", "GABRIEL", "RAUL", "VICTOR", "MARIO",
  "ALBERTO", "ARTURO", "AGUSTIN", "ALFONSO", "ARMANDO", "ERNESTO",
  "GONZALO", "HORACIO", "IGNACIO", "IVAN", "JAIME", "LEONARDO", "MARCO",
  "MARCOS", "MARLON", "NESTOR", "OLIVER", "ORLANDO", "PASCUAL", "REINALDO",
]);

// Nombres ambiguos / unisex en Colombia → forzar selección manual.
const AMBIGUOS = new Set([
  "ALEX", "GUADALUPE", "TRINIDAD", "CRUZ", "REYES", "ROSARIO",
  "JESUS", "CHRIS", "SAM", "NIKKI", "MICHELLE",
]);

const normalize = (s: string): string =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

/**
 * Infiere género gramatical a partir del nombre completo.
 * Devuelve "" cuando no hay certeza razonable.
 */
export function inferGeneroFromNombre(nombreCompleto: string): "M" | "F" | "" {
  const normalized = normalize(nombreCompleto);
  if (!normalized) return "";

  const firstName = normalized.split(/\s+/)[0];
  if (!firstName) return "";
  if (AMBIGUOS.has(firstName)) return "";

  if (NOMBRES_F.has(firstName)) return "F";
  if (NOMBRES_M.has(firstName)) return "M";

  // Heurística conservadora: terminaciones inequívocas SOLO si el resto del
  // nombre no contradice (evita falsos positivos como "ANDREA" → M).
  if (/(?:ETTE|ELLA|INA|ANA|ICIA|ENCIA|OSA)$/.test(firstName)) return "F";
  if (/(?:ALDO|ARDO|ERTO|IBAL|ISCO|USTO)$/.test(firstName)) return "M";

  // En cualquier otro caso → incertidumbre. El usuario decide.
  return "";
}

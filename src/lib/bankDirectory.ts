/**
 * Directorio de bancos colombianos principales.
 * Permite autocompletar NIT y domicilio cuando el OCR detecta el nombre del banco.
 */

export interface BankInfo {
  nit: string;
  domicilio: string;
}

const BANK_DIRECTORY: Record<string, BankInfo> = {
  "BANCO DE BOGOTA": { nit: "860.002.964-4", domicilio: "Bogotá D.C." },
  "BANCOLOMBIA": { nit: "890.903.938-8", domicilio: "Medellín" },
  "DAVIVIENDA": { nit: "860.034.313-7", domicilio: "Bogotá D.C." },
  "BBVA COLOMBIA": { nit: "860.003.020-1", domicilio: "Bogotá D.C." },
  "BANCO DE OCCIDENTE": { nit: "890.300.279-4", domicilio: "Cali" },
  "BANCO POPULAR": { nit: "860.007.738-9", domicilio: "Bogotá D.C." },
  "BANCO AV VILLAS": { nit: "860.035.827-5", domicilio: "Bogotá D.C." },
  "SCOTIABANK COLPATRIA": { nit: "860.034.594-0", domicilio: "Bogotá D.C." },
  "BANCO ITAU": { nit: "890.903.937-0", domicilio: "Bogotá D.C." },
  "BANCO CAJA SOCIAL": { nit: "860.007.335-4", domicilio: "Bogotá D.C." },
  "BANCO AGRARIO": { nit: "800.037.800-8", domicilio: "Bogotá D.C." },
  "BANCO GNB SUDAMERIS": { nit: "860.050.750-1", domicilio: "Bogotá D.C." },
  "BANCO PICHINCHA": { nit: "890.200.756-7", domicilio: "Bogotá D.C." },
  "BANCO SERFINANZA": { nit: "860.043.186-6", domicilio: "Barranquilla" },
  "BANCO W": { nit: "900.378.212-2", domicilio: "Cali" },
  "BANCO FALABELLA": { nit: "900.047.981-8", domicilio: "Bogotá D.C." },
  "BANCO FINANDINA": { nit: "860.051.894-6", domicilio: "Bogotá D.C." },
};

/**
 * Normaliza un nombre de banco para comparación:
 *  - Quita acentos, mayúsculas, espacios redundantes.
 *  - Quita sufijos comerciales (S.A., S.A.S, LTDA, S.A.S., E.U.).
 *  - Quita prefijos genéricos como "BANCO " para fuzzy "DE BOGOTA" ⇄ "BOGOTA".
 */
function normalizeBankName(raw: string): string {
  if (!raw) return "";
  let n = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  // Quitar sufijos comerciales (con o sin puntos).
  n = n.replace(/\b(S\.?A\.?S\.?|S\.?A\.?|LTDA\.?|E\.?U\.?|S\.?A\.?S)\b\.?/g, "");
  // Normalizar espacios y signos.
  n = n.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Busca un banco por nombre. Devuelve `null` si no hay match razonable.
 * El caller DEBE usar el resultado solo para complementar NIT/domicilio
 * si esos campos vienen vacíos. JAMÁS sobrescribe el nombre extraído.
 */
export function lookupBank(name: string): BankInfo | null {
  if (!name) return null;
  const normalized = normalizeBankName(name);
  if (!normalized) return null;

  // Exact normalized match
  if (BANK_DIRECTORY[normalized]) return BANK_DIRECTORY[normalized];

  // Fuzzy: contención bidireccional sobre formas normalizadas.
  for (const [key, info] of Object.entries(BANK_DIRECTORY)) {
    const normKey = normalizeBankName(key);
    if (!normKey) continue;
    if (normalized === normKey) return info;
    if (normalized.includes(normKey) || normKey.includes(normalized)) return info;
  }

  return null;
}

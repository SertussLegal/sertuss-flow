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
 * Busca un banco por nombre usando matching fuzzy (includes).
 * Normaliza a mayúsculas y elimina acentos para mejor coincidencia.
 */
export function lookupBank(name: string): BankInfo | null {
  if (!name) return null;
  const normalized = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  // Exact match first
  if (BANK_DIRECTORY[normalized]) return BANK_DIRECTORY[normalized];

  // Fuzzy: check if any key is contained in the name or vice versa
  for (const [key, info] of Object.entries(BANK_DIRECTORY)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return info;
    }
  }

  return null;
}

// ============================================================================
// pdfSha256 — Helper para huella digital determinista de PDFs subidos al
// bucket `expediente-files`. Usado como clave de caché en `ocr_raw_cache`.
//
// El SHA-256 se computa sobre el binario crudo del PDF original — NO sobre
// las páginas renderizadas como JPEG. Esto garantiza que dos cargas del
// mismo PDF (independientemente del orden o cantidad de páginas extraídas)
// produzcan exactamente la misma huella.
// ============================================================================

/**
 * Calcula SHA-256 hexadecimal de un buffer arbitrario usando WebCrypto
 * nativo de Deno. Salida: string de 64 caracteres hex en minúscula.
 */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer to satisfy BufferSource (rejects SharedArrayBuffer).
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

/**
 * Para el caso "no tengo el PDF original sino solo las páginas JPEG":
 * concatena los blobs ordenados por nombre y hace SHA-256 del resultado.
 * Es estable mientras las páginas se nombren consistentemente
 * (p01.png, p02.png, ...). Esto reproduce la huella del MISMO PDF subido
 * dos veces por el flujo `pdfToImages` con el mismo `maxPages`.
 */
export async function sha256OfOrderedBlobs(blobs: Uint8Array[]): Promise<string> {
  const total = blobs.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const b of blobs) {
    merged.set(b, offset);
    offset += b.byteLength;
  }
  return await sha256Hex(merged);
}

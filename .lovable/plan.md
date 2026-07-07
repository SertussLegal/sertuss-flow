
# Verificación con evidencia real — fixes B3 (poder v6) y A2 (minuta Alejandra)

Investigación de solo lectura sobre BD y storage. Ninguna prueba sintética. Reporto lo que la evidencia sostiene y lo que no.

---

## 1. ¿Los documentos originales de Alejandra siguen disponibles?

**Parcialmente.** Consulta a `storage.objects` (bucket `expediente-files`) y a `cancelaciones`:

- Alejandra (`malejaarciniegas@gmail.com`, org `ALEJANDRA ARCINIEGAS ABOGADA`) tiene **10 cancelaciones** entre 2026-05-21 y 2026-06-24 (6 completed + 4 draft). Ninguna posterior al 24 de junio.
- Los PDFs originales NO se persisten — solo se guardan los JPEGs de páginas rasterizadas por `pdfToImages`. Los `.opus` de WhatsApp y los `.docx` adjuntos vía chat (incluido `ESCRITURA_2924.docx`) NO están en ningún bucket. Los adjuntos de chat no son descargables retroactivamente por esta herramienta.
- Sí sobreviven, como JPEGs, las páginas del poder que Alejandra subió el 2026-06-24 (cancelación `4b05d210-...`): 25 páginas bajo `4b05d210.../cancelaciones/soportes/poder/p01..p25.jpg`. **Anomalía: las 25 páginas pesan exactamente 12.192 bytes cada una**, lo que sugiere que todas se renderizaron idénticas (probablemente placeholder/error de rasterizado del cliente). Es decir, el "archivo original" superviviente probablemente no es fiel al PDF que ella cargó.
- El poder de la cancelación Sertuss `290fd66a-...` (2026-07-06, 20 páginas, tamaños 150K–280K) sí es contenido real.

**No hay copia limpia del PDF original de Alejandra para re-procesar de forma fiel.** Reprocesar los JPEGs corruptos no probaría nada útil sobre el fix.

## 2. ¿El pipeline v6 del poder está realmente activo en producción?

**No, según la evidencia en BD.** Esto es lo más importante del reporte:

- `ocr_raw_cache` tiene **0 filas**. Cero. El wrapper `runWithPoderCache` (`supabase/functions/_shared/poderBancoCache.ts`) nunca ha escrito. Consistente con `POWER_V5_ENABLED` desactivado por defecto (ver `poderBancoSchemaVersion.ts`, línea final: `Deno.env.get("POWER_V5_ENABLED") ?? "false"`).
- Las **2 únicas** cancelaciones con `data_ia.poder_banco` no vacío usan schema **LEGACY plano** (`apoderado_nombre`, `apoderado_cedula`, `apoderado_escritura`, `apoderado_notaria_poder`, `apoderado_fecha`), NO el schema v6 anidado (`apoderados[]`, `total_paginas`, `schema_version`).
  - `4b05d210` (Alejandra, 2026-06-24, 25 pág): `apoderado_nombre = MARIA CAMILA PEÑA RAMÍREZ` — devolvió datos pese a que los JPEGs son sospechosos.
  - `290fd66a` (Sertuss, 2026-07-06, 20 pág): `apoderado_nombre = FELIX REUZE CAÑAS`.
- No hay ninguna cancelación con `apoderados[]`, `total_paginas`, ni marcador `poder_banco_v6`.

**El fix v6 existe en código pero no está corriendo en producción.** Fue diseñado, escrito, testeado unitariamente, y dejado detrás de un feature flag apagado. La flag nunca se activó.

## 3. ¿Hay evidencia indirecta de casos post-fix con poder >25 páginas?

**No.** El único poder post-fix con datos completos es de 20 páginas (`290fd66a`, Sertuss). El único de Alejandra post-fix (`4b05d210`, 25 páginas) está en el límite del cap viejo y sus JPEGs son sospechosos. Ningún caso real de >25 páginas post-fix en BD.

## 4. Auditoría A2 de la minuta (mayo)

**No verificable directamente.** `ESCRITURA_2924.docx` no está en storage; las minutas generadas se guardan como `<uuid>/cancelaciones/minuta.docx` (13 en total). Podríamos abrir la minuta de las cancelaciones mayo/junio de Alejandra y verificar los 7 puntos de A2 (tabla "DATOS DE LA ESCRITURA", duplicado UBICACIÓN, linderos, formato TEXTO (NÚMERO), cuantía, etc.) contra el DOCX real. Eso sí sería evidencia real, aunque contra la minuta ya generada, no contra un re-procesamiento.

## 5. Nivel de certeza honesto

| Afirmación | Certeza |
|---|---|
| Los PDFs originales de Alejandra no son recuperables fielmente | **Alta** — storage confirma solo JPEGs, y los de 2026-06-24 son idénticos (12.192 B). |
| El pipeline v6 del poder no está activo en producción | **Alta** — 0 filas en `ocr_raw_cache`, 0 payloads con schema v6, flag `POWER_V5_ENABLED` default `false`. |
| El fix B3 "resuelve el caso original de Alejandra" | **No verificado.** El caso reportado (#1665: poder >25pág, `poder_banco` vacío) no se puede reproducir hoy con su PDF real, y el pipeline que supuestamente lo arregla no está encendido. Los `apoderado_*` que sí aparecen provienen del extractor **legacy**, no del v6. |
| La auditoría A2 de la minuta quedó implementada en código | **Alta** en código (skills, memorias, parsers, plantilla v2/v3). |
| A2 se ve reflejada en las minutas reales de Alejandra generadas post-fix | **No verificado.** Requiere abrir los `minuta.docx` de sus cancelaciones y contrastar contra los 7 puntos. |

## Próximos pasos recomendados (solo si quieres cerrar la verificación)

1. **Decidir sobre `POWER_V5_ENABLED`**: o encenderlo en el ambiente y validar con un caso nuevo real (idealmente pidiéndole a Alejandra que suba otra vez uno de sus poderes largos), o quitar del roadmap la reclamación de que "B3 está resuelto en producción" y marcarlo como "resuelto en código, pendiente de activación".
2. **Descargar y abrir las 6 minutas completed de Alejandra** (`1c969432`, `5022544d`, `15a90eef`, `1ac20fa1`, `b9606577`, `1d5b2aa7`, `d7193993`, `0e80553d`, `4b05d210`) y checar contra los 7 puntos de A2 uno por uno. Es la evidencia real más cercana disponible.
3. **Auditar por qué los 25 JPEGs del poder de Alejandra (2026-06-24) pesan lo mismo** — puede ser un bug latente de `pdfToImages` que también contribuyó al reporte original.

Sin implementación pendiente derivada de esta verificación. Solo corrección del nivel de confianza en el plan de estado anterior.

# Diagnóstico: PRIMERO ausente en la minuta

## Evidencia leída (sin cambios)

### 1) `selectMinutaTemplate` — `procesar-cancelacion/index.ts` L47-75

```ts
const BUCKET_PLANTILLAS = "cancelaciones-plantillas";
const TEMPLATE_MINUTA    = "formato cancelacion hipoteca blanqueado v2.docx";
const TEMPLATE_MINUTA_V3 = "formato cancelacion hipoteca v3.docx";
const TEMPLATE_CERT      = "CERTIFICADO can hipo blanqueado.docx";

export function selectMinutaTemplate(data: CancelacionData): string {
  if (!POWER_V5_ENABLED) return TEMPLATE_MINUTA;          // ← corta aquí
  const pb  = (data.poder_banco || {}) as Record<string, unknown>;
  const apo = (pb.apoderado    || {}) as Record<string, unknown>;
  const tipo = typeof apo.tipo === "string" ? apo.tipo : "";
  if (tipo === "natural" || tipo === "juridica") return TEMPLATE_MINUTA_V3;
  return TEMPLATE_MINUTA;
}
```

### 2) Flag `POWER_V5_ENABLED` — `_shared/poderBancoSchemaVersion.ts`

- `POWER_DEEP_SCHEMA_ENABLED = readBoolEnv("POWER_DEEP_SCHEMA_ENABLED","POWER_V5_ENABLED", false)` — **default OFF**.
- `POWER_V5_ENABLED` es alias de la anterior.
- La lista de secrets del proyecto muestra `POWER_V6_EXTRACTOR_ENABLED` pero **no** hay `POWER_V5_ENABLED` ni `POWER_DEEP_SCHEMA_ENABLED` → resuelve a `false`.

⇒ `selectMinutaTemplate` retorna **siempre** `"formato cancelacion hipoteca blanqueado v2.docx"`, sin importar que `poder_banco.apoderado.tipo === "natural"` ni el flag de datos `has_apoderado_banco_v3="true"`. Ese último flag es del extractor (datos OCR), no del selector de plantilla — no se confunden en el código.

### 3) Plantillas presentes en `cancelaciones-plantillas` (query real a `storage.objects`)

| archivo | tamaño | modificado |
|---|---:|---|
| `davivienda/formato cancelacion hipoteca blanqueado v2.docx` | 23,679 B | 2026-07-15 |
| `davivienda/formato cancelacion hipoteca v3.docx` | **14,135 B** | 2026-07-04 |
| `davivienda/CERTIFICADO can hipo blanqueado.docx` | 28,444 B | 2026-05-21 |
| `davivienda/EJEMPLO_REFERENCIA_PROSA_{NATURAL,JURIDICA}_DAVIVIENDA.docx` | 82K / 42K | 2026-07-05 |

Nota: los nombres tienen prefijo `davivienda/`; el código los carga con nombre pelado — habría que confirmar cómo se resuelve el path completo en `fillTemplate` (línea 1224+), pero eso es tangencial: la clave es qué archivo se pide.

### 4) Conclusión con evidencia

- El trámite `1c63c1aa-…` fue generado con **v2** (`formato cancelacion hipoteca blanqueado v2.docx`).
- Coincide con la memoria del proyecto: v3 sigue **dormida detrás de `POWER_V5_ENABLED=false`**, sin test de estructura, 14 KB vs 282 KB de otras plantillas — nota pendiente registrada en `poderBancoSchemaVersion.ts` L57-62.
- La prosa `comparecencia_prosa` **sí se calcula** en el mapa `vars` (L1101-1117), pero **v2 no tiene el tag** `{{comparecencia_prosa}}` → Docxtemplater no la imprime → el párrafo PRIMERO desaparece completo del docx.
- 100% consistente con lo que ya observaste en el XML del documento generado.

## Opciones de corrección (para elegir; no implementar aún)

### Opción A — Encender v3 en preview y auditar
Setear `POWER_V5_ENABLED=true` (edge) y `VITE_POWER_DEEP_UI_ENABLED` ya está ON. Regenerar el trámite. Requiere **antes** validar que `v3.docx` (14 KB) contiene todos los tags que `buildDocxVars` emite — probable riesgo de otros campos vacíos. La memoria advierte explícitamente contra encender el flag sin auditar.

### Opción B — Parchar la plantilla v2 (recomendado, quirúrgico)
Insertar en `v2.docx` un párrafo con `{{comparecencia_prosa}}` (y opcionalmente `{{antefirma_prosa}}` / `{{nota_autorizacion_prosa}}` donde corresponda). Cero código, cero flags. Solo edición de plantilla en el bucket. `nullGetter` ya cubre trámites legacy sin `poder_banco` (queda vacío ≡ estado actual).

### Opción C — Emitir la prosa por otro tag legacy ya presente en v2
Si v2 tiene algún tag actualmente vacío que se imprime en la posición de PRIMERO (p.ej. `apoderado_nombre` u otro), mapear `comparecencia_prosa` a ese tag como fallback. Frágil — puede pisar contenido en trámites viejos. **No recomendado**.

## Lo que necesito de ti antes de implementar

1. ¿Vamos con **B** (parchar v2 subiendo una nueva versión al bucket, sin tocar código)? Es lo más seguro.
2. Si sí — ¿me subes tú el `.docx` con el placeholder ya insertado, o quieres que en modo build baje v2, le inserte `{{comparecencia_prosa}}` en la posición correcta con `docx`/`pizzip`, y lo re-suba? Lo segundo requiere que yo edite un `.docx` binario a ciegas (posición del párrafo, formato) — más frágil que hacerlo tú en Word.
3. ¿O prefieres **A** y auditamos v3 primero (ver qué tags faltan)?

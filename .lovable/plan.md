
# Endurecimiento V6 — Anti-alucinación en poder bancario

Objetivo: cerrar el hueco donde el schema profundo permite a Gemini rellenar campos críticos con contenido fabricado cuando la imagen es ruidosa. Tres capas defensivas independientes (schema, validación, UI) para que ninguna sola sea el único punto de falla.

Todo el diseño se implementa **detrás de un feature flag** (`POWER_V6_STRICT_CONF_ENABLED`, default `false` en el primer merge), para desacoplar despliegue de activación y permitir A/B contra los casos de Ana María.

---

## PARTE 1 — Confianza explícita en el schema profundo

### 1.1 Rediseño de `tool.ts` (schema V6)

Archivo: `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts`

Introducir helper `confStrField` (paralelo al `confField` legacy, misma forma) y aplicarlo a los campos donde hoy vive la alucinación silenciosa:

```text
apoderado:
  nombre                        → confStrField
  cedula                        → confStrField
  sociedad_razon_social         → confStrField
  sociedad_nit                  → confStrField
  sociedad_constitucion.numero  → confStrField
  sociedad_constitucion.fecha   → confStrField
  sociedad_constitucion.camara_comercio_numero → confStrField
  representantes[].nombre       → confStrField
  representantes[].cedula       → confStrField
  representantes[].cargo        → confStrField (media/baja tolerable)

poderdante:
  entidad_nombre                → confStrField
  entidad_nit                   → confStrField
  representante_legal_nombre    → confStrField
  representante_legal_cedula    → confStrField
  representante_legal_cargo     → confStrField

instrumento_poder:
  escritura_num                 → confStrField
  fecha                         → confStrField
  fecha_texto                   → confStrField
  notaria_numero                → confStrField
  notaria_ciudad                → confStrField
  notario_titular_nombre        → confStrField
```

Campos sin cambio (categóricos, booleans, enums, texto libre): `apoderado.tipo`, `has_apoderado_banco_v3`, `facultades.*`, `vigencia.*`, `anexos[]`, todos los legacy planos (`apoderado_nombre`, `apoderado_cedula`, etc. — ya usan `confField`).

`confStrField(desc)` = `{ valor: string|null, confianza: "alta"|"media"|"baja" }` con `additionalProperties: false`. Idéntico al `confField` legacy actual salvo que `valor` puede ser `null` (para que "ilegible → null baja" tenga forma canónica).

### 1.2 Prompt reforzado (`prompt.ts`)

Añadir bloque al final:

```
═══════════════════════════════════════════
CONFIANZA POR CAMPO (obligatorio en schema profundo)
═══════════════════════════════════════════

Cada campo del bloque profundo devuelve {valor, confianza}. Reglas:
  - "alta"  → leíste el valor NÍTIDO en el documento, sin dudas.
  - "media" → leíste el valor pero hay ruido/tachones/formato ambiguo.
  - "baja"  → NO pudiste leer con certeza. valor DEBE ser null.

PROHIBIDO: confianza "alta" con valor deducido/probable.
PROHIBIDO: confianza "media"/"baja" con valor NO nulo si no lo VISTE.
Si dudas entre "media" y "baja", elige "baja" y valor=null. El backend
determinista degradará y pedirá captura humana — es el comportamiento
correcto, NO un error tuyo.
```

Adicionalmente: agregar párrafo pidiendo **auto-verificación de coherencia interna** antes de responder:
```
Antes de emitir el JSON, verifica que estos pares coincidan:
  - instrumento_poder.escritura_num == apoderado_escritura (misma escritura)
  - instrumento_poder.fecha ↔ apoderado_fecha (mismo día)
  - apoderado.cedula == apoderado_cedula (misma cédula)
Si NO coinciden, marca confianza "baja" en TODOS los campos del par y valor=null.
```

Esto es prompting defensivo — la garantía real viene de la validación determinista (Parte 2).

### 1.3 Merge V6-wins condicional (`merge.ts`)

Archivo: `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` (líneas 140-150, el override recién construido)

Estado actual:
```ts
if (apoderadoOut && cls.tipoEfectivo !== null) {
  if (cls.tipoEfectivo === "natural") {
    if (apoderadoOut.nombre) finalFlat.apoderado_nombre = String(apoderadoOut.nombre);
    if (apoderadoOut.cedula) finalFlat.apoderado_cedula = String(apoderadoOut.cedula);
  }
  ...
}
```

Nuevo (compatible con schema viejo Y nuevo):

```ts
// Helper: si el campo es {valor, confianza}, solo aceptar alta|media.
// Si es string plano legacy, aceptar siempre (back-compat).
function acceptable(field: unknown): string | undefined {
  if (typeof field === "string") return sanitizeString(field);
  if (field && typeof field === "object" && "valor" in field) {
    const { valor, confianza } = field as { valor?: unknown; confianza?: string };
    if (confianza === "baja") return undefined;
    return sanitizeString(valor);
  }
  return undefined;
}

if (apoderadoOut && cls.tipoEfectivo !== null) {
  if (cls.tipoEfectivo === "natural") {
    const n = acceptable(apoderadoOut.nombre);
    const c = acceptable(apoderadoOut.cedula);
    if (n) finalFlat.apoderado_nombre = n;
    if (c) finalFlat.apoderado_cedula = c;
    // Trazabilidad para UI: qué campos se rechazaron por baja confianza.
    if (!c && apoderadoOut.cedula) baja_confianza.push("apoderado_cedula");
    if (!n && apoderadoOut.nombre) baja_confianza.push("apoderado_nombre");
  }
  // jurídica: aplicar acceptable() a firmante.nombre/cedula igual.
}
```

Nuevo campo de salida en el bloque merged: `_baja_confianza: string[]` (lista de paths marcados por V6 como baja confianza y por eso NO promovidos). Consumido por UI (Parte 3).

Nota: el shape de `apoderado.nombre/cedula` cambia de `string` a `{valor,confianza}` cuando el flag está ON. `mergePoderBancoV6` debe re-emitir `apoderado` con estructura plana desenvuelta (`{tipo, nombre: string|null, cedula: string|null, _confianza: {nombre, cedula}}`) para que consumidores existentes (`PoderViewerTab`, `buildProsaContext`, `docxConsolidation`) no rompan.

---

## PARTE 2 — Validación determinista de coherencia interna

Archivo nuevo: `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`

Exporta `validatePoderBancoCoherencia(merged): { warnings: string[], suspicious: Set<string> }`.

### 2.1 Cross-check `escritura_num` ↔ `apoderado_escritura`

```ts
function normalizaEscritura(s: string | undefined): string | undefined {
  // "TRESCIENTOS SESENTA Y CUATRO (364)" → "364"
  // "2814" → "2814"
  // Extrae dígitos del paréntesis final si existe; sino dígitos crudos.
  const m = s?.match(/\((\d+)\)\s*$/);
  return m ? m[1] : s?.replace(/\D/g, "") || undefined;
}
```

Si `normalizaEscritura(apoderado_escritura) !== instrumento_poder.escritura_num` **y ambos existen** → añadir `"apoderado_escritura"` e `"instrumento_poder.escritura_num"` a `suspicious`, y warning `"escritura_num_incoherente"`.

Mismo tratamiento para `apoderado_fecha` ↔ `instrumento_poder.fecha` (comparar año extraído).

### 2.2 Formato de cédula colombiana

```ts
const CEDULA_RE = /^\d{6,10}$/;
function isCedulaValida(c: string | undefined): boolean {
  if (!c) return true; // ausencia ≠ inválida
  const norm = c.replace(/[.\s]/g, "");
  return CEDULA_RE.test(norm);
}
```

Aplicar a: `apoderado_cedula` (plano), `apoderado.cedula` (V6), `poderdante.representante_legal_cedula`, `representantes[].cedula`.

Si NO cumple → marcar path en `suspicious` **sin importar la confianza que reportó Gemini** (`521639-4` habría caído aquí aunque Gemini lo reporte con confianza "alta"). Warning: `"cedula_formato_invalido:<path>"`.

### 2.3 Cross-check identidad apoderado vs poderdante

Si `apoderado.cedula === poderdante.representante_legal_cedula` **con ambos no vacíos** → warning `"apoderado_coincide_con_rl_banco"` y ambos paths a `suspicious`. Cubre el caso `9a78aebb` donde Gemini colapsó ambos en Ana María.

### 2.4 Integración en el pipeline

En `procesar-cancelacion/index.ts`, después del merge V6 y antes de persistir `data_ia.poder_banco`:

```ts
const coherencia = validatePoderBancoCoherencia(mergedPoderBanco);
mergedPoderBanco._coherencia_warnings = coherencia.warnings;
mergedPoderBanco._coherencia_suspicious = Array.from(coherencia.suspicious);
// Emitir system_event si hay algo
if (coherencia.warnings.length > 0) {
  await logSystemEvent({
    evento: "procesar-cancelacion.poder.coherencia",
    resultado: "warnings",
    detalle: { cancelacion_id, warnings: coherencia.warnings, suspicious: [...] }
  });
}
```

Nunca bloquea la persistencia — solo anota. Filosofía Sertuss: código mide, humano decide.

---

## PARTE 3 — Superficie de alerta al usuario

Archivo: `src/components/cancelaciones/PoderBannersV5.tsx` (reutilizar patrón ámbar existente L112-125).

### 3.1 Nuevo banner "Datos de baja confianza"

Se activa si `poder_banco._baja_confianza.length > 0` OR `poder_banco._coherencia_suspicious.length > 0`.

Contenido:
```
⚠ Revisa manualmente estos datos del poder
La IA no pudo leer con certeza:
  • Cédula del apoderado (baja confianza)
  • Número de escritura (incoherente entre bloques)
Estos campos NO se copiaron al borrador. Ábrelo, verifica contra el PDF
y edita el campo antes de generar el documento final.
[Ver campos afectados ▾]
```

Estilo: reusar `rounded-lg border border-amber-500/40 bg-amber-500/5 p-3` con `AlertTriangle` (mismo componente iconográfico usado en L167-171).

### 3.2 Marca visible en el campo mismo

Archivo: `src/pages/CancelacionValidar.tsx` (componente `<Field>` local, L1163-1180).

Si el path del campo está en `_baja_confianza` o `_coherencia_suspicious`:
- Border del input pasa a `border-amber-500` (ya existe patrón rojo para faltantes críticos en `cancelacionCriticalFields.ts` — este es el hermano ámbar).
- Ícono pequeño `AlertTriangle` amber a la derecha del label con tooltip: "IA leyó con baja confianza — verifica contra el PDF antes de generar".

Wiring: pasar `suspicious: Set<string>` como prop a `<Field>`. Cero cambio en `docxConsolidation` (los valores sospechosos siguen fluyendo — el usuario los ve marcados; si no los toca, el documento sale igual que hoy).

### 3.3 Bloqueo suave en "Generar documento"

Botón principal de generación: si hay `suspicious.length > 0` no editados manualmente, mostrar confirmación modal **una vez**:
```
Hay 3 campos que la IA marcó como baja confianza y no has revisado.
¿Generar el documento igualmente? [Revisar antes] [Generar de todas formas]
```

No bloquea (respeta filosofía "humano decide"), pero fuerza consciencia.

---

## Archivos tocados

| Archivo | Parte | Tipo de cambio |
|---|---|---|
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/tool.ts` | 1.1 | Schema: envolver ~20 campos en `confStrField` |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts` | 1.2 | Añadir bloque "CONFIANZA POR CAMPO" y auto-verificación |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts` | 1.3 | `acceptable()`, output `_baja_confianza`, desenvolver campos profundos |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts` | 2 | **Nuevo**. Coherencia + formato cédula |
| `supabase/functions/_shared/isomorphic/poderBancoExtractor/index.ts` | 1 | Exponer tipos nuevos |
| `supabase/functions/procesar-cancelacion/index.ts` | 2.4 | Llamar `validatePoderBancoCoherencia`, adjuntar warnings, log |
| `src/components/cancelaciones/PoderBannersV5.tsx` | 3.1 | Nuevo banner "baja confianza" |
| `src/pages/CancelacionValidar.tsx` | 3.2, 3.3 | Marca ámbar por campo + confirmación pre-generación |
| `src/lib/featureFlags.ts` | todo | Flag `POWER_V6_STRICT_CONF_ENABLED` |
| `src/shared/poderBancoExtractor.test.ts` | 1, 2 | Casos: baja confianza → no override; cédula "521639-4" → suspicious; escritura incoherente → suspicious; back-compat legacy string |
| `src/shared/poderBancoValidate.test.ts` | 2 | **Nuevo**. Unit tests de cada regla de validación |

---

## Riesgos de regresión

**Alto:**
- **Consumidores del bloque profundo** (`PoderViewerTab`, `buildProsaContext`, `docxConsolidation.ts` L509-512) esperan `apoderado.nombre: string`. El nuevo shape sería `{valor, confianza}` — hay que desenvolver en `merge.ts` antes de exponer al frontend (mantener `apoderado.nombre` como `string|null` desenvuelto, y añadir `apoderado._confianza: {nombre, cedula, ...}` en paralelo). **Sin este cuidado, el visor V2 rompe.**
- **`apoderadoClassifier.ts`** (recién editado) lee `apoderado.nombre/cedula`. Su lógica de "hay identidad" debe seguir funcionando; después del desenvolvido no cambia. Sí hay que testear que el classifier no vea `{valor:null, confianza:"baja"}` como "identidad presente".

**Medio:**
- **Gemini con schema más rico**: el schema V6 con `confStrField` en ~20 lugares es más grande. Gemini 2.5 Flash puede degradar latencia (~5-10% probable) o rechazar por complejidad. Flag OFF si latencia supera 1.5x baseline.
- **Prompt más largo** (~30 líneas extra): riesgo bajo — Gemini maneja 500-line prompts sin problema, pero validar que el prompt sigue < 8k tokens.
- **Cambio de contrato en `data_ia.poder_banco`**: registros históricos siguen con schema viejo. Las funciones downstream deben tolerar AMBOS shapes (con y sin envoltorio de confianza). Test explícito de un payload viejo re-leído.

**Bajo:**
- **Tests actuales (126 verdes)**: los 4 tests V6-wins que acabamos de agregar usan strings planos → siguen pasando (path back-compat en `acceptable()`). No hay regresión.
- **Banner nuevo en UI**: independiente, solo se muestra si hay warnings. Sin warnings, invisible.

---

## Plan de verificación

### Fase 1 (schema + merge, flag OFF):
1. `bunx vitest run` → 126 tests verdes + nuevos tests unitarios de `acceptable()` y desenvolvido.
2. Deploy `procesar-cancelacion` con flag OFF → comportamiento idéntico al de hoy.
3. Reprocesar los 5 trámites históricos más recientes → confirmar `data_ia.poder_banco` idéntico bit-a-bit.

### Fase 2 (validate.ts, flag OFF, solo mide):
4. Deploy con `validatePoderBancoCoherencia` corriendo pero sin propagar a UI.
5. Reprocesar Ana María (`15582708`, `9a78aebb`) → confirmar que `system_events` registra warnings:
   - `15582708`: `escritura_num_incoherente` (2814 vs 364), `cedula_formato_invalido:apoderado_cedula` (79.123.456 tiene puntos → normaliza OK; pero VALIDAR contra 79.123.456 tal cual también).
   - `9a78aebb`: `cedula_formato_invalido:apoderado.cedula` (521639-4), `apoderado_coincide_con_rl_banco`, `escritura_num_incoherente` (2161 vs 2384), `fecha_incoherente` (2023 vs 2024).
6. Recolectar warnings de 20 trámites históricos aleatorios → estimar tasa de falsos positivos.

### Fase 3 (schema strict ON, ambiente staging):
7. Activar `POWER_V6_STRICT_CONF_ENABLED=true`.
8. Re-subir el mismo PDF de Ana María 3 veces → medir consistencia:
   - Esperado: al menos algunos campos ahora salen con `confianza: "baja"` y `valor: null` (papel notarial rosado ilegible).
   - Confirmar que `_baja_confianza` y `_coherencia_suspicious` no están vacíos.
   - Confirmar que el banner ámbar aparece en `CancelacionValidar.tsx`.
9. Medir latencia p95 antes/después → si > 1.5x, flag OFF y iterar schema.

### Fase 4 (UI, con flag ON):
10. Manual QA con dueño del producto: subir Ana María, ver banner, ver bordes ámbar, editar cédula a `41.939.243`, generar documento → confirmar que sale con el valor editado.
11. Regresión: subir un poder bien escaneado (bucket de referencia Davivienda) → confirmar que banner NO aparece.

### Fase 5 (rollout):
12. Flag ON por default en producción, monitor semanal de tasa de banners `_baja_confianza` en `system_events`.

---

## Cronograma sugerido

- **Sprint 1 (esta semana):** Partes 1.1, 1.2, 1.3 + tests unitarios. Deploy con flag OFF. Fase 1 de verificación.
- **Sprint 2 (siguiente semana):** Parte 2 completa. Fase 2 (solo mide). Análisis de tasa de warnings sobre histórico.
- **Sprint 3:** Parte 3 UI + activación gradual (Fase 3, 4). Rollout general (Fase 5) tras 1 semana estable en staging.

Priorización: Parte 2 sola ya cubre ~70% del daño hoy (los dos casos de Ana María se detectan sin necesidad del schema strict). Si hay que soltar solo una fase primero, es la Parte 2 con Parte 3 mínima (banner). Parte 1 (schema strict) es lo caro/riesgoso y va al final.

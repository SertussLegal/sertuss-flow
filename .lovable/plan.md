# Plan — Coherencia holística del apoderado (plano gana + warning)

## Objetivo
Eliminar la divergencia entre `poder_banco.apoderado_nombre` / `apoderado_cedula` (plano — lo que la UI edita) y `poder_banco.apoderado.nombre` / `apoderado.cedula` (anidado v6, alimenta la prosa) al generar minuta + certificado. Cuando haya divergencia, corregir a favor del plano y **alertar en amarillo** (informativo, no bloquea), reutilizando la infraestructura de `_coherencia_warnings` / `_coherencia_suspicious` + `Field.suspicious/suspiciousLabel`.

---

## 1. Helper isomórfico

**Archivo nuevo:** `supabase/functions/_shared/isomorphic/prosaBancos/syncApoderadoFlatNested.ts`

**Firma:**
```ts
export interface SyncApoderadoResult {
  synced: Record<string, unknown>;   // pb con .apoderado.{nombre,cedula} + firmante alineados al plano
  warnings: string[];                // subconjunto de WARNING_CODES
  suspicious: Set<string>;           // paths de UI a marcar
}

export function syncApoderadoFlatWithNested(
  pb: Record<string, unknown> | null | undefined
): SyncApoderadoResult;
```

**Códigos de warning nuevos** (uno por campo, para que el label sea preciso; ninguno termina en `_no_legible` / `_incoherente` / `_placeholder` / `_duplicidad_cruzada` / `_menciones_incoherentes` — no son hard-block, verificado contra `HARD_BLOCK_SUFFIXES` en `_shared/isomorphic/poderBancoExtractor/validate.ts:101-105`):

- `apoderado_nombre_divergencia_plano_anidado`
- `apoderado_cedula_divergencia_plano_anidado`

**Paths suspicious emitidos** (mismos que la UI ya cablea en `CancelacionValidar.tsx:1405, 1422`):
- `apoderado_nombre`
- `apoderado_cedula`

**Reglas de decisión** (normalización de comparación = `String(x).trim().toUpperCase()`, tratando `""` como vacío):

| Estado                                                   | Acción sobre `pb.apoderado.nombre/cedula` | Warning | Suspicious |
| -------------------------------------------------------- | ------------------------------------------ | ------- | ---------- |
| Anidado ausente o vacío                                  | No tocar                                   | No      | No         |
| Plano vacío                                              | No tocar                                   | No      | No         |
| Plano == Anidado (tras normalizar)                       | No tocar                                   | No      | No         |
| Plano ≠ Anidado, ambos poblados                          | **Sobrescribir anidado con plano (verbatim)** | Sí   | Sí         |
| Plano poblado, anidado poblado con `null` literal / `"null"` / `"undefined"` | Sobrescribir                | Sí   | Sí         |

**Caso jurídica** (`pb.apoderado.tipo === "juridica"` o `tipo_override === "juridica"`):
El "nombre plano" (`apoderado_nombre`) representa el **firmante persona natural** que actúa en nombre de la sociedad, no la razón social (confirmado por `mergePoderBancoV6` en `merge.ts:260-292`, que sincroniza plano ← `firmante.nombre/cedula` cuando existe). Regla:

1. Determinar el firmante objetivo dentro de `pb.apoderado.representantes[]`:
   - Preferir `representantes.find(r => r.es_firmante === true)`.
   - Si hay más de uno con `es_firmante`, tomar el primero (mismo criterio que `mergePoderBancoV6`), y agregar warning `apoderado_multiple_firmantes_ambiguo` (nuevo, ya no bloquea, solo marca `apoderado_nombre` suspicious).
   - Si ninguno tiene `es_firmante`, tomar el primer representante como fallback.
   - Si el array está vacío/ausente, tratar como "anidado ausente" → no tocar.
2. Aplicar la misma tabla de decisión sobre `firmante.nombre` vs `pb.apoderado_nombre` y `firmante.cedula` vs `pb.apoderado_cedula`. **NO tocar** `sociedad_razon_social` ni `sociedad_nit` — no son campos que el humano edite hoy en la UI (verificado: `CancelacionValidar.tsx:1401-1440` solo edita los planos).
3. **También** sincronizar `pb.apoderado.nombre`/`cedula` desde el firmante actualizado (mantiene el invariante que ya cumple `mergePoderBancoV6`).

**Invariantes:**
- Función pura. No lanza. Nunca borra datos: solo sobrescribe cuando el destino difiere del plano.
- Idempotente: correrla dos veces produce el mismo resultado, misma cantidad de warnings.
- No modifica `pb` in-place — devuelve `synced` (clon superficial + clones de subárboles tocados). Motivo: los tests de purity y el mismo patrón que `mergePoderBancoV6`.

---

## 2. Punto de llamada

**Archivo:** `supabase/functions/procesar-cancelacion/index.ts`

**Ubicación:** dentro del choke point `generateAndUploadCancelacionDocs`, justo antes de la línea 1335:

```ts
// ANTES:
const vars = buildDocxVars(data, prosaApoderadoOverride);

// DESPUÉS:
const { synced: syncedPB, warnings: syncWarnings, suspicious: syncSuspicious } =
  syncApoderadoFlatWithNested((data.poder_banco ?? {}) as Record<string, unknown>);
if (syncWarnings.length > 0) {
  // Acumular sobre _coherencia_warnings / _coherencia_suspicious existentes
  const prevW = Array.isArray(syncedPB._coherencia_warnings) ? syncedPB._coherencia_warnings as string[] : [];
  const prevS = Array.isArray(syncedPB._coherencia_suspicious) ? syncedPB._coherencia_suspicious as string[] : [];
  syncedPB._coherencia_warnings = Array.from(new Set([...prevW, ...syncWarnings]));
  syncedPB._coherencia_suspicious = Array.from(new Set([...prevS, ...syncSuspicious]));
}
const dataSynced = { ...data, poder_banco: syncedPB } as CancelacionData;

const vars = buildDocxVars(dataSynced, prosaApoderadoOverride);
```

**Cobertura automática:** el mismo `vars` alimenta `fillTemplate(TEMPLATE_MINUTA)` y `fillTemplate(TEMPLATE_CERT)` (líneas 1337-1338), tanto los tags planos (`apoderado_nombre`, `apoderado_cedula` — que usa el certificado) como los tags de prosa (`antefirma_prosa`, `comparecencia_prosa` — que arma `buildDocxVars` desde `pb.apoderado` anidado en las líneas 1130-1146). Ambos documentos salen con el mismo string.

**Persistencia:** el sync es puramente pre-render. **No** se persiste el `syncedPB` en `data_final` — se mantiene la separación entre "lo que el humano tipeó" y "el snapshot forense". Motivo: si el humano cambia de opinión y re-edita, no queremos que el warning fantasma quede pegado. La próxima corrida vuelve a computar la divergencia fresca.

**Riesgo de estado consistente entre el flag off/on:** con `POWER_V6_EXTRACTOR_ENABLED=false` (prod hoy), `pb.apoderado = {}` → el helper cae en "Anidado ausente" y no dispara warning. Cero cambio en el comportamiento actual. El fix solo se activa cuando V6 se prenda.

---

## 3. UI — cableado del warning

**Archivo:** `src/pages/CancelacionValidar.tsx`

**Estado actual:**
- El `Set<string> suspicious` (línea 1316-1319) ya se construye desde `pb._coherencia_suspicious`. El helper agregará `apoderado_nombre` y `apoderado_cedula` a ese array → `suspicious.has("apoderado_nombre")` y `.has("apoderado_cedula")` se prenden automáticamente sin cambios en la UI.
- Los `Field` de `Nombre apoderado` (línea 1401-1406) y `Cédula` (1418-1424) YA reciben `suspicious={suspicious.has(...)}`. **Cero cambios estructurales necesarios en el JSX.**
- `cedulaSuspiciousLabel` (línea 1327-1332) ya concatena labels de `WARNING_LABELS` filtrando por una whitelist. Solo hace falta:
  1. Agregar `"apoderado_cedula_divergencia_plano_anidado"` al array `cedulaWarningKeys` (línea 1321-1326).
  2. Crear el análogo `nombreSuspiciousLabel` (mismo patrón, filtrando `apoderado_nombre_divergencia_plano_anidado`) y pasarlo como `suspiciousLabel` al `Field` de nombre (línea 1401-1406).

**Archivo:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/validate.ts`

Extender `WARNING_LABELS` con los dos códigos nuevos:

```ts
apoderado_nombre_divergencia_plano_anidado:
  "El nombre del apoderado que corregiste no coincidía con el que se iba a usar en la redacción de la comparecencia/antefirma — se usó tu corrección en todo el documento.",
apoderado_cedula_divergencia_plano_anidado:
  "La cédula del apoderado que corregiste no coincidía con la que se iba a usar en la redacción de la comparecencia/antefirma — se usó tu corrección en todo el documento.",
apoderado_multiple_firmantes_ambiguo:
  "El poder tiene más de un firmante marcado — se usó el primero. Verifica que corresponda al que efectivamente firma.",
```

**Confirmación de no-bloqueo:** ninguno de los 3 códigos termina en `_no_legible`, `_incoherente`, `_placeholder`, `_duplicidad_cruzada`, ni `_menciones_incoherentes` → `isHardBlockCoherenciaWarning` los ignora → `detectRequiereRevisionManual` NO los cuenta como motivo bloqueante → no aparece el modal "revisión manual", solo el borde amarillo + tooltip en los campos.

---

## 4. Tests

**Test unitario nuevo:** `src/shared/prosaBancos/syncApoderadoFlatNested.test.ts` (isomórfico, corre en Vitest y equivalente Deno via re-export)

Casos:
1. **Anidado vacío / V6 off** — `pb.apoderado = {}`, plano poblado → no warning, no cambio.
2. **Ambos iguales tras normalización** — plano="JUAN PÉREZ", anidado="  juan pérez  " → no warning.
3. **Divergencia natural** — plano="JUAN PÉREZ RESTREPO", anidado="JUAN PEREZ" → warning `apoderado_nombre_divergencia_plano_anidado`, `synced.apoderado.nombre === "JUAN PÉREZ RESTREPO"`.
4. **Divergencia solo cédula** — nombre coincide, cédula difiere → un solo warning (cédula).
5. **Jurídica con un firmante único** — `representantes: [{ nombre: "OTRO", cedula: "X", es_firmante: true }]`, plano="FIRMANTE REAL" → sobrescribe `representantes[0].nombre` Y `pb.apoderado.nombre`.
6. **Jurídica con múltiples firmantes** → warning `apoderado_multiple_firmantes_ambiguo` + suspicious sobre `apoderado_nombre`.
7. **Jurídica sin `es_firmante`** → fallback al primer representante.
8. **Idempotencia** — correr helper dos veces produce mismo `synced` y misma cantidad de warnings.
9. **Anti-corrupción `null` literal** — anidado="null" (string tóxico) → sync corrige, warning dispara.
10. **Sin mutar entrada** — `pb` original inalterado.

**Test de integración:** `supabase/functions/procesar-cancelacion/index_apoderadoSync_test.ts`

- Payload de regen con `data_ia.poder_banco.apoderado.nombre = "JUAN PEREZ"` y `overrides.poder_banco.apoderado_nombre = "JUAN PÉREZ RESTREPO"`.
- Correr `mergeRegenPayload` → confirmar que `pb.apoderado.nombre` sigue siendo `"JUAN PEREZ"` (comportamiento actual — el frontend nunca edita el anidado).
- Correr `syncApoderadoFlatWithNested` → confirmar que ahora el anidado quedó en `"JUAN PÉREZ RESTREPO"` y que `_coherencia_warnings` contiene el código.
- Correr `buildDocxVars(dataSynced)` → confirmar que:
  - `vars.apoderado_nombre === "JUAN PÉREZ RESTREPO"` (tag plano — certificado).
  - `vars.comparecencia_prosa` y `vars.antefirma_prosa` contienen `"JUAN PÉREZ RESTREPO"` y **no** `"JUAN PEREZ"` (prosa — minuta v2).

**Test de purity:** `src/shared/prosaBancos/__contract__/purity.test.ts` (existente) — extender para asegurar que el nuevo archivo no importa Database / Deno / React.

**Test de no-hard-block:** en el mismo test unitario, assertion explícito:
```ts
expect(isHardBlockCoherenciaWarning("apoderado_nombre_divergencia_plano_anidado")).toBe(false);
expect(isHardBlockCoherenciaWarning("apoderado_cedula_divergencia_plano_anidado")).toBe(false);
```

---

## 5. Detalles técnicos

- **Isomórfico:** el helper vive bajo `supabase/functions/_shared/isomorphic/prosaBancos/` para que el frontend pueda re-usarlo eventualmente en el visor en vivo (`ProsaLiveRenderer`) sin duplicar la lógica — hoy no lo necesita porque el warning se calcula en el servidor y persiste en `_coherencia_warnings`, pero deja la puerta abierta.
- **Compatibilidad con `mergePoderBancoV6`:** el sync es un post-procesamiento independiente. Si V6 corrió, ya sincronizó anidado→plano cuando el classifier no degradó; nuestro helper sincroniza en sentido opuesto **solo si** después de eso el humano tocó el plano. Sin conflicto.
- **Sin cambios de plantilla:** las plantillas .docx quedan tal cual — la corrección es 100% en runtime pre-fill.
- **Sin cambios de schema Gemini** ni en la extracción.
- **Trazabilidad legal:** registrar en `activity_logs` (dentro del bloque `if syncWarnings.length > 0`) un evento `APODERADO_SYNC_APPLIED` con `{ warnings, valores_previos_anidados, valor_plano }` para auditoría — mismo patrón que ya usa el helper de coherencia inmueble (línea 1747, 1833).

---

## Preguntas para confirmar antes de implementar

1. ¿OK con dos códigos separados (`_nombre_` y `_cedula_`) en vez de uno combinado? Yo prefiero separados porque el label queda más preciso ("el nombre" vs "la cédula") y el usuario suele corregir uno u otro, no ambos a la vez.
2. ¿OK con el criterio jurídica "primer firmante marcado; si hay >1, warning ámbar y usar el primero"? La alternativa es exigir que el humano resuelva la ambigüedad antes de generar (hard-block), pero eso rompería la propiedad "informativo, no bloqueante" que pediste.
3. ¿OK con NO persistir el `syncedPB` en `data_final` (solo pre-render)? Alternativa: persistirlo tras la generación exitosa para que el warning quede visible incluso si el humano no re-edita.

Sin implementar hasta tu OK.

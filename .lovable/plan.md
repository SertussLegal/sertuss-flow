# Diagnóstico: divergencia apoderado plano vs anidado (minuta vs certificado)

## Confirmación de la sospecha — SÍ es real

### 1. Schema OCR: dos rutas independientes que Gemini puede leer distinto

**Ruta A — Monolítica plana (siempre activa, prod default):**
`procesar-cancelacion/index.ts:320-331` — el schema de `poder_banco` solo declara campos planos: `apoderado_nombre`, `apoderado_cedula`, `apoderado_escritura`, `apoderado_fecha`, `apoderado_notaria_poder`. **No hay objeto anidado `apoderado`**.

**Ruta B — Extractor V6 profundo (opt-in vía `POWER_V6_EXTRACTOR_ENABLED`, default `false`):**
`supabase/functions/_shared/poderBancoSchemaVersion.ts:75-76`. Cuando está encendido, `poderBancoExtractor` corre en paralelo y agrega el objeto anidado `apoderado: { nombre, cedula, tipo, representantes[], ... }` al `pb`.

En prod hoy: V6 apagado → `pb.apoderado` llega vacío `{}`. Ver `procesar-cancelacion/index.ts:1118`.

### 2. Sí hay un mecanismo de sync — pero solo dentro de la ruta V6

`supabase/functions/_shared/isomorphic/poderBancoExtractor/merge.ts:260-292` (`mergePoderBancoV6`): cuando `classifyApoderado` NO degrada (`tipoEfectivo !== null`), sobrescribe `finalFlat.apoderado_nombre` y `finalFlat.apoderado_cedula` con los valores del bloque anidado (`apoderadoOut.nombre/cedula` o `firmante` si es jurídica). Es una sincronización **anidado → plano**, no bidireccional.

**Consecuencia:** el sync solo existe cuando (a) `POWER_V6_EXTRACTOR_ENABLED=true`, (b) el extractor V6 corrió, y (c) el classifier no degradó. En prod default, ninguna condición se cumple → no hay sync activo.

### 3. Dos vectores reales de divergencia

**Vector 1 — V6 apagado (prod hoy):**
- `pb.apoderado` = `{}` → `classifyApoderado` degrada a `tipoEfectivo=null` (`procesar-cancelacion/index.ts:1121-1124`).
- `bancoTemplate && classifierResult.tipoEfectivo` es falso → **`comparecenciaProsa` y `antefirmaProsa` quedan `undefined`** (líneas 1130-1143).
- Los tags `comparecencia_prosa` / `antefirma_prosa` en la minuta v2 imprimen "___________" vía nullGetter.
- No hay divergencia porque la prosa simplemente no se emite. Pero **tampoco hay coherencia**: la minuta imprime `{{apoderado_nombre}}` (plano) por otros tags y deja la prosa firmante en blanco → operador nota huecos, no valores contradictorios.

**Vector 2 — V6 encendido + edición manual del humano (escenario más peligroso):**
- OCR pobló ambos: `pb.apoderado_nombre="JUAN PEREZ"` y `pb.apoderado.nombre="JUAN PEREZ"`. `classifyApoderado` clasifica → prosa se renderiza con "JUAN PEREZ".
- Humano corrige en la UI: `src/pages/CancelacionValidar.tsx:1403-1422` solo escribe en `pb.apoderado_nombre`/`pb.apoderado_cedula` (plano). **Nunca toca `pb.apoderado.nombre`.**
- En regen: `mergeRegenPayload` merge por-clave dentro de `apoderado` (línea del helper) preserva `pb.apoderado.nombre="JUAN PEREZ"` viejo; override del frontend solo trae el plano corregido "JUAN PÉREZ RESTREPO".
- `buildDocxVars` corre otra vez: `apoderado_nombre: sanitizeString(pb.apoderado_nombre)` (línea 1196) → "JUAN PÉREZ RESTREPO". Prosa (líneas 1130-1142) usa `apoderadoPayload = pb.apoderado` → renderiza con "JUAN PEREZ" viejo.
- **Resultado:** en la MISMA generación, `apoderado_nombre` plano y `antefirma_prosa` / `comparecencia_prosa` divergen. La minuta v2 imprime nombre A en un tag y nombre B en la prosa firmante del mismo apoderado.

### 4. Certificado template — evidencia indirecta

No pude descargar `davivienda/CERTIFICADO can hipo blanqueado.docx` (bucket privado, sin service role desde este entorno). Evidencia indirecta que apunta a que SÍ usa los tags planos:

- `procesar-cancelacion/index.ts:1196-1197` pone `apoderado_nombre`/`apoderado_cedula` en el mismo `vars` que se pasa a AMBAS plantillas.
- `line 1338`: `fillTemplate(supabaseService, TEMPLATE_CERT, vars)` — mismo `vars` que la minuta.
- Los tags de prosa (`antefirma_prosa`, `comparecencia_prosa`) fueron introducidos con la plantilla v2 saneada. El certificado v1 es anterior y la única forma en que rellene el nombre del apoderado es vía los tags planos. Los tags planos `apoderado_nombre`/`apoderado_cedula` existen precisamente porque el certificado los consume — si no, serían dead code (la minuta v2 usa la prosa).

**Consecuencia:** cuando la minuta v2 imprime la prosa con valor B (anidado viejo), el certificado imprime con valor A (plano nuevo, o viceversa). Documentos generados en el mismo segundo, del mismo trámite, con nombres/cédulas distintos del mismo apoderado.

**Antes de accionar necesito confirmación:** ideal descargar `CERTIFICADO can hipo blanqueado.docx` (con service role, o Alejandra puede abrirlo y buscar `{{apoderado_nombre}}` / `{{apoderado_cedula}}` / `{{antefirma_prosa}}` en el cuerpo) para cerrar la evidencia. Si el cert **sí tiene `antefirma_prosa`**, la divergencia se limita al vector 2. Si **no lo tiene** y solo usa tags planos, la divergencia es entre minuta y cert siempre que V6 esté encendido y haya edición manual.

---

## Propuesta (solo diseño, no implementar aún)

### Fix estructural: sync forzado en el punto de choke antes de renderizar

Un único helper isomórfico `syncApoderadoFlatWithNested(pb)` que corre ANTES de `buildDocxVars` (o al comienzo de él, antes de la línea 1118) y garantiza:

```
si pb.apoderado_nombre (plano) está poblado y NO === pb.apoderado.nombre:
    pb.apoderado.nombre = pb.apoderado_nombre    // plano gana (humano editó plano)
si pb.apoderado_cedula (plano) está poblado y NO === pb.apoderado.cedula:
    pb.apoderado.cedula = pb.apoderado_cedula
(análogo para apoderado jurídica: sync firmante.nombre/cedula)
```

**Regla de precedencia:** plano gana sobre anidado, porque el plano es lo único que la UI edita, y sigue la política del proyecto "Manual > OCR > BD". Si el humano no editó, ambos ya vienen sincronizados desde `mergePoderBancoV6` (ruta B), o ambos vacíos (ruta A).

**Alcance:**
- `supabase/functions/procesar-cancelacion/index.ts` — llamar helper antes de `buildDocxVars` (una sola línea).
- Nuevo módulo isomórfico: `supabase/functions/_shared/isomorphic/prosaBancos/syncApoderadoFlatNested.ts` con función pura.
- Tests unitarios: 4 casos (V6 off, V6 on sin edición, V6 on con edición plano, V6 on con edición plano + jurídica).
- Test de integración: `procesar-cancelacion/index_test.ts` — trámite con edición manual del `apoderado_nombre` genera prosa con el nombre editado, no el OCR viejo.

**No requiere:** cambios en la plantilla, en la UI, ni en el schema Gemini.

### Alternativa descartada
Editar la UI para que también escriba `pb.apoderado.nombre` — más frágil (2 lugares que mantener), y no arregla el vector 1 (V6 apagado con prosa deshabilitada por classifier). El sync en el choke point es más barato y cubre ambos vectores.

---

## Pregunta abierta para el usuario antes de implementar

1. ¿Puedes confirmar (Alejandra o service role) los tags que usa `CERTIFICADO can hipo blanqueado.docx`? Con eso cierro si la divergencia también aplica minuta ↔ certificado (vector "documentos distintos con nombres distintos") o solo dentro de la minuta (vector "tag plano vs tag prosa dentro del mismo doc").
2. ¿El fix debería ser "plano gana" (mi propuesta) o "anidado gana"? Yo propongo plano porque es lo que la UI edita, pero si prefieres que la UI se extienda a editar anidado en vez de forzar sync, dime.

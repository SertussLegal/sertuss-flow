
# Auditoría del fix "poder no adjuntado" — verificación independiente

Verificado hoy sobre código desplegado + datos reales, no sobre el changelog.

## 1) Límite de páginas del Poder — resuelto (50, no 25)

- `src/pages/CancelacionNueva.tsx:26` → `const PODER_MAX_PAGES = 50;`
- Se usa dos veces en el mismo archivo:
  - Línea 112: pre-check antes de rasterizar (`if (numPages > PODER_MAX_PAGES) toast.error(...)`).
  - Línea 145: `uploadPdfAsImages(cancelacionId, poder, "poder", PODER_MAX_PAGES)`.
- Consistente con el prompt del extractor: `supabase/functions/_shared/isomorphic/poderBancoExtractor/prompt.ts:5` — "el usuario puede enviarte hasta 50 páginas".
- No queda ningún `25` residual en la ruta del Poder. El `25` que aparece en `procesar-cancelacion/index.ts:1713` es `MAX_CUANTIA_PAGES` (extractor de cuantía de la escritura, no del poder). ✅

## 2) `POWER_V6_EXTRACTOR_ENABLED` — activo en producción hoy

- El secret existe en el proyecto (confirmado vía secrets).
- Evidencia dura: eventos `procesar-cancelacion.poder` en `system_events` de las últimas 5 corridas registran explícitamente `detalle->>'v6_enabled' = 'true'`:

```
2026-07-08 01:41  c506d69b… v6=true  paginas_enviadas=20
2026-07-08 00:49  2fb6ba16… v6=true  paginas_enviadas=20
2026-07-07 23:33  9a78aebb… v6=true  paginas_enviadas=20
2026-07-07 23:04  15582708… v6=true  paginas_enviadas=20
2026-07-07 21:57  32f5317e… v6=true  paginas_enviadas=20
2026-07-07 21:11  0443d2f1… v6=""    paginas_enviadas=28   ← corrida previa al flip
2026-07-07 16:51  2bef1db3… v6=""    paginas_enviadas=20
2026-07-06 00:23  290fd66a… v6=""    paginas_enviadas=20
```

El flag se encendió aproximadamente entre `2026-07-07 21:11` y `2026-07-07 21:57`. Desde entonces, las 5 corridas subsiguientes reportan `v6_enabled=true`. ✅

## 3) Estado real del campo `poder_banco` en las 14 cancelaciones existentes

`data_ia.poder_banco` en las 11 filas `completed` (las 3 `draft/error` no aplican):

```
id              fecha              has_v3  motivos  apo.tipo  nombre_plano
c506d69b        2026-07-08 01:40   true    0        natural   ANA MARIA MONTOYA ECHEVERRY
2fb6ba16        2026-07-08 00:47   true    0        natural   ANA MARIA MONTOYA ECHEVERRY
9a78aebb        2026-07-07 23:32   true    0        natural   ANA MARIA MONTOYA ECHEVERRY
15582708        2026-07-07 23:02   true    0        natural   ANA MARIA MONTOYA ECHEVERRY
32f5317e        2026-07-07 21:55   true    0        (vacío)   null            ← ver §4
0443d2f1        2026-07-07 21:09   null    1        (vacío)   null            ← ver §4
2bef1db3        2026-07-07 16:48   (∅)     0        (vacío)   FELIX CAGUA     ← pre-v6, legacy ok
290fd66a        2026-07-06 00:20   (∅)     0        (vacío)   FELIX REUZE     ← pre-v6, legacy ok
498c0215        2026-05-20 18:56   (∅)     0        (vacío)   (vacío)         ← histórico pre-fix
1e2069b7        2026-05-20 17:40   (∅)     0        (vacío)   (vacío)         ← histórico pre-fix
a21ae265        2026-05-20 17:03   (∅)     0        (vacío)   (vacío)         ← histórico pre-fix
```

**Filas vacías hoy:** 5 (`32f5317e`, `0443d2f1`, y las 3 de mayo).

## 4) Por qué las que aparecen vacías están vacías (no es el bug histórico)

- **3 filas de 2026-05-20** (`498c0215`, `1e2069b7`, `a21ae265`): son las cancelaciones más antiguas del sistema, generadas semanas antes del rediseño P1–P5. Ni el schema profundo ni v6 existían en su corrida. Es residuo histórico irrecuperable sin reprocesar, no es el bug de página 25.
- **`0443d2f1`** (2026-07-07 21:09): `has_v3=null` con `motivos_incompletitud=1`. Corrió justo **antes** de flipear el flag (v6_enabled vacío en el evento) y aun así el schema devolvió "no concluyente" con motivo explícito — comportamiento correcto del nuevo pipeline (bloquea por revisión manual en vez de inventar). 28 páginas enviadas, dentro del nuevo límite de 50.
- **`32f5317e`** (2026-07-07 21:55): esta sí es anómala. `has_v3=true` pero `apo_tipo` y `apoderado_nombre` vacíos, con v6 ya encendido. Vale la pena que el dueño verifique manualmente si esta cancelación traía poder adjunto o no; si lo traía, es un caso de precisión del extractor v6 que amerita una segunda mirada (no el bug de página 25, porque solo se enviaron 20 páginas).

**Ninguna de las corridas post-flip repite el patrón que reportó Alejandra** (poder adjunto + campo completamente vacío + `has_v3` en blanco). Las 4 corridas de Ana María posteriores al flip devolvieron nombre + tipo + `has_v3=true` de manera consistente.

## 5) Cobertura de tests para "firma después de la página 25" — hueco real

Búsqueda exhaustiva en `src/` y `supabase/functions/` de patrones `pagina.*25`, `page.*25`, `firma.*sustituto`, `poder.*larg`, `test.*poder.*25`: **no existe ni un test que ejercite un poder de >25 páginas ni que valide que la firma del apoderado sustituto llegue al extractor.**

Lo que sí existe:
- `src/lib/pdfToImages.test.ts` valida `maxPages` genérico (3, 4, 1).
- `src/shared/poderBancoExtractor.test.ts`, `poderBancoValidate.test.ts`, `apoderadoClassifier.test.ts` validan el schema y la lógica de merge sobre payloads sintéticos, sin cruzar la frontera de páginas.
- El pre-check de `PODER_MAX_PAGES = 50` no tiene test que garantice que rechaza 51 y acepta 50.

Es un hueco de regresión: si mañana alguien vuelve a bajar la constante a 25, ningún test rojo lo detendría.

## Veredicto honesto

**Parcialmente resuelto — con confianza alta en el pipeline y confianza baja en la red de seguridad.**

- ✅ El bug estructural (límite 25) está corregido y desplegado: constante = 50, prompt = 50, pipeline v6 activo, 4 corridas reales consecutivas con poder poblado correctamente.
- ⚠️ El fix nunca fue re-validado por Alejandra en su cuenta con su documento original. Todas las corridas verdes son de fixtures internos (Ana María, Felix). No hay evidencia empírica del caso exacto que ella reportó.
- ⚠️ La fila `32f5317e` (v6 activo, poder aparentemente sin datos) merece confirmar manualmente si traía o no poder adjunto antes de descartar como "sin poder".
- ❌ Cero cobertura automatizada contra la regresión específica del bug. El pipeline está sano hoy, pero nada impide reintroducirlo.

## Trabajo opcional que puedo proponer (requiere aprobación)

1. Test unitario que fije `PODER_MAX_PAGES ≥ 50` como contrato.
2. Test de integración con un PDF sintético de 30 páginas cuya última página lleva el bloque de firma, verificando que `handle`/`buildPoderBancoRequest` recibe las 30 imágenes y no se trunca.
3. Coordinar con Alejandra una re-corrida real con su documento original para cerrar el reporte.

Confirma si quieres que arme el plan de estos 3 puntos o de un subconjunto.

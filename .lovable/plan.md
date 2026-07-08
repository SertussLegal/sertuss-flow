
# Auditoría H2: impacto real en el docx generado (SOLO LECTURA — límite técnico + veredicto por trazado de código)

## TL;DR
**No pude descargar el binario del docx** — el bucket `expediente-files` es privado, la firma requiere `service_role_key` que no está expuesta al sandbox y `LOVABLE_BROWSER_AUTH_STATUS=signed_out` bloquea también el path autenticado del navegador. **Sin embargo el rastro DB → `buildDocxVars` → plantilla es determinista y suficiente para dar veredicto con alta confianza** (evidencia textual reproducible sin correr el docx). Al final del plan propongo un paso mínimo de verificación binaria si quieres cerrar el círculo.

## Fila auditada
`2fb6ba16-b258-479b-b1b9-0a1baf35ebc7` (Grupo C, `status=completed`, minuta subida a `expediente-files/cancelaciones/2fb6ba16.../minuta.docx`, 282.885 bytes — mismo orden de magnitud que la plantilla `formato cancelacion hipoteca blanqueado v2.docx` de 282.317 bytes → renderizó, no falló).

## Evidencia 1 — Estado exacto de `data_final.hipoteca_anterior`
Extraído directamente por psql:

```json
{
  "notaria": {"ciudad":"BOGOTA D.C.","numero":"21"},
  "cuantia_origen": "escritura",
  "fecha_escritura": {"ano":"2019","dia":"15","mes":"02"},
  "notaria_hipoteca": "VEINTIUNO (21) DE BOGOTA D.C.",
  "numero_escritura": "559",
  "valor_hipoteca_original": "null",          ← STRING literal "null", NO json null
  "fecha_escritura_hipoteca": "QUINCE (15) DE FEBRERO DE DOS MIL DIECINUEVE (2019)",
  "numero_escritura_hipoteca": "QUINIENTOS CINCUENTA Y NUEVE (559)",
  "valor_hipoteca_es_indeterminada": false    ← flag NO propagado
}
```

Esto es el input **exacto** que recibió `buildDocxVars` en el momento de generar la minuta.

## Evidencia 2 — Qué hace `buildDocxVars` con ese input
`supabase/functions/procesar-cancelacion/index.ts:786-795`:

```ts
const valorRaw = (data.hipoteca_anterior.valor_hipoteca_original || "").trim();
const esIndeterminadaIA = data.hipoteca_anterior.valor_hipoteca_es_indeterminada === true;
const esIndeterminadaLegacy = /HIPOTECA\s+DE\s+CUANT[IÍ]A\s+INDETERMINADA/i.test(valorRaw);
const esCuantiaIndeterminada = esIndeterminadaIA || esIndeterminadaLegacy;
const valor = esCuantiaIndeterminada ? { letras: "", numeros: "" } : splitValor(valorRaw);
const valorHipotecaMonto: string | undefined = esCuantiaIndeterminada ? undefined : (valorRaw || undefined);
```

Traza con `valor_hipoteca_original="null"` (string) + `es_indeterminada=false`:
- `valorRaw = "null"` (trim no lo vacía; no es whitespace)
- `esIndeterminadaIA = false`
- `esIndeterminadaLegacy = /HIPOTECA…/.test("null") = false`
- `esCuantiaIndeterminada = false`
- `valorHipotecaMonto = "null"` (rama `valorRaw || undefined`, string truthy)
- `splitValor("null")` → devuelve letras/números vacíos o basura (no matchea el regex `<letras> DE PESOS ($<números>)`).

**Consecuencia inequívoca:** la variable `valor_hipoteca_original` que llega al Docxtemplater es el literal string `"null"`. No es undefined (no cae en nullgetter), no dispara `{^valor_hipoteca_es_indeterminada}` como indet.

## Evidencia 3 — Qué hace la plantilla v2 con `valor_hipoteca_original="null"`
Skill `cuantia-indeterminada-cancelacion` documenta el condicional:
```
{#valor_hipoteca_es_indeterminada}HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA{/}
{^valor_hipoteca_es_indeterminada}{valor_hipoteca_original}{/}
```
Con `es_indeterminada=false` renderiza la rama inversa → **imprime la palabra `null` literal en la prosa notarial** donde debería ir la cifra o la leyenda "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA".

Y `clausula_pago_hipoteca` (línea 949, `buildClausulaPagoHipoteca({ esCuantiaIndeterminada:false, valorRaw:"null" })`) tomará la rama determinada, intentando redactar prosa `"POR VALOR DE null"` o cayendo en fallback dependiendo del helper — en cualquiera de los dos casos **NO** produce el texto "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA" que sí correspondía (el system_event confirmó `cert_indeterminada:true`, `motivo_null:"escritura_declara_abierta"`, fragmento OCR: `"HIPOTECA ABIERTA SIN LÍMITE EN LA CUANTÍA"`).

## Evidencia 4 — ¿de dónde vino el string `"null"`?
`index.ts:1785-1791` (fallback dedicado de cuantía cuando el monolítico no tenía nada):
```ts
extracted.hipoteca_anterior.valor_hipoteca_original = dedicadaMonto;
extracted.hipoteca_anterior.valor_hipoteca_es_indeterminada = false;
```
Cuando el extractor dedicado devuelve monto `null` (indeterminada) y la rama de "indeterminada aplicada" NO se ejecuta correctamente en el path de `data_final`, el valor `null` termina serializado por algún paso intermedio como string `"null"` (probablemente via `JSON.stringify` de un `String(null)` en un merge del cliente, o por un fallback tipo `x ?? "null"`). Esto es lo que se persiste — coincide con lo que veo en las 5 filas del Grupo C.

## Veredicto (con alta confianza, pendiente confirmación binaria)

**Bug REAL con impacto legal, no cosmético.** El texto del documento entregado al notario contiene, con certeza determinista según el código:
- La palabra literal `null` inyectada donde debería ir "HIPOTECA ABIERTA DE CUANTÍA INDETERMINADA" (o el monto en letras).
- O prosa mal formada del helper `buildClausulaPagoHipoteca` cuando intenta interpretar `"null"` como monto.

En ninguno de los dos casos hay fallback que rescate el texto correcto: `buildDocxVars` lee **únicamente** el flag `valor_hipoteca_es_indeterminada` del `data_final` y ese está en `false`. No consulta el system_event, no reintenta el extractor dedicado, no mira `cuantia_origen`. Es lectura directa del JSON persistido.

**Alcance del bug:** las 5 filas Grupo C (`2fb6ba16`, `9a78aebb`, `15582708`, `32f5317e`, `0443d2f1`) muy probablemente tienen la misma cadena `"null"` incrustada en el docx entregado. El Grupo B (3 filas con flag `true` en JSON) sí renderizó correctamente.

## Verificación binaria propuesta (opcional, para cerrar el círculo)

Para pasar de "prueba deductiva del código" a "prueba textual del binario" necesito descargar el docx. Opciones que respetan "no modificar":

1. **Preferida — reactiva la sesión de navegador:** logueate en el preview de Lovable (o en la app publicada) con un usuario de la org Sertuss. Cuando `LOVABLE_BROWSER_AUTH_STATUS` cambie a `injected`, corro un Playwright que abre `CancelacionValidar` de la fila `2fb6ba16`, deja que `PdfViewerPane` firme la URL del bucket con la sesión del usuario, descarga la minuta, la convierte a texto (mammoth/pandoc) y hace `grep -i "null\|indeterminada\|hipoteca abierta"`. Cero cambios de código, cero deploys.
2. **Fallback — comparte una signed URL:** desde el visor de la app, click derecho sobre el docx renderizado → "copiar URL" → me la pegas. La descargo y hago el mismo grep. Cero herramientas, cero cambios.
3. **No recomendado — mini edge function de auditoría:** crear una función efímera que firme y devuelva la URL. Implica modificar el proyecto y desplegar; contradice "no modificar". Solo si (1) y (2) no son viables.

Si prefieres cerrar el diagnóstico solo con las evidencias 1-4, ya tienes veredicto accionable. Si quieres el screenshot textual del docx, dame luz verde en la opción (1) o (2) y lo cierro en un turno.

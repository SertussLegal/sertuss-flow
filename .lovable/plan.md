## Diagnóstico definitivo (evidencia ejecutada, no estática)

Ejecuté las funciones reales con los datos exactos del trámite `1c63c1aa-…`. Resultado:

### Bug #1 — `classifyApoderado` invocado sin `ctx` (causa raíz del PRIMERO ausente)

`supabase/functions/procesar-cancelacion/index.ts:1099`:

```ts
const classifierResult = classifyApoderado(apoderadoPayload);
```

Falta el segundo argumento `{ instrumento_poder, has_apoderado_banco_v3 }`. El clasificador entonces evalúa la Regla C ("natural requiere evidencia del poder") **sin acceso a `instrumento_poder`**, y como el apoderado natural moderno tiene los datos del poder en `pb.instrumento_poder` (no como sustitución en `apoderado.escritura_poder_*`), degrada a `null` con motivo `natural_missing_poder_data`.

Ejecución real:

```
Step 1a (código actual, SIN ctx):
  { tipoEfectivo: null, motivos: ["natural_missing_poder_data"], fromOverride: false }

Step 1b (CON ctx correcto):
  { tipoEfectivo: "natural", motivos: [], fromOverride: false }
```

Con `tipoEfectivo=null`, la guarda en L1105 (`if (bancoTemplate && classifierResult.tipoEfectivo)`) es falsa → `comparecenciaProsa = undefined` → tag `{{comparecencia_prosa}}` vacío en Docxtemplater → párrafo PRIMERO ausente del docx generado (coincide con lo que descargaste).

`getProsaBanco` funciona correctamente con ambos formatos de NIT (Step 2).

### Bug #2 (latente, más chico) — `comparecenciaNatural` lee del lugar equivocado

`supabase/functions/_shared/isomorphic/prosaBancos/davivienda.ts:54-60`:

```ts
const escrituraTxt = nn(ctx.apoderado.escritura_poder_num) ? ... : "___________";
const fechaTxt    = fechaOTexto(ctx.apoderado.escritura_poder_fecha, null) || "___________";
const notariaNum  = nn(ctx.apoderado.escritura_poder_notaria_num) ? ... : "___________";
```

Lee `ctx.apoderado.escritura_poder_*` (campos de sustitución). Cuando el poder es directo (persona natural apoderada directa del banco), los datos viven en `ctx.instrumento.escritura_num/fecha/fecha_texto/notaria_numero` — **no** en `apoderado.escritura_poder_*`. `comparecenciaJuridica` sí lee de `ctx.instrumento.*` (L78-85). Inconsistencia estructural.

Confirmado por Step 3 real: con el bug #1 arreglado (`tipoEfectivo="natural"`), el render arroja:

```
COMPARECIÓ: ANA MARIA MONTOYA ECHEVERRY, colombiana, mayor de edad, domiciliada y
residente de Bogotá, identificada con la cédula 41939243, manifestó: PRIMERO.- …
mediante escritura pública número ___________ del ___________ otorgada en la
notaría ___________ de Bogotá, …
```

Los `___________` deberían decir "siete mil trescientos sesenta y cuatro (7364)", "veintiséis (26) de mayo …", "veintinueve (29)". Los datos están en `pb.instrumento_poder`, pero `comparecenciaNatural` no los consulta.

Además, `index.ts:1107` construye `baseCtx.apoderado` como `{ ...apoderadoPayload, tipo: … }` sin hidratar `escritura_poder_*` desde los campos planos legacy (`apoderado_escritura`, `apoderado_fecha`, `apoderado_notaria_poder`) ni desde `instrumento_poder`. `buildProsaContext.ts` del cliente sí hace ese fallback plano→nested, pero la edge no.

---

## Plan de fix (mínimo, quirúrgico)

### Cambio 1 — `procesar-cancelacion/index.ts:1099`

Pasar el `ctx` al clasificador:

```ts
const classifierResult = classifyApoderado(apoderadoPayload, {
  instrumento_poder: instrumentoPayload as any,
  has_apoderado_banco_v3: (pb as any).has_apoderado_banco_v3,
});
```

Esto por sí solo hace que el párrafo PRIMERO vuelva a emitirse en el docx.

### Cambio 2 — `prosaBancos/davivienda.ts` `comparecenciaNatural` (L50-64)

Preferir `ctx.instrumento.*` cuando esté presente, con fallback a los campos legacy `ctx.apoderado.escritura_poder_*`:

```ts
const escNum = ctx.instrumento?.escritura_num ?? ctx.apoderado.escritura_poder_num;
const escFecha = ctx.instrumento?.fecha ?? ctx.apoderado.escritura_poder_fecha;
const escFechaTexto = ctx.instrumento?.fecha_texto ?? null;
const notNum = ctx.instrumento?.notaria_numero ?? ctx.apoderado.escritura_poder_notaria_num;
const notCiu = ctx.instrumento?.notaria_ciudad ?? ctx.ciudad_firma ?? "Bogotá";
```

Y reemplazar los tres usos de `ctx.apoderado.escritura_poder_*` por estas variables. Añadir la ciudad de la notaría al string final para no quedar diciendo "notaría 29 de Bogotá" cuando el poder puede ser de otra ciudad.

### Cambio 3 — tests

- `src/shared/prosaBancos/__contract__/parity.test.ts`: agregar un caso "natural con `instrumento_poder` directo (no sustitución)" que verifique que el render incluye "7364" y "veintinueve (29)".
- `src/shared/apoderadoClassifier.test.ts`: agregar caso `classifyApoderado(apo_natural_sin_sustitucion, { instrumento_poder: {…} })` → esperar `tipoEfectivo="natural"`.
- Snapshot `referencia_davivienda.contract.json`: no cambia porque ese contrato usa persona jurídica.

### No hacer en este cambio

- **No** parchar la plantilla v2 (`{{comparecencia_prosa}}` ya está en ella — el bug es que el mapa de vars lo enviaba vacío; una vez arreglado, la plantilla actual funciona).
- **No** tocar `POWER_V5_ENABLED` ni v3.
- **No** modificar `buildProsaContext.ts` del cliente (ya hace bien el fallback plano→nested para el preview visual).

### Detalles técnicos

- Los tres callers de `generateAndUploadCancelacionDocs` (L2395, 2785, 3200) se benefician automáticamente del fix porque el choke point es único.
- `mergeOverride` no toca `instrumento_poder`, así que no interfiere.
- Regenerar el docx del trámite `1c63c1aa-…` después del deploy debe imprimir el párrafo PRIMERO correctamente. Verificación: descargar el nuevo docx y confirmar presencia de "COMPARECIÓ: ANA MARIA MONTOYA ECHEVERRY".

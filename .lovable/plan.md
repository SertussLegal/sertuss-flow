

## Auditoría Profesional del Plan — Resultado: 3 errores críticos encontrados, 2 correcciones necesarias

### Lo que el plan dice vs. lo que realmente pasa en el código

**ERROR CRÍTICO 1: El plan diagnostica tags desbalanceados incorrectamente**

El plan dice: "`{#tiene_hipoteca}` aparece 2 veces pero `{/tiene_hipoteca}` aparece 3 veces". Mi auditoría real del template muestra:

- `{#tiene_hipoteca}`: 2 opens
- `{/tiene_hipoteca}`: 3 closes → **CONFIRMADO: hay 1 close extra** (sin open correspondiente)
- `{# }`: 1 open (tag vacío malformado) → **CONFIRMADO**
- `{#es_pep}`: 2 opens, pero se cierran con `{/}` (10 instancias de `{/}` genéricas para `afectacion_vivienda`, `es_pep`, `acepta_notificaciones`) → No son "desbalanceados" en sentido estricto: docxtemplater interpreta `{/}` como cierre del bloque más reciente. **PERO** esto depende de la versión de docxtemplater. Si la versión actual no soporta `{/}` genérico, todos esos bloques fallan.

El plan debería **primero verificar qué versión de docxtemplater está instalada** y si soporta `{/}` (solo en v3.x+). Si no, TODOS los bloques con `{/}` necesitan cierre explícito.

**ERROR CRÍTICO 2: El `safeData` pasa campos planos de la IA al template que espera objetos anidados**

El código actual (línea 1208-1213) hace:
```typescript
const safeData = Object.fromEntries(
  Object.entries(templateData).filter(...)
    .map(([k, v]) => [k, typeof v === "string" ? (v || "__________") : v])
);
doc.render(safeData);
```

La IA devuelve campos planos como `comparecientes_vendedor`, `clausula_objeto`, `valor_compraventa_letras`. Pero el template espera:

- `{inmueble.matricula}`, `{inmueble.cedula_catastral}`, `{inmueble.coeficiente_numero}` → **necesita** `{ inmueble: { matricula: "...", ... } }`
- `{actos.cuantia_compraventa_letras}`, `{actos.entidad_bancaria}` → **necesita** `{ actos: { ... } }`
- `{antecedentes.modo}`, `{antecedentes.escritura_num_letras}` → **necesita** `{ antecedentes: { ... } }`
- `{rph.escritura_num_letras}`, `{rph.matricula_matriz}` → **necesita** `{ rph: { ... } }`
- `{apoderado_banco.nombre}`, `{apoderado_banco.cedula}` → **necesita** `{ apoderado_banco: { ... } }`
- `{#vendedores}{nombre}{cedula}{estado_civil}{/vendedores}` → **necesita** `{ vendedores: [{ nombre, cedula, ... }] }`
- `{#tiene_hipoteca}...{/tiene_hipoteca}` → **necesita** `{ tiene_hipoteca: true/false }`

Ninguno de estos campos está en el `safeData` actual. Este es el verdadero crash: docxtemplater encuentra tags de loop/condicional sin datos y explota.

**El plan lo diagnostica correctamente**, pero la solución propuesta — "construir templateData desde el estado local" — está INCOMPLETA porque no lista todos los ~80 placeholders reales. Mi auditoría encontró estos placeholders adicionales que el plan no menciona:

| Placeholder | No mencionado en plan |
|---|---|
| `{inmueble.orip_zona}` | Falta |
| `{inmueble.predial_anio}`, `{inmueble.predial_num}`, `{inmueble.predial_valor}` | Faltan |
| `{inmueble.idu_num}`, `{inmueble.idu_fecha}`, `{inmueble.idu_vigencia}` | Faltan |
| `{inmueble.admin_fecha}`, `{inmueble.admin_vigencia}` | Faltan |
| `{actos.credito_dia_letras/num/mes/anio_letras/anio_num}` | Faltan |
| `{actos.redam_resultado}` | Falta |
| `{actos.pago_inicial_letras/numero}`, `{actos.saldo_financiado_letras/numero}` | Faltan |
| `{escritura_numero}`, `{fecha_escritura_corta}` | Faltan |
| `{notario_nombre}`, `{notario_decreto}` | Faltan |
| Loops internos: `{telefono}`, `{actividad_economica}`, `{email}` en vendedores/compradores | Faltan |
| `{apoderado_banco.escritura_poder_num}`, `{apoderado_banco.poder_dia_letras/num/mes/anio_letras/anio_num}` | Faltan |
| `{apoderado_banco.notaria_poder_num}`, `{apoderado_banco.notaria_poder_ciudad}`, `{apoderado_banco.email}` | Faltan |

**ERROR CRÍTICO 3: `nullGetter: () => undefined` no previene crashes en loops/condicionales**

Línea 1205: `nullGetter: () => undefined`. Esto devuelve `undefined` para campos simples (que genera texto vacío), pero para condicionales como `{#tiene_hipoteca}`, si `tiene_hipoteca` es `undefined`, docxtemplater lo trata como falsy y omite el bloque — eso en principio está bien. **PERO** el tag extra `{/tiene_hipoteca}` sigue causando un "Unopened loop" porque hay 3 closes y solo 2 opens. Ningún `nullGetter` arregla eso. **Hay que reparar el template XML.**

### Validación del plan propuesto

| Elemento del plan | Veredicto |
|---|---|
| Reparar tags desbalanceados en template | **CORRECTO y NECESARIO** — Confirmo `{/tiene_hipoteca}` extra y `{# }` malformado |
| Construir templateData desde estado local | **CORRECTO pero INCOMPLETO** — Falta mapear ~30 placeholders adicionales |
| Configurar `nullGetter: () => "___________"` | **CORRECTO** — Pero no resuelve tags desbalanceados por sí solo |
| "2 archivos, sin migraciones" | **CORRECTO** — Template + Validacion.tsx |

### Plan Corregido y Completo

**Archivo 1: `public/template_venta_hipoteca.docx`** — Reparación via script Python

Correcciones exactas necesarias:
1. Eliminar 1 `{/tiene_hipoteca}` extra (hay 3, solo debería haber 2)
2. Eliminar `{# }` (tag vacío malformado)
3. No tocar `{/}` genéricos — verificar que la versión de docxtemplater los soporte

**Archivo 2: `src/pages/Validacion.tsx`** — Construir `templateData` completo

En `handleConfirmGenerate`, después de obtener la respuesta de la IA, construir el objeto COMPLETO con TODOS los ~80 placeholders del template:

```text
templateData = {
  // Root
  escritura_numero: "", // se llena post-generación
  fecha_escritura_corta: new Date().toLocaleDateString("es-CO"),
  notario_nombre: notariaConfig?.nombre_notario || "___________",
  notario_decreto: notariaConfig?.decreto_nombramiento || "___________",
  
  // Booleanos para condicionales
  tiene_hipoteca: actos.es_hipoteca,
  afectacion_vivienda: actos.afectacion_vivienda_familiar,
  
  // Loops de personas (TODOS los campos internos)
  vendedores: vendedores.map(v => ({
    nombre: v.nombre_completo || "___________",
    cedula: formatCedulaLegal(v.numero_cedula) || "___________",
    expedida_en: v.lugar_expedicion || "___________",
    estado_civil: v.estado_civil || "___________",
    domicilio: v.municipio_domicilio || "___________",
    direccion_residencia: v.direccion || "___________",
    telefono: "___________",
    actividad_economica: "___________",
    email: "___________",
    es_pep: v.es_pep,
    acepta_notificaciones: true,
  })),
  compradores: [...mismo formato...],
  
  // Inmueble anidado
  inmueble: {
    matricula: inmueble.matricula_inmobiliaria || "___________",
    cedula_catastral: inmueble.identificador_predial || "___________",
    direccion: inmueble.direccion || "___________",
    nombre_edificio_conjunto: inmueble.nombre_edificio_conjunto || "___________",
    linderos_especiales: inmueble.linderos || "___________",
    linderos_generales: inmueble.linderos || "___________",
    orip_ciudad: inmueble.codigo_orip || "___________",
    orip_zona: "___________",
    coeficiente_letras: "___________",
    coeficiente_numero: inmueble.coeficiente_copropiedad || "___________",
    nupre: inmueble.nupre || "___________",
    estrato: inmueble.estrato || "___________",
    es_rph: inmueble.es_propiedad_horizontal,
    predial_anio: "___________",
    predial_num: "___________",
    predial_valor: "___________",
    idu_num: "___________",
    idu_fecha: "___________",
    idu_vigencia: "___________",
    admin_fecha: "___________",
    admin_vigencia: "___________",
  },
  
  // Actos anidado
  actos: {
    cuantia_compraventa_letras: numberToWords(actos.valor_compraventa),
    cuantia_compraventa_numero: formatMonedaLegal(actos.valor_compraventa),
    cuantia_hipoteca_letras: numberToWords(actos.valor_hipoteca),
    cuantia_hipoteca_numero: formatMonedaLegal(actos.valor_hipoteca),
    fecha_escritura_letras: "___________",
    entidad_bancaria: actos.entidad_bancaria || "___________",
    entidad_nit: actos.entidad_nit || "___________",
    entidad_domicilio: actos.entidad_domicilio || "___________",
    pago_inicial_letras: numberToWords(actos.pago_inicial),
    pago_inicial_numero: formatMonedaLegal(actos.pago_inicial),
    saldo_financiado_letras: numberToWords(actos.saldo_financiado),
    saldo_financiado_numero: formatMonedaLegal(actos.saldo_financiado),
    credito_dia_letras/num/mes/anio_letras/anio_num: parseFecha(actos.fecha_credito),
    redam_resultado: "___________",
    afectacion_vivienda: actos.afectacion_vivienda_familiar,
  },
  
  // Antecedentes (desde extractedDocumento)
  antecedentes: { ... parseEscrituraString(extractedDocumento) ... },
  
  // RPH (desde inmueble PH data)
  rph: { ... },
  
  // Apoderado banco
  apoderado_banco: { ... },
}
```

Además:
- Cambiar `nullGetter: () => undefined` a `nullGetter: () => "___________"`
- Eliminar el `safeData` actual y usar el templateData estructurado

### Resumen final auditado

| Archivo | Cambio | Riesgo sin corregir |
|---|---|---|
| `public/template_venta_hipoteca.docx` | Eliminar `{/tiene_hipoteca}` extra + `{# }` | Crash 100% en generación |
| `src/pages/Validacion.tsx` | Construir templateData con ~80 placeholders desde estado local | Crash o documento vacío |

2 archivos. Sin migraciones DB. El plan original es **correcto en diagnóstico** pero **incompleto en cobertura de placeholders**. Esta versión auditada garantiza que TODOS los tags del template tengan dato o placeholder.


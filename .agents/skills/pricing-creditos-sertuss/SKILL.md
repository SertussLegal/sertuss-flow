---
name: pricing-creditos-sertuss
description: Framework obligatorio para asignar el precio en créditos de cualquier acción nueva que consuma IA (Gemini/Claude/Lovable AI Gateway) o modificación que aumente el consumo de una existente. Se activa al crear edge functions nuevas con IA, al tocar `credit_prices` o `consume_credit_v2`, al añadir un nuevo `CreditAction`, o cuando el usuario menciona "nuevo trámite", "nueva funcionalidad IA", "cuánto cobrar", "cuántos créditos", "pricing". NUNCA copiar el precio de otra acción sin justificar.
type: preference
---

# Pricing de créditos — proceso obligatorio Sertuss

Este skill propone precios; **nunca los activa por sí solo**. El dueño de producto aprueba antes de escribir en `credit_prices`.

## 1. Cuándo se dispara este skill

Aplicar SIEMPRE que se cumpla al menos una:

- Se crea una edge function que llama a Gemini, Claude o el Lovable AI Gateway.
- Se modifica una edge function existente y el cambio aumenta llamadas IA, tokens, o pasos del pipeline.
- Se añade un valor nuevo al enum `CreditAction` en `src/services/credits.ts`.
- Se inserta o actualiza una fila en `credit_prices`.
- El usuario pregunta "¿cuánto cobrar por X?" / "¿cuántos créditos vale?".

## 2. Principios inviolables

1. **Costo real como piso.** `costo_real = Σ (llamadas_ia × tokens_promedio × precio_modelo)`. El precio en créditos NUNCA puede quedar por debajo de este piso (margen ≥ 0).
2. **Valor evitado como techo.** El precio máximo razonable es **10–30% del valor de reproceso manual evitado** (tiempo del abogado/notario × su tarifa horaria). Por encima de eso, el usuario percibe abuso.
3. **Prohibido copiar precios entre acciones.** Cada acción tiene perfil de tokens y valor distinto. Si el número final coincide con otra acción, hay que justificar *por qué* coincide, no asumirlo.
4. **Cobrar solo al completar/validar.** Nunca durante iteración, corrección, autosave, o preview. El evento monetizable es el "hito de valor entregado" (ej. `unlock_expediente`, generación final del docx).
5. **Instrumentar tokens desde el día uno.** Toda función IA nueva DEBE loguear en `logs_extraccion` o `system_events`: `{ modelo, tokens_input, tokens_output, latencia_ms, tramite_id }`. Sin telemetría no hay pricing defendible.
6. **Precio final vive en el servidor.** Cliente NUNCA hardcodea. Se lee desde `credit_prices` vía RPC. El campo `credits` en `consumeCredit()` es un default de emergencia, no la fuente de verdad.
7. **El skill propone, humano aprueba.** El agente presenta la hoja de cálculo (§4) y espera confirmación explícita del dueño de producto antes de:
   - Insertar/actualizar fila en `credit_prices`.
   - Añadir el nuevo valor al enum `CreditAction`.

## 3. Checklist paso a paso

Cuando se dispare el skill, ejecutar EN ORDEN y no saltarse pasos:

- [ ] **P1. Identificar la acción.** Nombre exacto (`GENERACION_DOCX_SUCESION`, etc.), edge function que la ejecuta, hito monetizable (¿cuándo se cobra?).
- [ ] **P2. Mapear el pipeline IA.** Enumerar todas las llamadas: función → modelo → prompt approx tokens input → tokens output esperados. Si el pipeline tiene retries, incluirlos en el promedio (p95).
- [ ] **P3. Medir costo real.** Con precios oficiales vigentes de cada modelo (Gemini 2.5 Flash/Pro, Claude Sonnet, Gateway Lovable). Fórmula:
  `costo_usd = Σ (input_tokens × precio_input + output_tokens × precio_output)`
  Convertir a créditos usando el tipo de cambio interno vigente (1 crédito = X USD según el plan de precios Sertuss actual).
- [ ] **P4. Estimar valor evitado.** ¿Cuánto tiempo le ahorra al usuario? (minutos de abogado × tarifa/hora). Sacar el rango 10–30%.
- [ ] **P5. Proponer número.** Debe estar entre `max(piso_costo_real × margen_min)` y `techo_valor_evitado`. Redondear a entero razonable (1, 2, 3, 5, 10 — no fracciones).
- [ ] **P6. Justificar en la hoja (§4).** Rellenar TODOS los campos. Sin campos vacíos.
- [ ] **P7. Verificar telemetría.** Confirmar que la edge function loguea tokens reales; si no, bloquear pricing hasta que lo haga.
- [ ] **P8. Presentar al dueño de producto.** Mensaje con la hoja completa + 2-3 alternativas de precio (conservador, recomendado, agresivo). **Esperar `sí` explícito.**
- [ ] **P9. Aplicar.** Solo tras aprobación: migración a `credit_prices` + añadir a enum + actualizar `consumeCredit()` call-sites + PR con la hoja pegada en la descripción.
- [ ] **P10. Post-launch (30 días).** Revisar `logs_extraccion` reales vs. estimados. Si el costo real supera al estimado en >20%, replantear precio.

## 4. Hoja de cálculo obligatoria (llenar SIEMPRE)

Formato Markdown que el agente presenta al dueño de producto:

```markdown
### Pricing propuesto: <NOMBRE_ACCION>

**Hito monetizable:** <cuándo se cobra exactamente>
**Edge function(s):** <lista>
**Fecha propuesta:** <YYYY-MM-DD>

#### A. Pipeline IA
| Paso | Modelo | Tokens input (p50/p95) | Tokens output (p50/p95) | Precio USD / 1M tok (in/out) | Costo USD (p95) |
|------|--------|------------------------|--------------------------|------------------------------|-----------------|
| 1    |        |                        |                          |                              |                 |
| 2    |        |                        |                          |                              |                 |
| **Total** | | | | | **$X.XXXX** |

#### B. Piso (costo real)
- Costo p95 en USD: `$X.XXXX`
- Conversión a créditos (1 crédito = $Y): `Z.ZZ créditos`
- **Piso mínimo:** `⌈Z.ZZ × margen⌉ = N créditos`

#### C. Techo (valor evitado)
- Tarea manual equivalente: <descripción>
- Tiempo evitado: `M minutos`
- Tarifa horaria abogado/notario: `$H`
- Valor evitado: `$V`
- Rango 10–30%: `V × 0.10 = $A` … `V × 0.30 = $B` → `C₁ … C₂ créditos`

#### D. Propuesta
| Escenario     | Créditos | Margen sobre piso | % del valor evitado |
|---------------|----------|-------------------|---------------------|
| Conservador   |          |                   |                     |
| **Recomendado** |        |                   |                     |
| Agresivo      |          |                   |                     |

#### E. Justificación (por qué NO copiar de otra acción)
<párrafo corto que explique el perfil único de esta acción vs. las existentes>

#### F. Telemetría instrumentada
- [ ] Loguea `tokens_input`, `tokens_output`, `modelo`, `latencia_ms` en `logs_extraccion`
- [ ] Registra `tramite_id` para trazabilidad
- [ ] Alerta si costo real > estimado en 20%

#### G. Aprobación
- Dueño de producto: __________
- Fecha: __________
- Firma (sí/no explícito): __________
```

## 5. Anti-patrones a rechazar

- ❌ *"Cobremos 2 créditos, igual que apertura de expediente."* → sin análisis del pipeline propio.
- ❌ Hardcodear `credits: 3` en el cliente sin fila en `credit_prices`.
- ❌ Cobrar al primer clic de "generar preview" (aún no hay valor entregado).
- ❌ Desplegar edge function IA sin logging de tokens.
- ❌ Aumentar consumo (agregar una llamada Claude extra) sin re-correr el checklist.
- ❌ El agente crea la fila `credit_prices` sin esperar `sí` explícito del humano.

## 6. Referencias cruzadas

- `src/services/credits.ts` — enum `CreditAction`, `consumeCredit()`.
- Tabla `credit_prices` — fuente de verdad servidor.
- Función SQL `consume_credit_v2` — atomicidad del cobro.
- Skill `limpieza-segura-codigo` — cuando el cambio implique eliminar código IA legacy.
- `mem://features/monetizacion-apertura-expediente` — precedente de referencia (2 créditos por `unlock_expediente`).

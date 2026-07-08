## Auditoría solo lectura — No hay cambios de código propuestos

### Resultado de la búsqueda en historial (2123 mensajes)

**1. Cita textual del feedback atribuido a Alejandra sobre "dirección"**

Lo único que aparece en el historial atribuido directamente a Alejandra sobre el campo dirección son sus audios del 21-may-2026 (msg #1271), transcritos así por el dueño del producto:

> *"Ella lee el Word final y ve que en el renglón de UBICACIÓN DEL PREDIO y en el de NOMBRE O DIRECCIÓN sale exactamente el mismo bloque de texto repetido, y para colmo con la frase (DIRECCION CATASTRAL) (DIRECCION CATASTRAL) pegada dos veces seguidas."*

Y la regla operativa que ella exigió (msg #1271, #1291) fue:

> *"NOMBRE O DIRECCIÓN: Debe ir la nomenclatura urbana **actual** (Ej: Calle setenta A Bis (70 A Bis) Número ciento veintiuno "A" - treinta (121 A -30) de la ciudad de Bogotá D.C.) seguida del sufijo literal (DIRECCION CATASTRAL) **una sola vez**."*

Es decir, el feedback literal de Alejandra sobre dirección se limita a:
- **Separar** descripción arquitectónica (UBICACIÓN) de nomenclatura postal (DIRECCIÓN).
- Usar la nomenclatura **"actual"** (sin definir de cuál renglón numerado del certificado tomarla).
- Sufijo `(DIRECCION CATASTRAL)` **una sola vez**, no duplicado.
- Sin repetir la ciudad, sin arrastrar linderos/áreas.

**Fecha aproximada:** audios recibidos el **21 de mayo de 2026** (mensajes #1271, #1281, #1291).

---

**2. La regla "índice más alto" NO viene de Alejandra**

La regla actual del sistema —"tomar exclusivamente la línea del índice numérico más alto en `DIRECCION DEL INMUEBLE: 1) ... 2) ...`"— fue **propuesta por el dueño del producto** el **12-jun-2026** (mensaje #1559), no citada de Alejandra:

> *"SELECCIÓN POR ÍNDICE MÁS ALTO: En la 'DIRECCION DEL INMUEBLE', buscar renglones numerados 1), 2), 3) (o romanos). Tomar SIEMPRE y de manera exclusiva la nomenclatura del índice numérico más alto (es la vigente). Ignorar renglones anteriores."*

No hay evidencia en el historial de que Alejandra dijera literalmente "usen el índice más alto" ni "usen la salvedad/corrección más reciente". Esa formalización es una interpretación técnica del equipo (razonable, pero no una cita suya).

---

**3. Dónde vive esa regla en el código actual**

- `supabase/functions/scan-document/core/certificadoTradicion/prompt.ts` → bloque *"REGLA ESPECIAL inmueble.direccion … a) SELECCIÓN POR ÍNDICE MÁS ALTO"* (aplica al flujo de Escrituras).
- `supabase/functions/procesar-cancelacion/index.ts` → misma regla inyectada en el `SYSTEM_PROMPT` y en el schema `nomenclatura_predio.description` (aplica al flujo de Cancelaciones, deploy del 12-jun-2026).
- Post-procesado determinista en `procesar-cancelacion/index.ts`: `sanitizeNomenclaturaBase` + `buildDireccionCompletaSaneada` (skill `direccion-completa-saneada-cancelacion`) — cubre lo que Alejandra sí pidió literal: quitar `(DIRECCION CATASTRAL)` duplicado, quitar ciudad repetida, inyectar sufijo una sola vez.

---

**4. Veredicto honesto**

- ✅ El feedback **explícito y literal** de Alejandra sobre dirección (separar ubicación/dirección, sufijo una sola vez, sin duplicar ciudad, nomenclatura "actual") **sí está implementado**, tanto en el prompt como en el post-procesado determinista.
- ⚠️ La regla **"índice más alto = vigente"** **NO aparece citada de Alejandra** en ninguno de los 2123 mensajes revisados. Es una decisión técnica del equipo del 12-jun-2026 para operacionalizar la palabra "actual" que ella sí usó. Es una interpretación defendible, pero no está respaldada por una cita textual suya.
- ⚠️ No hay evidencia en el historial de que Alejandra haya hablado específicamente de "salvedad", "corrección de nomenclatura", "última anotación de dirección" ni de cómo desempatar cuando el certificado trae dos o más direcciones divergentes.

---

**Sin acción de código.** Si quieres que planee un follow-up (por ejemplo: validar con Alejandra si "índice más alto" coincide con lo que ella espera en casos con salvedad, o auditar cancelaciones reales donde el certificado trajo múltiples direcciones y ver qué escogió el sistema), dímelo y lo planeo.

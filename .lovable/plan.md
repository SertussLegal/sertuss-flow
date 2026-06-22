## Plan estricto para corregir `GUION` en nomenclatura urbana

### Objetivo
Cambiar la regla de direcciones para que, en la parte escrita de la nomenclatura, el separador de placa se conserve como símbolo `-` y no como la palabra `GUION`.

Ejemplo esperado:

```text
CARRERA NOVENTA Y OCHO B NÚMERO SESENTA Y UN A - CINCUENTA Y CUATRO SUR (98B No. 61A-54 S)
```

En vez de:

```text
CARRERA NOVENTA Y OCHO B NÚMERO SESENTA Y UN A GUION CINCUENTA Y CUATRO SUR (98B No. 61A-54 S)
```

### Alcance exacto
1. **Edge Function de cancelaciones**
   - Actualizar el schema del tool en `procesar-cancelacion` para que `nomenclatura_predio` instruya explícitamente: `-` se conserva como símbolo, no se verbaliza como `GUION`.
   - Actualizar el prompt de reglas críticas de nomenclatura con los ejemplos nuevos.

2. **OCR del Certificado de Tradición**
   - Actualizar la descripción del campo `inmueble.direccion` en el extractor del certificado para alinear el primer OCR con la misma regla.
   - Evitar que el OCR vuelva a introducir `GUION` antes de llegar a `procesar-cancelacion`.

3. **Red de seguridad determinista**
   - Agregar saneamiento final en `buildDocxVars`/mapeo final de cancelación para convertir patrones residuales ` NÚMERO X GUION Y ` a ` NÚMERO X - Y ` dentro de `nomenclaturaBase`.
   - Mantener intacto el formato técnico dentro del paréntesis: `(98B No. 61A-54 S)`.
   - No tocar matrículas inmobiliarias ni NITs, porque ahí el guion sí tiene otra función jurídica/técnica.

4. **No tocar**
   - No se modifican plantillas Word.
   - No se modifica frontend.
   - No se cambia `descripcion_predio` arquitectónica salvo que traiga un `GUION` heredado por error dentro de la dirección.
   - No se cambia el helper de dirección completa saneada ni la coletilla `(DIRECCION CATASTRAL)` salvo para recibir la nomenclatura ya corregida.

### Validaciones mínimas
- `CL 59 SUR 60 84` debe producir:

```text
CALLE CINCUENTA Y NUEVE SUR NÚMERO SESENTA - OCHENTA Y CUATRO (59 SUR No. 60-84)
```

- `CALLE 62A # 53B-21` debe producir:

```text
CALLE SESENTA Y DOS A NÚMERO CINCUENTA Y TRES B - VEINTIUNO (62A No. 53B-21)
```

- Caso de la imagen:

```text
CARRERA NOVENTA Y OCHO B NÚMERO SESENTA Y UN A - CINCUENTA Y CUATRO SUR (98B No. 61A-54 S)
```

### Resultado
La minuta dejará de describir el símbolo como palabra `GUION` en direcciones urbanas y conservará el separador visual `-`, que es lo que espera el usuario y evita una redacción artificial en la descripción de la dirección.
# Auditoría (solo lectura) — Cruce de cédula del apoderado contra el Certificado

## 1. Schema del extractor "certificado" (procesar-cancelacion/index.ts)

El extractor actual (líneas ~180–290) es un ÚNICO tool call multimodal que recibe **Certificado + Escritura + (opcional) Poder** y devuelve 5 bloques:

- `hipoteca_anterior` — número/fecha/notaría de la escritura de hipoteca, valor.
- `inmueble` — matrícula, descripción, nomenclatura, ciudad.
- `partes.deudores[]` — nombre + `identificacion` + `tipo_id` (fuente PRIMARIA: anotación 0205 del certificado).
- `partes.banco_acreedor`, `partes.banco_nit`.
- `analisis_legal` — Ley 546, anotaciones concurrentes de vivienda familiar / patrimonio.
- `poder_banco` — `apoderado_nombre`, `apoderado_cedula`, `apoderado_escritura`, `apoderado_fecha`, `apoderado_notaria_poder`. **La descripción dice literal: "los datos suelen estar en las cláusulas finales del PDF"** (se refiere al PDF del poder, no del certificado).

**No existe** ningún campo tipo `certificado.apoderado_cedula`, `certificado.representante_banco`, ni equivalente. La cédula del apoderado se captura **exclusivamente** dentro del bloque `poder_banco`, cuya fuente es el poder adjuntado, no el certificado.

## 2. ¿El prompt menciona incidentalmente la cédula del apoderado en el certificado?

Revisado el SYSTEM_PROMPT (líneas 290+): habla de "PAREO ESTRICTO" de deudores contra el certificado, "CRUCE CON ESCRITURA ANTECEDENTE" para comparecencia, "el certificado es la fuente registral primaria". **Nunca menciona al apoderado del banco como algo a buscar en el certificado.** El apoderado solo aparece bajo el bloque `poder_banco`, que instruye leer las cláusulas finales del PDF del poder.

## 3. Evidencia real en BD

Consulta a `cancelaciones.data_ia`: las llaves de primer nivel son exactamente `partes`, `inmueble`, `poder_banco`, `analisis_legal`, `hipoteca_anterior`. **No hay bloque "certificado" independiente ni campo alguno que refleje al apoderado desde esa fuente.** La única cédula de apoderado almacenada vive en `data_ia.poder_banco.apoderado_cedula` = `data_final.poder_banco.apoderado_cedula` (ej. cancelación `2fb6ba16…` → `41525143`, idéntica en ambas ramas). Es decir: **hoy el sistema no tiene un segundo dato contra el cual cruzar** — el poder se compara consigo mismo.

## 4. ¿Un Certificado de Tradición y Libertad TÍPICAMENTE trae la cédula del apoderado del banco?

No puedo abrir el PDF/imagen del certificado subido para leerlo textualmente (los archivos están en el bucket privado `expediente-files` y esta auditoría es de solo lectura de código+metadatos). Con esa limitación explícita, la respuesta se basa en la estructura conocida del documento y en el schema que llevamos meses afinando contra certificados reales:

Un Certificado de Tradición y Libertad de la SNR contiene: identificación del inmueble, cadena de tradición, propietarios actuales con cédula, anotaciones (hipotecas, afectaciones, embargos) con las partes involucradas del acto (deudor y **acreedor: el banco como persona jurídica con su NIT**). El apoderado del banco **no es parte del acto registrado** — es un representante interno del banco que firma la cancelación posterior. Por eso el certificado nombra al banco (razón social + NIT) pero **no** identifica cédula personal de ningún funcionario. Coincide con que en 100% de las cancelaciones auditadas, la cédula del apoderado aparece solo dentro del bloque `poder_banco`.

## 5. Veredicto

**No es técnicamente viable hoy** cruzar la cédula del apoderado del banco contra el certificado, y además **no sería viable aunque agregáramos el campo al schema**, porque el documento fuente típicamente no contiene ese dato. El certificado identifica al banco como persona jurídica (NIT), no al funcionario apoderado como persona natural (cédula).

**Fuentes independientes reales** para validar la cédula del apoderado serían:
- Consulta a la **Superintendencia de Notariado y Registro** o RUES por el poder específico (número de escritura + notaría + año).
- Verificación en **RUT/DIAN** de la cédula.
- **Directorio interno de apoderados vigentes por banco** (lista blanca mantenida en la plataforma), cruzable contra el OCR del poder.

Recomendación (a decidir en otra iteración, sin implementar ahora): la opción más barata y accionable es un **directorio de apoderados vigentes por banco** (tabla `bank_apoderados` con `entidad`, `cedula`, `nombre`, `escritura_poder`, `vigente_hasta`), poblado manualmente o desde poderes ya validados históricamente. Da un segundo dato real contra el cual cruzar sin depender de fuentes externas.

## Limitaciones honestas de esta auditoría

- No leí el contenido binario de ningún PDF/imagen de certificado subido; el veredicto sobre "qué trae típicamente" se apoya en la estructura conocida del documento SNR y en que el schema (afinado empíricamente) nunca necesitó capturar cédula de apoderado desde ahí.
- No revisé si algún operador humano ha copiado manualmente la cédula del apoderado en algún campo libre del expediente — solo audité los bloques estructurados de `data_ia`/`data_final`.

## Cambios propuestos

**Ninguno.** Esta es una auditoría; no toco código.

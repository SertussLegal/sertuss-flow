---
name: verificar-consistencia-notarial
description: Auditoría cruzada entre múltiples fuentes PDF notariales — Certificado de Tradición ↔ Escritura antecedente por número/fecha/notaría, y coherencia intra-trámite Poder ↔ Acreedor real por NIT y nombre fuzzy. Úsalo cuando diseñes o revises reglas de reconciliación multi-documento en cancelaciones o escrituras.
type: reference
---

# Verificación de consistencia notarial multi-documento

## 1) Cruce Escritura ↔ Certificado de Tradición (capa clásica)

Trigger: `after_multi_pdf_extraction`. Se ejecuta en el backend en cuanto Gemini termina de parsear en paralelo el certificado de tradición y la escritura de hipoteca antecedente.

Inputs:

- `datos_certificado: { numero_escritura, fecha, notaria }`
- `datos_escritura_fisica: { numero_escritura, fecha, notaria }`

Regla determinista: normalizar `numero_escritura` a solo dígitos y comparar. Si difieren → alerta de discrepancia y se mantienen los valores del certificado por seguridad jurídica registral.

```ts
export function execute(input: { datos_certificado: any; datos_escritura_fisica: any }) {
  const cert = input.datos_certificado;
  const esc = input.datos_escritura_fisica;
  const nCert = String(cert.numero_escritura ?? "").replace(/[^0-9]/g, "");
  const nEsc  = String(esc.numero_escritura ?? "").replace(/[^0-9]/g, "");
  const ok = nCert === nEsc && nCert !== "";
  if (!ok) {
    return {
      consistencia_aprobada: false,
      datos_saneados: cert,
      alerta: "⚠️ DISCREPANCIA: El número de la escritura de hipoteca en el certificado de tradición no coincide con el de la escritura física cargada.",
    };
  }
  return {
    consistencia_aprobada: true,
    datos_saneados: {
      numero_escritura: nCert,
      notaria: esc.notaria ?? cert.notaria,
      fecha: esc.fecha ?? cert.fecha,
    },
    alerta: null,
  };
}
```

---

## 2) Coherencia intra-trámite: Poder ↔ Acreedor real

**Fuente:** `supabase/functions/_shared/isomorphic/poderBancoExtractor/validateIntraTramite.ts` — `validatePoderVsCancelacion(merged, partes)`.

Valida que el `poder_banco.poderdante` (banco que otorga el poder) sea el **mismo** banco que aparece como acreedor hipotecario en la escritura antecedente / certificado de tradición del mismo trámite. Cubre el caso de poder auténtico e internamente coherente pero **autorizado sobre banco distinto** al acreedor real.

### Regla 1 (primaria) — NIT vs NIT

Cuando `poderdante.entidad_nit` y `partes.banco_nit` **ambos** están presentes:

- Normalización: solo dígitos (`.replace(/[.\s\-]/g, "").replace(/\D/g, "")`).
- Si difieren → warning `poder_entidad_nit_incoherente` (HARD_BLOCK, sufijo `_incoherente`).
- Suspicious paths: `poderdante.entidad_nit`, `partes.banco_nit`.
- Si coinciden → **cualquier ruido textual del nombre se ignora** (ej. `"DAVIVIENDA"` vs `"BANCO DAVIVIENDA S.A."` no dispara nada). El NIT gana.

### Regla 2 (respaldo) — nombre fuzzy, SOLO si falta ≥1 NIT

- Normalización portada defensivamente desde `src/lib/bankDirectory.ts` (no importable desde edges): quita acentos, mayúsculas, sufijos comerciales (`S.A./S.A.S/LTDA/E.U.`), colapsa espacios.
- Match = igualdad o contención bidireccional de nombres normalizados.
- Si NO matchea → warning `poder_entidad_nombre_incoherente` (HARD_BLOCK).
- Suspicious paths: `poderdante.entidad_nombre`, `partes.banco_acreedor`.

Ambos warnings entran al pipeline hard-block descrito en el skill `validar-poder-general-banco` (capa 2), así que bloquean generación del docx hasta corrección humana.

**Tests:** `src/shared/poderBancoValidateIntraTramite.test.ts` (7 casos: Regla 1 hit, Regla 1 formatos distintos, Regla 2 hit, Regla 2 fuzzy limpio, Regla 2 no doble-dispara si NITs coinciden, prioridad Regla 1 sobre Regla 2, contrato HARD_BLOCK).

---

## Anti-ejemplos

- ❌ Aplicar la Regla 2 cuando ambos NITs están presentes → produce falsos positivos por variaciones legales del nombre (`"DAVIVIENDA"` vs `"BANCO DAVIVIENDA S.A."`).
- ❌ Comparar NITs sin normalizar (`"860.034.313-7"` vs `"860034313-7"` marcaría diff falso).
- ❌ Importar `src/lib/bankDirectory.ts` desde una edge function — el bundler solo resuelve dentro de `supabase/functions/`. La normalización se re-implementa dentro de `_shared/isomorphic/`.
- ❌ Convertir la Regla 1 en una señal blanda / warning informativo — NIT distinto es contradicción legal directa, debe ser HARD_BLOCK.
- ❌ Cruzar solo `numero_escritura` sin considerar `fecha` y `notaria` en el reporte de discrepancia (la trazabilidad legal requiere los tres).



## Auditoría del Plan: 3 Problemas Críticos Detectados

### Problema 1: Mapeo de tipos INCORRECTO (BUG ACTIVO)

En `Validacion.tsx` líneas 941-943, `handleSidebarUpload` mapea los tipos de forma errónea:

```text
carta_credito  → certificado_tradicion  ❌ (debería ser "carta_credito")
poder_notarial → escritura_antecedente   ❌ (debería ser "poder_banco")
```

Esto significa que si alguien sube una carta de crédito desde el panel, el OCR la procesa como si fuera un certificado de tradición — extrayendo datos completamente incorrectos.

**Fix**: Corregir el mapeo a los tipos reales que `scan-document` espera.

---

### Problema 2: Sin hidratación de `actos` post-OCR

Cuando `ActosForm` manejaba la carga internamente, `handleScanHipoteca` (líneas 111-130) aplicaba los resultados OCR directamente al estado `actos`:
- `poder_banco` → 9 campos (entidad_bancaria, apoderado_nombre, apoderado_cedula, etc.)
- `carta_credito` → 2 campos (valor_hipoteca, entidad_bancaria)

`handleSidebarUpload` **no tiene esta lógica**. Solo hidrata `inmueble`, `personas` y `documento`. Al mover los botones al panel, los datos del poder y la carta **nunca llegarán a los campos de Actos**.

**Fix**: Añadir bloques de hidratación de `actos` en `handleSidebarUpload` para `poder_notarial` y `carta_credito`.

---

### Problema 3: Sin consumo de créditos

`ActosForm.handleScanHipoteca` llama `consume_credit` antes del OCR y `restore_credit` en caso de error (líneas 94-98, 134-135). `handleSidebarUpload` **no consume créditos**. Esto significa que cada escaneo desde el panel es gratuito — un bug de facturación.

**Fix**: Añadir `consume_credit` al inicio y `restore_credit` en el catch de `handleSidebarUpload`.

---

### Problema 4 (menor): Botones de ActosForm aún presentes

El plan anterior no incluía `ActosForm.tsx` en los archivos a modificar. Los botones "Cargar Poder" y "Cargar Carta" (líneas 213-216) siguen ahí, duplicando la funcionalidad del panel.

---

## Plan Corregido

### Paso 1: `src/pages/Validacion.tsx` — Corregir `handleSidebarUpload`

**1a. Consumo de créditos** — Añadir al inicio:
```typescript
const { data: hasCredit } = await supabase.rpc("consume_credit", { org_id: profile.organization_id });
if (!hasCredit) {
  toast({ title: "Sin créditos", variant: "destructive" });
  setSidebarUploading(null);
  return;
}
```
Y en el catch: `await supabase.rpc("restore_credit", { org_id: profile.organization_id });`
Añadir `await refreshCredits();` en el finally.

**1b. Mapeo correcto de tipos** (líneas 941-943):
```typescript
const scanType = tipo === "carta_credito" ? "carta_credito"
  : tipo === "poder_notarial" ? "poder_banco"
  : tipo as any;
```

**1c. Hidratación de `actos`** — Después de la hidratación de `inmueble`/`personas`/`documento`, añadir:
```typescript
if (tipo === "poder_notarial" && d) {
  setActos(prev => ({
    ...prev,
    entidad_bancaria: d.entidad_bancaria || prev.entidad_bancaria,
    apoderado_nombre: d.apoderado_nombre || prev.apoderado_nombre,
    apoderado_cedula: d.apoderado_cedula || prev.apoderado_cedula,
    apoderado_expedida_en: d.apoderado_expedida_en || prev.apoderado_expedida_en,
    apoderado_escritura_poder: d.escritura_poder_num || prev.apoderado_escritura_poder,
    apoderado_fecha_poder: d.fecha_poder || prev.apoderado_fecha_poder,
    apoderado_notaria_poder: d.notaria_poder || prev.apoderado_notaria_poder,
    apoderado_notaria_ciudad: d.notaria_poder_ciudad || prev.apoderado_notaria_ciudad,
    apoderado_email: d.apoderado_email || prev.apoderado_email,
  }));
}
if (tipo === "carta_credito" && d) {
  setActos(prev => ({
    ...prev,
    valor_hipoteca: d.valor_credito || prev.valor_hipoteca,
    entidad_bancaria: d.entidad_bancaria || prev.entidad_bancaria,
  }));
}
```

**1d. Actualizar dependencias del useCallback** — Añadir `refreshCredits`, `setActos`, `credits`.

### Paso 2: `src/components/tramites/ActosForm.tsx` — Limpiar

- Eliminar: `poderInputRef`, `cartaInputRef`, `scanning`, `handleScanHipoteca`, `renderUploadButton`, `fileToBase64`, imports de `Upload`, `Loader2`, `supabase`, `useAuth`, `useToast`, type `HipotecaScanType`
- Eliminar el bloque de botones (líneas 213-216)
- Mantener: `ocrFields`, `suggestions`, `applyOcrResults`, `update`, `ocr()`, `wrapWithSuggestion` — estos podrían usarse si en el futuro se inyectan sugerencias desde el padre
- El header de hipoteca queda: solo `<h4>Datos de Hipoteca</h4>` sin botones

### Resumen

| Archivo | Cambio |
|---|---|
| `Validacion.tsx` | Créditos + mapeo correcto + hidratación actos |
| `ActosForm.tsx` | Eliminar botones, refs, handlers de carga |

2 archivos. Sin migraciones. 3 bugs críticos corregidos.




## Plan: Restaurar slots de cédulas de personas en DocumentUploadStep

### Problema
La refactorización eliminó los slots para cédulas de compradores y vendedores. Solo quedaron los 3 documentos del inmueble.

### Cambio en `src/components/tramites/DocumentUploadStep.tsx`

**Agregar sección dinámica de cédulas** antes de los documentos del inmueble:

1. **Dos grupos de slots dinámicos**:
   - "Cédulas de Vendedores" — inicia con 1 slot, botón "+ Agregar vendedor"
   - "Cédulas de Compradores" — inicia con 1 slot, botón "+ Agregar comprador"
   - Cada slot acepta imagen o PDF y se envía a `scan-document` con `type: "cedula_persona"`

2. **Los 3 slots existentes del inmueble se mantienen** (certificado, predial, escritura)

3. **Al continuar**: los datos extraídos de cédulas se agregan a `extracted_personas` en el metadata, con su rol (vendedor/comprador) y nivel de confianza

### UI
```text
┌─────────────────────────────────┐
│  Cédulas de Vendedores          │
│  [Slot 1: Subir]  [+ Agregar]  │
├─────────────────────────────────┤
│  Cédulas de Compradores         │
│  [Slot 1: Subir]  [+ Agregar]  │
├─────────────────────────────────┤
│  Documentos del Inmueble        │
│  - Certificado de Tradición     │
│  - Cédula Catastral / Predial   │
│  - Escritura Antecedente        │
└─────────────────────────────────┘
```

### Lógica de `handleContinue`
- Personas extraídas de cédulas se insertan en `extracted_personas` con `rol: "vendedor"` o `"comprador"`
- Se fusionan con las personas que ya se extraen del certificado de tradición (evitando duplicados por número de cédula)

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/components/tramites/DocumentUploadStep.tsx` | Agregar slots dinámicos para cédulas de vendedores y compradores |

Un solo archivo.


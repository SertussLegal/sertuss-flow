

## Plan: Validación cruzada de roles con certificado de tradición

### Problema

El usuario puede subir cédulas en la sección equivocada (vendedores como compradores o viceversa). También puede omitir cédulas de un grupo completo sin darse cuenta.

### Solución

Usar el certificado de tradición como fuente de verdad. Este documento lista los propietarios actuales del inmueble, que en una compraventa son los **vendedores**. Al cruzar los números de cédula extraídos se pueden detectar 3 situaciones:

1. **Cédula en "Compradores" que coincide con un propietario del certificado** → Sugerir moverla a Vendedores
2. **Cédula en "Vendedores" que NO coincide con ningún propietario del certificado** → Advertir que podría ser comprador
3. **Propietarios del certificado sin cédula cargada en ningún grupo** → Sugerir que faltan cédulas de vendedores

### Cambios en `src/components/tramites/DocumentUploadStep.tsx`

**1. Función `detectRoleIssues()`** que se ejecuta reactivamente (con `useMemo`) cada vez que cambian los slots:

```typescript
type RoleAlert = {
  type: "wrong_role" | "missing_cedula";
  message: string;
  cedula?: string;
  nombre?: string;
  currentRol?: "vendedor" | "comprador";
  suggestedRol?: "vendedor" | "comprador";
  slotIndex?: number;
};
```

Lógica:
- Extrae `propietarios[]` del resultado del certificado de tradición (si ya fue procesado)
- Compara cada cédula procesada en vendedores/compradores contra esa lista
- Genera alertas para cada inconsistencia

**2. Función `moveSlot(fromRol, toRol, index)`** que transfiere un slot completo (file + result + status) de un grupo al otro sin re-procesar el documento.

**3. Alertas visuales** en dos niveles:

- **En la tarjeta individual**: borde ámbar + texto corto + botón "Mover a Vendedores/Compradores"
- **Bloque resumen** (antes de "Continuar"): lista de propietarios del certificado que no tienen cédula cargada, con nombre y número para que el usuario sepa qué documentos buscar

**4. Requisito**: La validación solo se activa cuando el certificado de tradición ya fue procesado. Sin certificado, no hay contra qué cruzar.

### Ejemplo de UX

```text
┌─ Cédulas de Compradores ──────────────────────────┐
│ ┌─────────────────────────────────────────────────┐│
│ │ ⚠ Cédula Comprador 1 — Juan Pérez              ││
│ │   CC 1234567                                    ││
│ │   ┌─────────────────────────────────────────┐   ││
│ │   │ ⚠ Esta persona aparece como propietaria │   ││
│ │   │   en el certificado de tradición.       │   ││
│ │   │   [Mover a Vendedores]                  │   ││
│ │   └─────────────────────────────────────────┘   ││
│ └─────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────┘

┌─ Cédulas faltantes ───────────────────────────────┐
│ ⚠ Los siguientes propietarios del certificado no  │
│   tienen cédula cargada:                          │
│   • María García (CC 9876543)                     │
│   • Pedro López (CC 5432109)                      │
│   Debes cargarlas como Vendedores.                │
└───────────────────────────────────────────────────┘
```

### Archivo a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocumentUploadStep.tsx` | Agregar `detectRoleIssues`, `moveSlot`, alertas en tarjetas y bloque de cédulas faltantes |

Un solo archivo.


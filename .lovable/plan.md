

## Plan: Corregir la previsualización que no llena datos en el panel izquierdo

### Problema raíz

El componente `DocxPreview.tsx` convierte el archivo `.docx` a HTML usando **mammoth**. El problema es que Word internamente divide el texto en múltiples "runs" XML, así que un placeholder como `{comparecientes_vendedor}` en el docx se convierte en HTML fragmentado:

```text
<span>{comparecientes_</span><span>vendedor}</span>
```

o incluso:

```text
<span>{</span><span>comparecientes_vendedor</span><span>}</span>
```

La regex actual (`\{comparecientes_vendedor\}`) busca el texto como cadena continua en el HTML, **no lo encuentra** porque hay tags intermedios, y por eso todos los campos quedan como `___________`.

### Solución

Agregar una función de **normalización** que se ejecute justo después de que mammoth convierta el docx a HTML (línea 117). Esta función busca patrones de `{` seguido de texto y tags intermedios hasta `}` y los une en un solo texto limpio.

### Cambios en `src/components/tramites/DocxPreview.tsx`

**Agregar función `normalizeTemplateTags`** (antes del componente):
- Usa una regex que detecta `{` seguido de cualquier combinación de texto y tags HTML hasta `}` 
- Extrae solo el texto (strip tags), reconstruye como `{variable_limpia}`
- Esto garantiza que `{comparecientes_vendedor}` quede como texto continuo para que las sustituciones funcionen

**Aplicar la normalización** en el `loadTemplate` (línea 117):
```
setBaseHtml(normalizeTemplateTags(result.value));
```

### Archivo a modificar

| Archivo | Cambio |
|---|---|
| `src/components/tramites/DocxPreview.tsx` | Agregar `normalizeTemplateTags()` y aplicarla al resultado de mammoth |

1 solo archivo. No se toca la lógica de reemplazo ni ningún otro componente.


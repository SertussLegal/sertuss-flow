

## Fix: DocxPreview "Multi error"

### Problem
The `DocxPreview` component throws "Multi error" because `docxtemplater` by default throws an error when it encounters template tags (e.g. `{notaria_nombre}`, `{fecha}`, etc.) that aren't provided in `buildTemplateData()`. The Word template has more tags than the code supplies.

### Solution
Add a `nullGetter` option to the `Docxtemplater` constructor in `DocxPreview.tsx` that returns `"___________"` for any undefined tag instead of throwing. This is a single-line fix.

### File: `src/components/tramites/DocxPreview.tsx`

Change the Docxtemplater constructor (around line 63) to include `nullGetter`:

```typescript
const doc = new Docxtemplater(zip, {
  paragraphLoop: true,
  linebreaks: true,
  delimiters: { start: "{", end: "}" },
  nullGetter: () => "___________",
});
```

This same fix should also be verified in `Validacion.tsx`'s `handleConfirmGenerate` function where docxtemplater is used for the final document generation.

### Verification
- After fix, the left panel should render the Word template as HTML with placeholder values (`___________`) for unfilled fields
- As the user types in the forms, the preview should update reactively


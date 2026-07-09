---
name: "limpieza-segura-codigo"
description: "Use cuando solicite limpiar código muerto, refactorizar componentes visuales, eliminar comentarios basura de desarrollo o remover redundancias en el repositorio, asegurando que no se altere la lógica funcional."
---

# Playbook de Limpieza Segura de Código y Refactorización


Este skill guía el proceso de limpieza de "basura" en el código del sitio (deuda técnica, estilos huérfanos, console.logs de prueba y funciones en desuso) sin alterar el comportamiento esperado por el usuario ni romper integraciones de base de datos.

## 🎯 Elementos Considerados "Basura" a Eliminar

1. **Código Muerto:** Funciones, variables o componentes importados que no se están utilizando en ningún archivo (`unused imports`).
2. **Basura de Depuración:** Declaraciones `console.log`, comentarios `// TODO: arreglar esto` o bloques de código comentados antiguos.
3. **Redundancias Visuales:** Clases de CSS o Tailwind repetidas o estilos aplicados que se contradicen entre sí en la UI.
4. **Plantillas Huérfanas:** Variables viejas dentro de los mapeos de Word que ya no se usan en las minutas actuales de la Notaría.

## 🛡️ Protocolo de Seguridad Obligatorio (Para No Romper Nada)

Antes de confirmar cualquier eliminación o cambio en el repositorio, Lovable debe verificar las siguientes restricciones:

- **Efecto Dominó:** No elimines ninguna función o tipo (`interface` / `type`) sin antes rastrear que no esté siendo importada por otros módulos o páginas secundarias.
- **Políticas de Base de Datos (Supabase):** Está terminantemente PROHIBIDO alterar nombres de columnas de tablas, tipos de datos en la base de datos o firmas de Edge Functions sin una orden explícita. La limpieza se concentra en la capa de aplicación (Frontend/React y lógica de mapeo).
- **Consistencia de Tipos:** Si limpias un campo en desuso de un formulario, asegúrate de removerlo también de sus esquemas de validación (Zod o TypeScript) para evitar errores en tiempo de compilación.
- **Principio de Preservación Notarial:** Bajo ninguna circunstancia esta limpieza debe alterar los algoritmos de los Skills de negocio activos (`direccion-completa-saneada-cancelacion`, `formato-texto-numero-notarial`, `concordancia-genero-minutas`, `extraccion-cuantia-semantica`, etc.).

## 📋 Flujo de Reporte al Usuario

Al finalizar la limpieza, debes presentar un resumen estructurado en el chat:

- `[Eliminado]`: Lista corta de lo que se borró de forma segura.
- `[Refactorizado]`: Qué código se simplificó para que sea más legible.
- `[Estado]`: Confirmación de que el proyecto compila sin errores (`0 errors, 0 warnings`).

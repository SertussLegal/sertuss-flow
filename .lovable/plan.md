## Sertuss — Plan Final (Colombia Nacional)

1. Autenticación y Rutas Protegidas

Login/registro con email y contraseña, diseño corporativo azul oscuro/verde

Rutas protegidas, tabla user_roles separada con RLS

2. Dashboard de Escrituras

Tabla de trámites: radicado, tipo, fecha, estado (badges: Pendiente/Validado/Word Generado)

Botón "+ Nuevo Trámite", filtros por estado y búsqueda

Paleta corporativa: azules (#1a2332, #2d4a7a), verdes (#1b5e3b), acentos dorados

3. Carga de Archivos

Drag & drop para Certificado de Tradición y Cédulas (PDF/JPG)

Almacenamiento en Supabase Storage (bucket documentos)

4. Validación Side-by-Side

Panel izquierdo: placeholder visor PDF

Panel derecho: formulario con 4 pestañas:

Vendedores / Compradores (dinámicos)

Switch "¿Es Persona Jurídica?"

Off (persona natural): nombre completo, número de cédula, estado civil, dirección

On (persona jurídica): razón social, NIT, nombre del representante legal, cédula del representante legal, dirección

Agregar/quitar personas dinámicamente

Inmueble

Matrícula inmobiliaria

Identificador Predial con selector: CHIP o Número Predial Nacional (30 dígitos) — obligatorio

Departamento y Municipio

Círculo Registral / ORIP (código de Oficina de Registro)

Selector Urbano / Rural

Dirección, estrato, área

Linderos: textareas extensas con scroll

Valorización (campo genérico, no específico de IDU)

Actos

Tipo de acto, valor de compraventa

Switch "Acto de Hipoteca" → muestra/oculta: valor hipoteca, entidad bancaria, apoderado del banco (nombre y cédula)

Switch "Afectación a Vivienda Familiar"

5. Modal de Previsualización

Resumen completo formateado antes de generar Word

Botones: "Confirmar y Generar" / "Volver a Editar"

6. Lógica de Estados

tramites.status: pendiente → validado (al guardar formulario) → word_generado (al confirmar generación)

7. Base de Datos (Lovable Cloud)

Tablas: profiles, user_roles, tramites, vendedores, compradores, inmuebles, actos

Campos de persona jurídica: es_persona_juridica, nit, razon_social, representante_legal_nombre, representante_legal_cedula

Campos inmueble: tipo_identificador_predial (chip/predial_nacional), identificador_predial, departamento, municipio, codigo_orip, tipo_predio (urbano/rural), valorizacion

RLS por usuario, Storage para documentosAgregar campo PEP (Persona Expuesta Políticamente)

Añadir un checkbox **"¿Persona Expuesta Políticamente (PEP)?"** en las secciones dinámicas de **Vendedores** y **Compradores**, como parte del cumplimiento SARLAFT.

### Cambios:

- **Formulario de Vendedores/Compradores**: Agregar un checkbox "¿Es PEP?" debajo de los datos de identificación de cada persona (tanto natural como jurídica/representante legal)
- **Base de datos**: Agregar columna `es_pep BOOLEAN DEFAULT false` a las tablas `vendedores` y `compradores`
- **Modal de previsualización**: Mostrar el estado PEP de cada parte cuando esté marcado
- **Etiqueta descriptiva**: Incluir tooltip o texto auxiliar: *"Según circular SARLAFT — Persona que desempeña o ha desempeñado funciones públicas destacadas"*
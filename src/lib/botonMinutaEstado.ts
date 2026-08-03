// ============================================================================
// Máquina de estados del botón principal de la minuta.
//
// REGLA DE ORO (decisión del dueño de producto, 2026-08-03):
// "Descargar se gana en la sesión, nunca se asume". Al cargar la página el
// botón NUNCA arranca en "descargar", aunque exista un .docx en el bucket:
// solo se llega a "descargar" tras una generación exitosa DENTRO de la
// sesión actual, y cualquier edición posterior lo devuelve a "generar".
//
// Función pura, sin React ni side-effects. Test: `botonMinutaEstado.test.ts`.
// ============================================================================

export type EstadoBotonMinuta = "pendientes" | "generar" | "generando" | "descargar";

export interface EntradaBotonMinuta {
  /** Nº de alertas prioritarias vigentes (decisiones pendientes del humano). */
  prioritarias: number;
  /** Hay una generación en vuelo ahora mismo. */
  generando: boolean;
  /** Hubo una generación exitosa en ESTA sesión (se resetea al recargar). */
  generadoEnSesion: boolean;
  /** Hay ediciones sin persistir/regenerar. */
  isDirty: boolean;
}

export interface SalidaBotonMinuta {
  estado: EstadoBotonMinuta;
  label: string;
  /** El click no dispara nada (solo abre el listado de pendientes). */
  disabled: boolean;
  /** Variante visual: ámbar cuando hay decisiones pendientes. */
  tono: "primario" | "ambar" | "espera";
}

export function botonMinutaEstado(e: EntradaBotonMinuta): SalidaBotonMinuta {
  // 1. Las decisiones pendientes mandan sobre todo lo demás.
  if (e.prioritarias > 0) {
    return {
      estado: "pendientes",
      label: `Acciones pendientes (${e.prioritarias})`,
      disabled: false,
      tono: "ambar",
    };
  }
  // 2. Generación en vuelo.
  if (e.generando) {
    return { estado: "generando", label: "Generando…", disabled: true, tono: "espera" };
  }
  // 3. Descargar solo si se ganó en la sesión Y nada cambió después.
  if (e.generadoEnSesion && !e.isDirty) {
    return { estado: "descargar", label: "Descargar minuta", disabled: false, tono: "primario" };
  }
  // 4. Por defecto (incluye la carga inicial de la página).
  return { estado: "generar", label: "Generar minuta", disabled: false, tono: "primario" };
}

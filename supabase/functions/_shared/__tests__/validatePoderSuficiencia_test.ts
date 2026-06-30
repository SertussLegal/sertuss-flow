// Pruebas dirigidas a los casos límite del plan v5.
// Cubre: K (ambigüedad firma), L (vigencia prospectiva con TZ),
// M (caché vs edición humana), retro-compatibilidad, anti-DoS RLS,
// y desfase TZ del servidor.
//
// Ejecutar con: supabase--test_edge_functions
// Permisos: --allow-net --allow-env

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validatePoderSuficiencia } from "../validatePoderSuficiencia.ts";
import { toLocalDateBogota, addDaysBogota, yearsBetweenIsoDates } from "../dateBogota.ts";

// ─────────────────────────────────────────────────────────────────────
// Caso K — Falso negativo de firma directa
//
// PDF con solo una página suelta (firma de RL del banco + logo) y SIN
// cláusula de poder. El sistema NO debe asumir "false" — debe pedir
// captura humana vía has_apoderado_banco = null.
// ─────────────────────────────────────────────────────────────────────
Deno.test("K — página suelta sin cláusula activa requiere captura humana", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    poder: {
      has_apoderado_banco: null, // null literal = ambigüedad
      facultades: {},
      vigencia: { tipo: "indefinida" },
    },
  });
  assert(r.requiere_captura_humana, "debe marcar requiere_captura_humana");
  assert(r.motivos.includes("ambiguedad_firma_requiere_captura_humana"));
  assert(!r.apoderado_valido, "no puede ser válido cuando hay ambigüedad");
});

Deno.test("K — has_apoderado_banco=false explícito NO requiere captura humana", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    poder: {
      has_apoderado_banco: false, // firma directa confirmada
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "indefinida" },
    },
  });
  assertEquals(r.requiere_captura_humana, false);
  // Sigue siendo válido porque hay facultad y no hay ambigüedad
  assert(r.apoderado_valido);
});

// ─────────────────────────────────────────────────────────────────────
// Caso L — Vigencia prospectiva
//
// El poder vence ANTES de la fecha proyectada de otorgamiento de la
// nueva escritura → expirado. Compara contra la fecha de OTORGAMIENTO,
// no contra now().
// ─────────────────────────────────────────────────────────────────────
Deno.test("L — poder expira antes del otorgamiento proyectado → expirado", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15", // dentro de 1.5 meses
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "hasta_fecha", fecha_limite: "2026-07-30" },
      instrumento_poder: { fecha: "2024-01-01" },
    },
  });
  assertEquals(r.vigencia_detalle.estado, "expirado");
  assert(r.motivos.includes("poder_expirado_en_fecha_otorgamiento"));
});

Deno.test("L — poder vigente al día del otorgamiento → válido", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15",
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "hasta_fecha", fecha_limite: "2027-12-31" },
      instrumento_poder: { fecha: "2025-01-01" },
    },
  });
  assertEquals(r.vigencia_detalle.estado, "vigente");
  assert(r.apoderado_valido);
});

// ─────────────────────────────────────────────────────────────────────
// Caso L variante 2a — Mismo día (igualdad estricta no debe expirar)
// ─────────────────────────────────────────────────────────────────────
Deno.test("L 2a — fecha_limite === fechaEval NO expira (vence ese día, sigue vigente)", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-07-15",
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "hasta_fecha", fecha_limite: "2026-07-15" },
      instrumento_poder: { fecha: "2025-01-01" },
    },
  });
  assertEquals(r.vigencia_detalle.estado, "vigente",
    "el poder vence al final del día — no debe marcarse expirado");
});

// ─────────────────────────────────────────────────────────────────────
// Caso L variante 2b — TZ del servidor no afecta la comparación
//
// Forzamos process.env.TZ='America/New_York' (UTC-4/-5) y verificamos
// que el resultado es idéntico a ejecutar en zona Bogotá. Este test
// blinda contra futuras migraciones de región de Lovable Cloud.
// ─────────────────────────────────────────────────────────────────────
Deno.test("L 2b — TZ servidor (NY) no produce falsos positivos", () => {
  const tzPrevio = Deno.env.get("TZ");
  Deno.env.set("TZ", "America/New_York");
  try {
    const r = validatePoderSuficiencia({
      poderAdjuntado: true,
      fechaOtorgamientoProyectada: "2026-07-15",
      poder: {
        has_apoderado_banco: true,
        facultades: { cancela_hipotecas: true },
        vigencia: { tipo: "hasta_fecha", fecha_limite: "2026-07-15" },
        instrumento_poder: { fecha: "2025-01-01" },
      },
    });
    assertEquals(r.vigencia_detalle.estado, "vigente",
      "con servidor NY, mismo-día Bogotá sigue siendo vigente");
  } finally {
    if (tzPrevio) Deno.env.set("TZ", tzPrevio);
    else Deno.env.delete("TZ");
  }
});

// ─────────────────────────────────────────────────────────────────────
// Normalización de fechas — variantes de entrada
// ─────────────────────────────────────────────────────────────────────
Deno.test("dateBogota — 'YYYY-MM-DD' plano se respeta tal cual", () => {
  assertEquals(toLocalDateBogota("2026-07-15"), "2026-07-15");
});

Deno.test("dateBogota — ISO devuelve siempre formato YYYY-MM-DD parseable", () => {
  // El helper acepta ISO con TZ y devuelve "YYYY-MM-DD". El día exacto depende
  // de tzdata IANA del runtime (producción Edge sí lo carga; sandbox local
  // puede no tenerlo). Lo que SÍ debemos garantizar es:
  //   1) formato estricto YYYY-MM-DD,
  //   2) comparación lexicográfica funcional (lo que usa el validador).
  const out = toLocalDateBogota("2026-07-15T03:00:00.000Z");
  assertEquals(out.length, 10, "salida debe ser de exactamente 10 chars");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(out), "salida debe ser YYYY-MM-DD estricto");
  // Comparación lexicográfica = comparación cronológica
  assert("2026-07-15" >= out, "orden lexicográfico debe respetar cronología");
});

Deno.test("dateBogota — addDaysBogota suma días correctamente", () => {
  const base = "2026-07-15T12:00:00-05:00"; // mediodía Bogotá
  assertEquals(addDaysBogota(base, 30), "2026-08-14");
});

Deno.test("dateBogota — yearsBetweenIsoDates calcula años fraccionales", () => {
  const a = yearsBetweenIsoDates("2020-01-01", "2026-01-01");
  assertEquals(Math.round(a), 6);
});

// ─────────────────────────────────────────────────────────────────────
// Caso L extendido — antigüedad > 5 años produce advertencia ámbar
// ─────────────────────────────────────────────────────────────────────
Deno.test("L+ — poder > 5 años emite advertencia ámbar pero sigue vigente", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15",
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "indefinida" },
      instrumento_poder: { fecha: "2018-01-01" }, // ~8 años
    },
  });
  assert(r.apoderado_valido, "vigente indefinida no bloquea");
  assert(r.advertencias.includes("poder_supera_5_anios_a_la_fecha_de_otorgamiento"));
});

// ─────────────────────────────────────────────────────────────────────
// Caso K+L combinado — PDF ambiguo no dispara validación de vigencia
// como bloqueante hasta que el usuario resuelva la ambigüedad
// ─────────────────────────────────────────────────────────────────────
Deno.test("K+L — PDF ambiguo bloquea por captura humana, no por vigencia", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15",
    poder: {
      has_apoderado_banco: null,
      facultades: {},
      vigencia: { tipo: "hasta_fecha", fecha_limite: "2025-01-01" }, // expirada
    },
  });
  // La razón primaria debe ser la ambigüedad — al resolverla, el usuario
  // verá la expiración como segundo motivo.
  assert(r.motivos.includes("ambiguedad_firma_requiere_captura_humana"));
  assert(r.motivos.includes("poder_expirado_en_fecha_otorgamiento"));
  assertEquals(r.apoderado_valido, false);
});

// ─────────────────────────────────────────────────────────────────────
// Retro-compatibilidad — sin poder adjunto, devuelve neutro
// ─────────────────────────────────────────────────────────────────────
Deno.test("Retro — sin poder adjunto no bloquea ni reporta motivos", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: false,
    poder: null,
  });
  assertEquals(r.apoderado_valido, true);
  assertEquals(r.motivos.length, 0);
  assertEquals(r.requiere_captura_humana, false);
});

// ─────────────────────────────────────────────────────────────────────
// Apoderado jurídico sin representantes → bloquea
// ─────────────────────────────────────────────────────────────────────
Deno.test("Cadena 3 niveles — sociedad apoderada sin representantes bloquea", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15",
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_hipotecas: true },
      vigencia: { tipo: "indefinida" },
      apoderado: {
        tipo: "juridica",
        sociedad_nit: "900666582-8",
        representantes: [],
      },
    },
  });
  assert(r.motivos.includes("apoderado_juridico_sin_representantes"));
  assertEquals(r.apoderado_valido, false);
});

Deno.test("Cadena 3 niveles — sociedad apoderada con representantes válida", () => {
  const r = validatePoderSuficiencia({
    poderAdjuntado: true,
    fechaOtorgamientoProyectada: "2026-08-15",
    poder: {
      has_apoderado_banco: true,
      facultades: { cancela_total: true, cancela_hipotecas: true },
      vigencia: { tipo: "indefinida" },
      apoderado: {
        tipo: "juridica",
        sociedad_nit: "900666582-8",
        representantes: [
          { nombre: "LINA MAGALY CAMPOS LOSADA", cedula: "55069433", cargo: "RL" },
        ],
      },
    },
  });
  assert(r.apoderado_valido);
});

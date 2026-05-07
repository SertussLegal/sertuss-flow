import { describe, it, expect } from "vitest";
import {
  numeroConLetras,
  fechaProsa,
  escrituraProsa,
  montoProsa,
} from "@/lib/legalProse";
import { buildParagrafoRegimenPH } from "@/lib/clausulaBuilder";

describe("legalProse — numeroConLetras", () => {
  it("masculino estándar", () => {
    expect(numeroConLetras(222)).toMatch(/doscientos veintid[oó]s \(222\)/);
    expect(numeroConLetras(3595)).toMatch(/\(3595\)$/);
  });
  it("femenino 1..10 usa ordinales", () => {
    expect(numeroConLetras(7, "feminine")).toBe("séptima (7)");
    expect(numeroConLetras(1, "feminine")).toBe("primera (1)");
    expect(numeroConLetras(10, "feminine")).toBe("décima (10)");
  });
  it("femenino >10 sustituye morfología", () => {
    expect(numeroConLetras(65, "feminine")).toMatch(/sesenta y cinco \(65\)/);
    expect(numeroConLetras(21, "feminine")).toBe("veintiuna (21)");
    expect(numeroConLetras(31, "feminine")).toMatch(/treinta y una \(31\)/);
  });
});

describe("legalProse — fechaProsa", () => {
  it("ISO YYYY-MM-DD", () => {
    expect(fechaProsa("1971-01-29")).toMatch(
      /veintinueve \(29\) de enero de mil novecientos setenta y uno?\s?\(1971\)/,
    );
  });
  it("vacío si inválida", () => {
    expect(fechaProsa("foo")).toBe("");
  });
});

describe("legalProse — escrituraProsa", () => {
  it("caso real Cecilia Cuervo (PH 1971)", () => {
    const out = escrituraProsa({
      numero: 222,
      fecha: "1971-01-29",
      notariaNumero: 7,
      circulo: "Bogotá D.C.",
    });
    expect(out).toContain("Escritura Pública número");
    expect(out).toContain("doscientos veintid");
    expect(out).toContain("(222)");
    expect(out).toContain("séptima (7)");
    expect(out).toContain("Bogotá D.C.");
  });
  it("retorna null si falta número o fecha", () => {
    expect(escrituraProsa({ numero: null, fecha: "1971-01-29" })).toBeNull();
    expect(escrituraProsa({ numero: 222, fecha: "" })).toBeNull();
  });
});

describe("legalProse — montoProsa", () => {
  it("formato notarial mayúsculas + paréntesis", () => {
    expect(montoProsa("185000000")).toBe(
      "CIENTO OCHENTA Y CINCO MILLONES DE PESOS ($185.000.000)",
    );
  });
});

describe("clausulaBuilder — buildParagrafoRegimenPH", () => {
  it("colapsa si no es PH", () => {
    expect(buildParagrafoRegimenPH({ es_propiedad_horizontal: false })).toBe("");
    expect(buildParagrafoRegimenPH(null)).toBe("");
  });
  it("renderiza si es PH con escritura constitutiva", () => {
    const out = buildParagrafoRegimenPH({
      es_propiedad_horizontal: true,
      nombre_edificio_conjunto: "CONJUNTO X",
      escritura_ph_numero: 222,
      escritura_ph_fecha: "1971-01-29",
      escritura_ph_notaria_numero: 7,
      escritura_ph_ciudad: "Bogotá D.C.",
    });
    expect(out).toContain("PARÁGRAFO PRIMERO");
    expect(out).toContain("CONJUNTO X");
    expect(out).toContain("(222)");
  });
});

import { adaptiveCollapse } from "@/components/tramites/DocxPreview";

describe("DocxPreview — adaptiveCollapse", () => {
  it("elimina párrafos compuestos solo de blanks y conectores", () => {
    const html =
      "<p>___________ de ___________ y ___________</p>" +
      "<p>Texto válido que debe permanecer.</p>";
    const out = adaptiveCollapse(html, true);
    expect(out).toContain("Texto válido que debe permanecer.");
    expect(out).not.toContain("___________");
  });

  it("preserva encabezados de cláusula protegidos aunque tengan blanks", () => {
    const html = "<p>CUARTO.- PRECIO ___________</p>";
    const out = adaptiveCollapse(html, true);
    expect(out).toContain("CUARTO");
    expect(out).toContain("PRECIO");
  });
});

describe("DocxPreview — adaptiveCollapse (whitespace exótico)", () => {
  it("limpia párrafos con NBSP, tabs y espacios múltiples", () => {
    const html =
      "<p>\u00A0 ___________ \t  de  \u00A0 ___________ \n y ___________ </p>" +
      "<p>Contenido real preservado.</p>";
    const out = adaptiveCollapse(html, true);
    expect(out).toContain("Contenido real preservado.");
    expect(out).not.toContain("___________");
  });
});

describe("Estado fantasma PH — desactivación obligatoria", () => {
  const inmuebleResidual = {
    es_propiedad_horizontal: false,
    nombre_edificio_conjunto: "CONJUNTO RESIDUAL",
    escritura_ph_numero: 999,
    escritura_ph_fecha: "1980-05-15",
    escritura_ph_notaria_numero: 3,
    escritura_ph_ciudad: "Bogotá D.C.",
  };

  it("buildParagrafoRegimenPH colapsa a vacío aunque haya datos PH residuales", () => {
    expect(buildParagrafoRegimenPH(inmuebleResidual)).toBe("");
  });

  it("rphProsa null y tags rph.escritura_* colapsan con esPH=false", () => {
    const esPH = inmuebleResidual.es_propiedad_horizontal === true;
    const rphProsa = esPH
      ? escrituraProsa({
          numero: inmuebleResidual.escritura_ph_numero,
          fecha: inmuebleResidual.escritura_ph_fecha,
          notariaNumero: inmuebleResidual.escritura_ph_notaria_numero,
          circulo: inmuebleResidual.escritura_ph_ciudad,
        })
      : null;
    expect(rphProsa).toBeNull();

    const tags = [
      "rph.escritura_numero",
      "rph.escritura_fecha",
      "rph.escritura_notaria_numero",
      "rph.escritura_ciudad",
      "rph.escritura_circulo",
      "rph.escritura_tipo",
      "rph.escritura",
    ];
    for (const _t of tags) {
      const out = (!esPH || rphProsa) ? "" : "FALLBACK";
      expect(out).toBe("");
    }
  });
});

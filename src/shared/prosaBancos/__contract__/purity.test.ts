// ============================================================================
// purity.test.ts — Garantiza que ningún archivo de `src/shared/prosaBancos/`
// importe APIs de Deno, navegador, React, Supabase Database types o URLs
// npm:/deno.land. Falla en compilación cruzada si se rompe el aislamiento.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SHARED_DIR = join(process.cwd(), "src/shared/prosaBancos");

// Los patrones se evalúan sobre CÓDIGO REAL (sin comentarios) para no falsear
// positivos con la propia documentación de reglas.
const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "Supabase Database types", re: /from\s+["']@\/integrations\/supabase\/(client|types)["']/ },
  { label: "Deno API", re: /\bDeno\.\w+/ },
  { label: "window global", re: /\bwindow\./ },
  { label: "document global", re: /\bdocument\./ },
  { label: "npm: specifier", re: /from\s+["']npm:/ },
  { label: "deno.land URL", re: /from\s+["']https?:\/\/deno\.land/ },
  { label: "React import", re: /from\s+["']react["']/ },
  { label: "React types", re: /import\s+type[^;]*from\s+["']react["']/ },
  { label: "Node fs module", re: /from\s+["']node:fs["']/ },
  { label: "Node path module", re: /from\s+["']node:path["']/ },
];

/** Elimina comentarios de bloque y de línea para que las reglas no se
 * matcheen contra el copy educativo dentro del propio archivo. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "__contract__") continue; // los tests sí pueden usar node:fs
      walk(full, files);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("prosaBancos: pureza isomórfica", () => {
  const files = walk(SHARED_DIR);

  it("encuentra al menos un archivo TS", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(process.cwd() + "/", "")} está libre de imports prohibidos`, () => {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const { label, re } of FORBIDDEN_PATTERNS) {
        expect(re.test(src), `${label} encontrado en ${file}`).toBe(false);
      }
    });
  }
});

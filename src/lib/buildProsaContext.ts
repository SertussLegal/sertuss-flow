// ============================================================================
// buildProsaContext — Mapea `poder_banco` + `notaria_emisora` del trámite
// al `ProsaContext` isomórfico usado por `daviviendaTemplate` y `mergeOverride`.
//
// Es tolerante: si la extracción v5 pobló el objeto anidado (`pb.apoderado`)
// lo usa; si solo hay los campos planos legacy, sintetiza el mismo shape.
// ============================================================================

import type {
  ProsaContext,
  ApoderadoPayload,
  PoderdantePayload,
  InstrumentoPoderPayload,
} from "@shared/prosaBancos/types";

interface FlatPoderBanco {
  apoderado_nombre?: string;
  apoderado_cedula?: string;
  apoderado_escritura?: string;
  apoderado_fecha?: string;
  apoderado_notaria_poder?: string;
  apoderado_genero?: "M" | "F" | "";
  apoderado?: Record<string, unknown>;
  poderdante?: Record<string, unknown>;
  instrumento_poder?: Record<string, unknown>;
}

interface FlatNotariaEmisora {
  notaria_emisora_ciudad?: string;
}

export function buildProsaContext(
  poderBanco: FlatPoderBanco | null | undefined,
  notariaEmisora?: FlatNotariaEmisora | null,
): ProsaContext {
  const pb = poderBanco ?? {};
  const apoNested = (pb.apoderado ?? {}) as Record<string, unknown>;

  // Merge nested (v5) sobre plano (legacy). Nested gana, con caídas al plano.
  const apoderado: ApoderadoPayload = {
    ...(apoNested as ApoderadoPayload),
    nombre: (apoNested.nombre as string) ?? pb.apoderado_nombre ?? null,
    cedula: (apoNested.cedula as string) ?? pb.apoderado_cedula ?? null,
    escritura_poder_num:
      (apoNested.escritura_poder_num as string) ?? pb.apoderado_escritura ?? null,
    escritura_poder_fecha:
      (apoNested.escritura_poder_fecha as string) ?? pb.apoderado_fecha ?? null,
    escritura_poder_notaria_num:
      (apoNested.escritura_poder_notaria_num as string) ??
      pb.apoderado_notaria_poder ??
      null,
  };

  const poderdante = (pb.poderdante ?? {}) as PoderdantePayload;
  const instrumento = (pb.instrumento_poder ?? {}) as InstrumentoPoderPayload;

  return {
    apoderado,
    poderdante,
    instrumento,
    ciudad_firma: notariaEmisora?.notaria_emisora_ciudad ?? null,
    notas_adicionales: null,
  };
}

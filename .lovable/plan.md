# Diseño — Tabla `credit_prices` como fuente única de precios

**Alcance**: propuesta de diseño. NO se ejecuta nada hasta aprobación explícita.

---

## 1. DDL propuesto de `credit_prices`

```sql
CREATE TABLE public.credit_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action       text NOT NULL,              -- 'OCR_DOCUMENTO' | 'APERTURA_EXPEDIENTE' | 'GENERACION_DOCX' | ...
  tipo_acto    text NOT NULL,              -- 'compraventa_hipoteca' | 'cancelacion_hipoteca' | '*'
  credits      integer NOT NULL CHECK (credits >= 0 AND credits <= 100),
  active       boolean NOT NULL DEFAULT true,
  notes        text,
  updated_by   uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credit_prices_action_tipo_unique UNIQUE (action, tipo_acto)
);

GRANT SELECT ON public.credit_prices TO authenticated;   -- lectura para toda la app
GRANT ALL    ON public.credit_prices TO service_role;    -- edge functions y admin
ALTER TABLE public.credit_prices ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier authenticated. Es un catálogo público de precios, sin org.
CREATE POLICY "credit_prices readable by authenticated"
  ON public.credit_prices FOR SELECT TO authenticated USING (true);

-- Escritura: SOLO super-admin de plataforma (info@sertuss.com vía is_platform_admin()).
CREATE POLICY "credit_prices writable by platform admin"
  ON public.credit_prices FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Trigger updated_at reutilizando public.set_updated_at()
CREATE TRIGGER trg_credit_prices_updated_at
  BEFORE UPDATE ON public.credit_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Decisiones clave**
- **Global sin `organization_id`**: los precios son de plataforma, no por notaría. Simplifica RLS y cache. Si a futuro se quiere pricing por org, se agrega columna nullable `organization_id` y se cambia el UNIQUE.
- **`tipo_acto = '*'`** como comodín para acciones globales (ej. `OCR_DOCUMENTO` que aplica a cualquier trámite).
- **`active`** para deprecar sin borrar (auditoría histórica).
- **UNIQUE (action, tipo_acto)** garantiza un único precio vigente por combinación.

---

## 2. Migración de los 3 lugares actuales

### 2a. `consume_credit_v2` — **recomendación: resolver server-side, ignorar `p_credits` del cliente**

Riesgo actual: `p_credits` viaja desde el navegador. Un atacante con la anon key puede llamar el RPC con `p_credits: 0` y consumir gratis, o con valor negativo si no hubiese CHECK. Hoy no hay validación cruzada.

**Propuesta**: mantener la firma con `p_credits` **por compatibilidad**, pero **ignorarlo si existe un precio en `credit_prices`**. Nueva lógica interna:

```sql
-- pseudo, dentro de consume_credit_v2, antes del UPDATE
v_resolved_credits int;
SELECT credits INTO v_resolved_credits
  FROM public.credit_prices
 WHERE active = true
   AND action = p_action
   AND (tipo_acto = p_tipo_acto OR tipo_acto = '*')
 ORDER BY (tipo_acto = p_tipo_acto) DESC   -- prioriza match exacto
 LIMIT 1;

-- fallback: si no hay fila, usa p_credits (evita romper acciones legacy no catalogadas)
v_final := COALESCE(v_resolved_credits, p_credits, 1);
```

Además, registrar en `credit_consumption.credits` el valor **efectivamente cobrado** (v_final), no el que envió el cliente. Esto blinda contra manipulación y mantiene compatibilidad con call-sites existentes.

### 2b. `unlock_expediente` — reemplazar `2` hardcoded

Cambio quirúrgico dentro de la misma función:

```sql
-- reemplazar: IF ... < 2 THEN y credit_balance - 2 y credits => 2
SELECT credits INTO v_price
  FROM public.credit_prices
 WHERE active = true
   AND action = 'APERTURA_EXPEDIENTE'
   AND (tipo_acto = COALESCE((SELECT tipo FROM public.tramites WHERE id = p_tramite_id), '*')
        OR tipo_acto = '*')
 ORDER BY (tipo_acto <> '*') DESC LIMIT 1;

v_price := COALESCE(v_price, 2);  -- safety net
```

Y usar `v_price` en el chequeo de balance, en el UPDATE y en el INSERT a `credit_consumption` y `activity_logs`.

### 2c. `procesar-cancelacion` — sin llamada extra

**No** hacer un `SELECT` adicional desde la edge function. La resolución ocurre **dentro** de `consume_credit_v2` (punto 2a). La edge function sigue llamando:

```ts
await supabaseUser.rpc("consume_credit_v2", {
  p_org_id, p_user_id,
  p_action: "GENERACION_DOCX",
  p_tramite_id: cancelacionId,
  p_tipo_acto: "cancelacion_hipoteca",
  p_credits: 2,   // fallback/hint; el server resuelve el real desde credit_prices
});
```

Cero llamadas extra, cero cambios de arquitectura en la edge function. El `2` deja de ser autoridad y pasa a ser un fallback defensivo.

---

## 3. Población inicial (sin downtime)

Todo dentro de la **misma migración**, en este orden atómico:

```sql
BEGIN;
  CREATE TABLE ...;                    -- (bloque del punto 1)
  GRANT / RLS / POLICY ...;
  INSERT INTO public.credit_prices (action, tipo_acto, credits, notes) VALUES
    ('OCR_DOCUMENTO',       '*',                     1, 'OCR unitario por documento'),
    ('APERTURA_EXPEDIENTE', 'compraventa_hipoteca',  3, 'Escritura compraventa+hipoteca'),
    ('GENERACION_DOCX',     'cancelacion_hipoteca',  2, 'Cancelación de hipoteca');
  -- Actualización de consume_credit_v2 y unlock_expediente en la MISMA migración
  CREATE OR REPLACE FUNCTION public.consume_credit_v2 ...;
  CREATE OR REPLACE FUNCTION public.unlock_expediente ...;
COMMIT;
```

Como todo va en una sola transacción, no existe momento en que las funciones nuevas lean una tabla vacía. La edge function `procesar-cancelacion` no requiere redeploy (sigue mandando `p_credits: 2` como fallback, y el server ya resuelve desde la tabla).

---

## 4. Trámites en curso al momento del cambio

**No se afectan retroactivamente.** El cobro sucede en dos momentos discretos:

- **Apertura de expediente (escritura)**: se cobra una única vez cuando el usuario pulsa "Abrir expediente" → `unlock_expediente`. Trámites ya abiertos con `is_unlocked=true` **no vuelven a cobrar**. El cambio de 2 → 3 aplica solo a aperturas nuevas posteriores al deploy.
- **Generación de cancelación**: se cobra cada vez que se llama `procesar-cancelacion`. Si un usuario regenera el docx después del deploy, pagará el precio nuevo (2 se mantiene, así que no hay impacto en este caso).
- **OCR**: cobro por documento subido. Los ya subidos no se recobran.

**Consecuencia práctica**: cero clientes afectados por trámites "a medias". El único cambio real de precio es escritura 2 → 3, y solo pega en aperturas nuevas.

---

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fila borrada / `active=false` accidentalmente → cobro cae a 0 o falla | `COALESCE(v_resolved, p_credits, 1)` como safety net + policy que restringe UPDATE/DELETE a `is_platform_admin()`. |
| Cliente sigue mandando `p_credits` manipulado | Server siempre gana: la fila en `credit_prices` es la fuente de verdad. El `p_credits` solo se usa si no hay fila. |
| Race condition al leer `credit_prices` durante un cambio de precio | La lectura ocurre dentro de la misma transacción del cobro (`FOR UPDATE` sobre `organizations`). No hay ventana de inconsistencia por trámite. |
| Cache stale en frontend mostrando precios viejos | El frontend NO debería tomar decisiones de cobro; solo mostrar. Agregar un `SELECT` liviano cacheado 5 min en un hook `useCreditPrices()` para el UI. La autoridad sigue siendo el server. |
| Falta de auditoría de cambios de precio | La tabla ya lleva `updated_by` + `updated_at`. Complementar con `activity_logs` action `CREDIT_PRICE_CHANGE` desde un trigger AFTER UPDATE (opcional, recomendado). |
| Deploy parcial (migración corre, edge function no) | La edge function sigue funcionando con `p_credits: 2` como fallback si `credit_prices` estuviera vacía. Con inserts en la misma migración, este riesgo desaparece. |
| Divergencia futura entre `credit_prices` y `p_credits` que envía el cliente | Loguear un `RAISE NOTICE` o insertar en `system_events` cuando `v_resolved <> p_credits` para detectar call-sites desactualizados. |

---

## Checklist pre-ejecución (para tu aprobación)

- [ ] ¿Confirmas los 3 valores iniciales (OCR=1, escritura=3, cancelación=2)?
- [ ] ¿Confirmas que precios son **globales sin org**?
- [ ] ¿Confirmas que server-side gana sobre `p_credits` del cliente (recomendación de seguridad)?
- [ ] ¿Quieres el trigger opcional de auditoría en `activity_logs` para cambios de precio?
- [ ] ¿Quieres además un UI mínimo en el panel de super-admin para editar la tabla, o por ahora se edita solo vía migraciones?

Al confirmar estos 5 puntos, procedo a implementar en una sola migración + un redeploy opcional de `procesar-cancelacion` (solo si decidimos remover el `p_credits: 2` explícito).

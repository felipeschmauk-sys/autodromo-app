-- Migración: el cronómetro se detiene con bandera roja (Septiembre 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- Con bandera roja nadie corre. Hasta ahora el reloj de la tanda seguía
-- corriendo igual: en la clasificación del 27 de septiembre se puso roja hasta
-- que se acabó el tiempo, y esa tanda se perdió entera.
--
-- En una carrera real ese tiempo se recupera cuando se resuelve el problema.
-- Con estas dos columnas el cronómetro se detiene al caer la roja y vuelve a
-- correr con la verde.
--
--   pausado_ms   suma de todas las pausas ya cerradas
--   pausa_desde  instante en que empezó la pausa en curso (NULL = corriendo)
--
-- Mientras hay una pausa abierta, el final de la tanda se corre al mismo ritmo
-- que el reloj de pared, así que el tiempo restante se queda quieto.
--
-- Si el director finaliza la tanda a mano, se termina y ese tiempo se pierde:
-- finalizar es finalizar.
--
-- Es retrocompatible: con pausado_ms = 0 y pausa_desde NULL todo se comporta
-- exactamente como antes.

ALTER TABLE tandas
  ADD COLUMN IF NOT EXISTS pausado_ms  BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pausa_desde TIMESTAMPTZ;

COMMENT ON COLUMN tandas.pausado_ms IS
  'Milisegundos que la tanda estuvo detenida por bandera roja, sumando las pausas ya cerradas.';
COMMENT ON COLUMN tandas.pausa_desde IS
  'Instante en que empezó la pausa en curso por bandera roja. NULL = el cronómetro está corriendo.';

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- SELECT nombre, tipo, inicio, duracion_min, pausado_ms, pausa_desde
-- FROM tandas ORDER BY inicio DESC LIMIT 10;

-- ── Soltar a mano una pausa que quedó abierta ────────────────
-- (por ejemplo si el panel se cerró con la roja puesta)
-- UPDATE tandas
--    SET pausado_ms  = COALESCE(pausado_ms, 0)
--                    + EXTRACT(EPOCH FROM (now() - pausa_desde)) * 1000,
--        pausa_desde = NULL
--  WHERE id = 'PEGAR-ID' AND pausa_desde IS NOT NULL;

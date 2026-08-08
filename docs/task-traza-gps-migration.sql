-- Migración: traza GPS cruda + reloj de servidor — diagnóstico de cronometraje
-- (Agosto 2026). Correr en Supabase SQL Editor.
--
-- PARA QUÉ SIRVE
--   1. traza_gps guarda CADA lectura del GPS (~1 por segundo) junto con lo que
--      el detector de cruces calculó en ese mismo instante. Con eso se puede
--      reprocesar una tanda completa en el escritorio —probando otros umbrales,
--      buscando vueltas salteadas— sin tener que volver al autódromo.
--   2. hora_servidor() permite que cada teléfono mida cuánto está adelantado o
--      atrasado su propio reloj. Los cruces de meta se marcan con la hora del
--      teléfono: para el tiempo de vuelta de UN piloto eso da igual (el error
--      se cancela solo), pero al comparar DOS pilotos entre sí, un teléfono
--      adelantado 2 s corre TODOS sus gaps 2 s.
--
-- OJO: traza_gps crece rápido (≈1 fila por piloto por segundo en pista).
-- Una tanda de 30 min con 10 autos son ~18.000 filas. Al terminar el capítulo
-- de pruebas conviene vaciarla — ver el DELETE comentado al final.

-- ── 1) Hora del servidor, consultable por la app ──────────────
CREATE OR REPLACE FUNCTION hora_servidor()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$ SELECT now() $$;

GRANT EXECUTE ON FUNCTION hora_servidor() TO anon, authenticated;

-- ── 2) Traza cruda ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traza_gps (
  id              BIGSERIAL PRIMARY KEY,
  piloto_id       UUID NOT NULL,
  sesion_id       UUID NOT NULL,
  tanda_id        UUID,                  -- NULL = giro sin tanda iniciada
  t_dispositivo   TIMESTAMPTZ NOT NULL,  -- reloj del teléfono (el que usa el detector)
  offset_ms       INTEGER,               -- corrección: t_real ≈ t_dispositivo + offset_ms
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  precision_m     REAL,                  -- accuracy del GPS, en metros
  velocidad_ms    REAL,                  -- m/s crudos del GPS
  rumbo           REAL,
  idx_trazado     INTEGER,               -- punto del trazado más cercano
  progreso        REAL,                  -- 0..1 de la vuelta, meta = 0
  armado          BOOLEAN,               -- histéresis del detector en ese instante
  dentro_geocerca BOOLEAN,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS traza_gps_busqueda
  ON traza_gps (tanda_id, piloto_id, t_dispositivo);

ALTER TABLE traza_gps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS traza_gps_all ON traza_gps;
CREATE POLICY traza_gps_all ON traza_gps FOR ALL USING (true) WITH CHECK (true);

-- ── 3) Desfase de reloj en cada cruce de meta ─────────────────
-- Se guarda pero NO se aplica en vivo: así la app se comporta mañana igual que
-- hoy, y la corrección entre pilotos se puede hacer después, en el análisis.
DO $$ BEGIN
  IF to_regclass('public.vueltas') IS NOT NULL THEN
    ALTER TABLE vueltas ADD COLUMN IF NOT EXISTS offset_ms INTEGER;
  END IF;
END $$;

-- ── 4) Refrescar el caché de esquema de la API ────────────────
-- Sin esto, la app puede seguir viendo "no existe la tabla/función" durante un
-- rato aunque acá ya estén creadas, y deja de intentar hasta que se recargue.
NOTIFY pgrst, 'reload schema';

-- ── Limpieza (correr SOLO cuando las trazas ya no se necesiten) ──
-- DELETE FROM traza_gps WHERE created_at < now() - interval '7 days';

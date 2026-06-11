-- ═══════════════════════════════════════════════════════════════
--  Migración #56 — Dirección de Carrera: banderas por piloto +
--                  renombrar time_attack → track_day
-- ═══════════════════════════════════════════════════════════════

-- 1. Columna para bandera personal por piloto en sesión activa
ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS bandera_piloto TEXT DEFAULT NULL;

-- 2. Renombrar tipo de sesión: time_attack → track_day
--    Primero hay que actualizar el CHECK constraint para aceptar 'track_day'
ALTER TABLE fechas_evento
  DROP CONSTRAINT IF EXISTS fechas_evento_tipo_check;

ALTER TABLE fechas_evento
  ADD CONSTRAINT fechas_evento_tipo_check
  CHECK (tipo IN ('racing', 'track_day', 'entrenamiento'));

UPDATE fechas_evento
  SET tipo = 'track_day'
  WHERE tipo = 'time_attack';

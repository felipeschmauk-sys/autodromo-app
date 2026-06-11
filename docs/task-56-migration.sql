-- ═══════════════════════════════════════════════════════════════
--  Migración #56 — Dirección de Carrera: banderas por piloto +
--                  renombrar time_attack → track_day
--  (orden corregido: renombrar datos ANTES de crear el constraint)
-- ═══════════════════════════════════════════════════════════════

-- 1. Columna para bandera personal por piloto en sesión activa
ALTER TABLE sesiones
  ADD COLUMN IF NOT EXISTS bandera_piloto TEXT DEFAULT NULL;

-- 2. Quitar el CHECK constraint viejo
ALTER TABLE fechas_evento
  DROP CONSTRAINT IF EXISTS fechas_evento_tipo_check;

-- 3. Renombrar los datos existentes (con el constraint ya eliminado)
UPDATE fechas_evento
  SET tipo = 'track_day'
  WHERE tipo = 'time_attack';

-- 4. Recrear el constraint con los valores nuevos
ALTER TABLE fechas_evento
  ADD CONSTRAINT fechas_evento_tipo_check
  CHECK (tipo IN ('racing', 'track_day', 'entrenamiento'));

-- Migración: tandas por fecha (Julio 2026)
-- Una fecha tiene múltiples tandas (entrenamiento, clasificación, carrera).
-- El log de acciones etiqueta cada registro con la tanda en curso, para
-- poder revisar y descargar lo que pasó SOLO en esa tanda.
-- Correr en Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS tandas (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_id UUID NOT NULL REFERENCES fechas_evento(id) ON DELETE CASCADE,
  tipo     TEXT NOT NULL,          -- 'entrenamiento' | 'clasificacion' | 'carrera'
  nombre   TEXT NOT NULL,          -- ej: "Carrera 2" (autonumerado)
  inicio   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin      TIMESTAMPTZ             -- NULL = tanda en curso
);

ALTER TABLE tandas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tandas_all ON tandas;
CREATE POLICY tandas_all ON tandas FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE log_acciones
  ADD COLUMN IF NOT EXISTS tanda_id UUID REFERENCES tandas(id) ON DELETE SET NULL;

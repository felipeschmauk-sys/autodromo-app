-- Migración: cronometraje referencial por GPS — Etapa 1 (Julio 2026)
-- Correr en Supabase SQL Editor.
--
-- vueltas: una fila por cruce de meta (detectado en el teléfono del piloto,
-- con instante interpolado). tiempo_ms NULL = vuelta de salida.
-- tandas: duración preconfigurada, vueltas programadas (carrera) y meta
-- congelada al iniciar. circuitos: meta configurable y vuelta mínima válida.

CREATE TABLE IF NOT EXISTS vueltas (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tanda_id  UUID NOT NULL REFERENCES tandas(id) ON DELETE CASCADE,
  piloto_id UUID NOT NULL,
  numero    INTEGER NOT NULL,
  cruce_at  TIMESTAMPTZ NOT NULL,
  tiempo_ms INTEGER,
  valida    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tanda_id, piloto_id, numero)
);

ALTER TABLE vueltas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vueltas_all ON vueltas;
CREATE POLICY vueltas_all ON vueltas FOR ALL USING (true) WITH CHECK (true);

-- Realtime: la tabla de posiciones del panel se actualiza en vivo
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE vueltas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE tandas
  ADD COLUMN IF NOT EXISTS duracion_min INTEGER,
  ADD COLUMN IF NOT EXISTS vueltas_programadas INTEGER,
  ADD COLUMN IF NOT EXISTS meta_idx INTEGER;

ALTER TABLE circuitos
  ADD COLUMN IF NOT EXISTS meta_idx INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vuelta_min_s INTEGER DEFAULT 40;

-- Migración: perfil del piloto — auto activo + historial permanente (Julio 2026)
-- Correr en Supabase SQL Editor.
--
-- 1) Auto activo del piloto: los km/minutos de cada sesión se asignan a este
--    vehículo. NULL = sin auto activo (los datos quedan solo en el piloto).
-- 2) historial_pista: una fila por sesión cerrada, con minutos, km recorridos
--    y velocidad máxima. Es el historial permanente que alimenta las
--    estadísticas y la experiencia del piloto.

ALTER TABLE pilotos
  ADD COLUMN IF NOT EXISTS vehiculo_activo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS historial_pista (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piloto_id   UUID NOT NULL,
  sesion_id   UUID UNIQUE,
  fecha_id    UUID,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  minutos     INTEGER NOT NULL DEFAULT 0,
  km          NUMERIC(8,2) NOT NULL DEFAULT 0,
  vel_max     INTEGER NOT NULL DEFAULT 0,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE historial_pista ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS historial_pista_all ON historial_pista;
CREATE POLICY historial_pista_all ON historial_pista FOR ALL USING (true) WITH CHECK (true);

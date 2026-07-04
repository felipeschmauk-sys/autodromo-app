-- Migración: prueba de conocimientos POR CAMPEONATO (Julio 2026)
-- La prueba ya no se rinde al registrarse: se rinde la primera vez que el
-- piloto ENTRA a un evento de cada campeonato (cada campeonato puede tener
-- reglas distintas). Esta tabla registra qué campeonatos aprobó cada piloto.
-- Correr en Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS pruebas_piloto (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  piloto_id     UUID NOT NULL,
  campeonato_id UUID NOT NULL REFERENCES campeonatos(id) ON DELETE CASCADE,
  aprobado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (piloto_id, campeonato_id)
);

ALTER TABLE pruebas_piloto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pruebas_piloto_all ON pruebas_piloto;
CREATE POLICY pruebas_piloto_all ON pruebas_piloto FOR ALL USING (true) WITH CHECK (true);

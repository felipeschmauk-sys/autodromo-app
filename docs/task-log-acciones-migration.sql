-- Migración: log de acciones de pista (Julio 2026)
-- Registro persistente de todo lo que ocurre en la operación de un evento:
-- banderas globales, por sector, automáticas, personales, ingresos QR, retiros.
-- Correr en Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS log_acciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_id    UUID REFERENCES fechas_evento(id) ON DELETE SET NULL,
  piloto_id   UUID,
  tipo        TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS abierta como el resto del sistema (control de acceso por aplicación)
ALTER TABLE log_acciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS log_acciones_all ON log_acciones;
CREATE POLICY log_acciones_all ON log_acciones FOR ALL USING (true) WITH CHECK (true);

-- Realtime para que el log aparezca en vivo en el panel
-- (si ya estaba agregada, este bloque no hace nada)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE log_acciones;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

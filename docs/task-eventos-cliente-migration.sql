-- Migración: el teléfono deja constancia de por qué se apagó (Noviembre 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- El 4 de octubre y otra vez en Interlomas, varios teléfonos apagaron el GPS en
-- el mismo segundo. La huella del apagón quedó en `traza_gps` —el volcado que
-- hace `detenerGPS()` antes de soltar el watch—, pero **no quedó el motivo**.
-- Dos análisis completos (docs/INCIDENTE_2026-10-04.md y
-- docs/INCIDENTE_2026-10-18.md) terminaron en hipótesis porque desde fuera no
-- hay forma de saber si el teléfono recibió un cierre de sesión, si le falló una
-- consulta, o si el efecto se volvió a montar.
--
-- Mientras eso siga así, cualquier arreglo de las caídas es a ciegas: si la
-- próxima jornada no se cae, no se sabrá si fue el arreglo o la suerte.
--
-- Esta tabla es el registro que faltaba. No es el log de operación
-- (`log_acciones`, que es lo que hace el director y se muestra en Dirección):
-- es diagnóstico del aparato, y va aparte para no ahogar al otro.

CREATE TABLE IF NOT EXISTS eventos_cliente (
  id            BIGSERIAL PRIMARY KEY,
  fecha_id      UUID,
  piloto_id     UUID,
  sesion_id     UUID,
  -- 'gps_detenido' | 'gps_iniciado' | 'consulta_fallida' | 'contacto'
  tipo          TEXT        NOT NULL,
  -- Por qué. En un apagón, esto es TODO el valor de la tabla.
  motivo        TEXT,
  detalle       JSONB,
  -- Hora del TELÉFONO cuando ocurrió
  t_dispositivo TIMESTAMPTZ NOT NULL,
  -- Hora del SERVIDOR cuando se logró escribir. La diferencia entre las dos
  -- cuenta lo que pasó en el medio: en una caída, el teléfono anota al
  -- instante y recién consigue escribir cuando la base lo deja.
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eventos_cliente_fecha_t
  ON eventos_cliente (fecha_id, t_dispositivo);

COMMENT ON TABLE eventos_cliente IS
  'Diagnóstico del teléfono del piloto: por qué se apagó el GPS, qué consultas fallaron y cuándo perdió contacto. Aparte de log_acciones, que es la operación.';
COMMENT ON COLUMN eventos_cliente.motivo IS
  'Por qué ocurrió. En una caída simultánea de GPS, es el dato que faltaba para diagnosticar en vez de suponer.';

ALTER TABLE eventos_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eventos_cliente_todo ON eventos_cliente;
CREATE POLICY eventos_cliente_todo ON eventos_cliente FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- Los apagones de GPS de una jornada, con su motivo:
-- SELECT t_dispositivo, piloto_id, motivo, detalle
--   FROM eventos_cliente
--  WHERE tipo = 'gps_detenido' ORDER BY t_dispositivo DESC LIMIT 50;
--
-- Varios teléfonos apagándose en el mismo segundo (la huella de las caídas):
-- SELECT date_trunc('second', t_dispositivo) AS seg,
--        count(*), count(DISTINCT piloto_id), string_agg(DISTINCT motivo, ' | ')
--   FROM eventos_cliente WHERE tipo = 'gps_detenido'
--  GROUP BY 1 HAVING count(DISTINCT piloto_id) >= 3 ORDER BY 1;

-- ── Limpieza ─────────────────────────────────────────────────
-- Es diagnóstico, no registro de competencia. Se puede borrar lo viejo:
-- DELETE FROM eventos_cliente WHERE creado_at < now() - interval '90 days';

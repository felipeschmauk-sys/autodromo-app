-- Migración: inscripción libre por fecha — MARCHA BLANCA (Agosto 2026)
-- Correr en Supabase SQL Editor.
--
-- QUÉ HACE
-- Agrega un interruptor por fecha que saltea la confirmación del admin y el
-- pago: el piloto aprieta "Inscribirme" y entra directo al evento.
--
-- ES PROVISORIO Y REVERSIBLE
-- No reemplaza ni borra nada del flujo normal (solicitado → inscrito → pago →
-- confirmado), que sigue intacto y es lo que corre cuando el interruptor está
-- apagado. Para volver atrás basta con desmarcarlo en la fecha; para sacarlo
-- del todo, ver el DROP comentado al final.
--
-- NO saltea la prueba de conocimientos del campeonato: eso sigue pidiéndose.

ALTER TABLE fechas_evento
  ADD COLUMN IF NOT EXISTS inscripcion_libre BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN fechas_evento.inscripcion_libre IS
  'Marcha blanca: la inscripción se auto-confirma, sin aprobación del admin ni pago. Provisorio.';

-- Refrescar el caché de esquema de la API para que la app vea la columna ya
NOTIFY pgrst, 'reload schema';

-- ── Revisar qué fechas la tienen encendida ────────────────────
-- SELECT nombre, fecha_evento, estado, inscripcion_libre
-- FROM fechas_evento WHERE inscripcion_libre ORDER BY fecha_evento;

-- ── Apagarla en todas las fechas de una ───────────────────────
-- UPDATE fechas_evento SET inscripcion_libre = false WHERE inscripcion_libre;

-- ── Quitar la función del todo (fin de la marcha blanca) ──────
-- ALTER TABLE fechas_evento DROP COLUMN IF EXISTS inscripcion_libre;

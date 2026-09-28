-- Migración: orden de relargada tras bandera roja (Septiembre 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- Reglamento Deportivo de F1 de la FIA, edición 2025:
--
--   Art. 57.3 — el orden se toma en el último punto en que fue posible
--   determinar la posición de todos los autos: el último paso por meta, NO el
--   orden físico al detenerse. Quien adelantó después de cruzar la meta
--   devuelve esa posición.
--
--   Art. 58.4 — los autos doblados por el líder al momento de la suspensión
--   completan una vuelta adicional antes de reanudar. Esa vuelta extra es la
--   recuperación de la vuelta perdida.
--
-- El sistema mide por GPS y no puede obligar a un auto físicamente adelante a
-- ponerse atrás: eso se coordina con los pilotos. Lo que sí puede es calcular
-- el orden que corresponde, mostrarlo al director, y dejar constancia si la
-- relargada no lo respetó para que los comisarios evalúen.
--
-- El sistema nunca bloquea: solo notifica y deja que todo siga fluyendo.

ALTER TABLE tandas
  ADD COLUMN IF NOT EXISTS orden_relargada   JSONB,
  ADD COLUMN IF NOT EXISTS relargada_desde   TIMESTAMPTZ;

COMMENT ON COLUMN tandas.orden_relargada IS
  'Fila de relargada congelada al caer la bandera roja: [{pid, pos, posCategoria, categoria, vueltas, recuperoVuelta}]. Se recalcula con cada roja.';
COMMENT ON COLUMN tandas.relargada_desde IS
  'Instante en que se dio verde tras una roja. Los primeros cruces de meta posteriores definen el orden real con que se relargó.';

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- SELECT nombre, tipo, relargada_desde,
--        jsonb_array_length(orden_relargada) AS pilotos_en_fila
-- FROM tandas WHERE orden_relargada IS NOT NULL ORDER BY inicio DESC;

-- ── Ver la fila congelada de una tanda ────────────────────────
-- SELECT p.nombre, x->>'pos' AS pos, x->>'vueltas' AS vueltas,
--        x->>'recuperoVuelta' AS recupero
-- FROM tandas t, jsonb_array_elements(t.orden_relargada) x
-- JOIN pilotos p ON p.id = (x->>'pid')::uuid
-- WHERE t.id = 'PEGAR-ID' ORDER BY (x->>'pos')::int;

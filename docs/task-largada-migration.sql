-- Migración: marca de largada por tanda (Agosto 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- El protocolo de largada es: los autos salen de boxes detrás del pace car,
-- completan una vuelta de formación, y la carrera larga recién en el SEGUNDO
-- paso por meta. Hasta ahora esas pasadas previas se contaban como vueltas de
-- carrera, y había que compensarlo configurando una vuelta de más
-- (11 programadas para una carrera de 10).
--
-- Con largada_at el director marca el instante real de la largada y el sistema
-- sabe qué pasadas son de formación y cuáles de carrera. Se puede configurar la
-- distancia REAL de la carrera.
--
-- Es opcional y retrocompatible: con largada_at en NULL todo se comporta
-- exactamente como antes.

ALTER TABLE tandas
  ADD COLUMN IF NOT EXISTS largada_at TIMESTAMPTZ;

COMMENT ON COLUMN tandas.largada_at IS
  'Instante de la largada (se retira el pace car). Los cruces anteriores son vuelta de formación y no cuentan. NULL = sin marcar, se cuentan todos los cruces como antes.';

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- SELECT nombre, tipo, inicio, largada_at, vueltas_programadas
-- FROM tandas WHERE tipo = 'carrera' ORDER BY inicio DESC LIMIT 10;

-- ── Marcar a mano la largada de una carrera ya corrida ────────
-- (sirve para reinterpretar las carreras del 9 ago sin volver a pista)
-- UPDATE tandas SET largada_at = '2026-08-09T17:55:45Z' WHERE nombre = 'Carrera 2';

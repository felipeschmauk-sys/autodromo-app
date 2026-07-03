-- Migración: circuito asociado a cada fecha (Julio 2026)
-- Antes la asociación fecha→circuito vivía solo en el localStorage del
-- navegador del admin, así que la app del piloto no podía saber qué pista
-- mostrar y caía al trazado global (el último activado, de cualquier fecha).
--
-- Correr en Supabase SQL Editor. El código tiene fallback si no se corre,
-- pero el piloto seguirá viendo el trazado global hasta que exista.

ALTER TABLE fechas_evento
  ADD COLUMN IF NOT EXISTS circuito_id UUID REFERENCES circuitos(id) ON DELETE SET NULL;

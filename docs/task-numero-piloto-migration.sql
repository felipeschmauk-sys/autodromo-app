-- Migración: número de competición del piloto (Julio 2026)
-- Hasta 3 caracteres, editable por el admin desde el resumen del piloto.
-- Si es NULL, los círculos muestran las iniciales del nombre (lógica anterior).
-- Correr en Supabase SQL Editor.

ALTER TABLE pilotos
  ADD COLUMN IF NOT EXISTS numero VARCHAR(3);

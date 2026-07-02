-- Migración: estado GPS completo del piloto (Julio 2026)
-- El piloto ya calcula si está dentro de la geocerca del RECINTO además de la
-- de PISTA, pero solo enviaba la de pista. Sin este dato el panel admin no
-- puede distinguir "en recinto" de "fuera del recinto".
--
-- Correr en Supabase SQL Editor ANTES de usar la versión desplegada
-- (el código tiene fallback y sigue funcionando sin la columna, pero el
-- admin mostrará "Fuera de pista" genérico hasta que exista).

ALTER TABLE ubicaciones_piloto
  ADD COLUMN IF NOT EXISTS dentro_recinto BOOLEAN DEFAULT NULL;

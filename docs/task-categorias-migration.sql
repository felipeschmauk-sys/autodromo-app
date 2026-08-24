-- Migración: categorías de pilotos (Agosto 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- En una misma tanda conviven autos de categorías distintas. Un piloto compite
-- contra los de SU categoría, no contra todos: uno de una categoría más rápida
-- no debe empujarlo hacia abajo en la tabla de tiempos.
--
-- Dónde SÍ se mezclan todas las categorías:
--   · la diferencia de tiempo con el auto de adelante y el de atrás
--   · la bandera azul (funciona como si fueran una sola categoría)
--
-- El piloto sin categoría queda en lista de espera: no tiene posición ni
-- diferencias, pero sigue funcionando para banderas y para el sistema de
-- seguridad, y puede estar en pista con normalidad.

CREATE TABLE IF NOT EXISTS categorias (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL,
  orden      INTEGER NOT NULL DEFAULT 0,   -- para listarlas en un orden estable
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS categorias_all ON categorias;
CREATE POLICY categorias_all ON categorias FOR ALL USING (true) WITH CHECK (true);

-- La categoría vive en el piloto: se asigna una vez desde la pestaña Pilotos
ALTER TABLE pilotos
  ADD COLUMN IF NOT EXISTS categoria_id UUID REFERENCES categorias(id) ON DELETE SET NULL;

COMMENT ON COLUMN pilotos.categoria_id IS
  'Categoría del piloto. NULL = en lista de espera: sin posición ni diferencias, pero opera normal en pista.';

CREATE INDEX IF NOT EXISTS pilotos_categoria ON pilotos (categoria_id);

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- SELECT c.nombre, count(p.id) AS pilotos
-- FROM categorias c LEFT JOIN pilotos p ON p.categoria_id = c.id
-- GROUP BY c.nombre ORDER BY c.nombre;

-- SELECT nombre, rut FROM pilotos WHERE categoria_id IS NULL ORDER BY nombre;

-- Migración: que la base sea el árbitro cuando hay varios paneles (Octubre 2026)
-- Correr en Supabase SQL Editor.
--
-- POR QUÉ
-- En Interlomas había hasta tres paneles admin abiertos a la vez. Cada uno
-- cree que es el único: el candado que impide abrir dos tandas, el que impide
-- cerrarla dos veces y la memoria de quién puso una amarilla automática viven
-- en el navegador, así que no se ven entre ellos. Resultado de esa jornada:
-- dos tandas "Libre 4" creadas en el mismo segundo y registros duplicados en
-- el log.
--
-- La solución no es prohibir el segundo panel —poner banderas desde el
-- teléfono mientras el PC queda en la torre es justamente lo que se quiere—,
-- sino mover esos tres candados a la base, que es el único lugar que todos
-- los paneles comparten.
--
-- Lo que esta migración NO hace: el cálculo de posiciones y diferencias sigue
-- corriendo en cada panel abierto. Eso es el paso siguiente.

-- ── 1. Una sola tanda abierta por fecha ──────────────────────
-- `iniciarTanda` se protegía mirando su propia lista en memoria. Dos paneles
-- con la lista vacía calculan el mismo nombre ("Libre 4") e insertan los dos.
-- Con este índice el segundo insert falla en la base y el panel avisa, en vez
-- de crear una tanda gemela que después nadie sabe cuál es.
--
-- Es un índice PARCIAL: solo mira las tandas sin cerrar. Las históricas pueden
-- repetirse todo lo que quieran, que para eso ya pasaron.

CREATE UNIQUE INDEX IF NOT EXISTS tandas_una_abierta_por_fecha
  ON tandas (fecha_id)
  WHERE fin IS NULL;

COMMENT ON INDEX tandas_una_abierta_por_fecha IS
  'Una sola tanda sin cerrar por fecha de evento. Impide que dos paneles admin abiertos creen la misma tanda dos veces.';

-- ── 2. Quién puso la amarilla automática ─────────────────────
-- Hasta ahora vivía en `autoYellowRef`, un Map en memoria del navegador que
-- abrió el panel. Dos consecuencias, las dos malas:
--
--   · Si ese panel se cerraba o se recargaba, nadie recordaba que había que
--     devolver el sector a verde: el sector quedaba amarillo para siempre.
--     Esto pasaba incluso con UN SOLO panel abierto.
--   · Con dos paneles, cada uno tenía su propia idea de qué amarillas eran
--     suyas.
--
-- Guardándolo en la tabla, cualquier panel —incluido uno recién abierto—
-- sabe que esa amarilla la puso el sistema por el piloto X, y puede
-- devolverla a verde cuando X vuelve a moverse.
--
-- NULL = la amarilla la puso el director a mano (o el sector está en verde).
-- El automático nunca pisa una bandera puesta a mano.
--
-- Sin llave foránea a propósito: un id que quedó apuntando a un piloto
-- borrado es inofensivo —solo se compara por igualdad, y un piloto borrado no
-- manda GPS—, y una FK con el tipo equivocado haría fallar la migración
-- entera.

ALTER TABLE sectores_pista
  ADD COLUMN IF NOT EXISTS auto_amarilla_piloto_id UUID;

COMMENT ON COLUMN sectores_pista.auto_amarilla_piloto_id IS
  'Piloto por el que el sistema puso esta amarilla automática. NULL = bandera puesta a mano por el director, o sector en verde.';

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- Antes de correr esto conviene mirar que no haya ya dos tandas abiertas en
-- una misma fecha, porque entonces el índice no se puede crear:
--
-- SELECT fecha_id, count(*), string_agg(nombre, ' | ')
--   FROM tandas WHERE fin IS NULL
--  GROUP BY fecha_id HAVING count(*) > 1;
--
-- (Comprobado el 27-10-2026: 0 tandas abiertas en toda la base.)
--
-- Después:
-- SELECT nombre, bandera, auto_amarilla_piloto_id FROM sectores_pista ORDER BY orden;

-- ── Soltar a mano una amarilla que quedó pegada ──────────────
-- Queda un caso que esto NO resuelve: si el teléfono del auto detenido se
-- queda sin batería, nunca llega el dato de que volvió a moverse y la
-- amarilla se queda puesta. Se deja así a propósito —un auto detenido con el
-- teléfono muerto es exactamente cuando la amarilla tiene que seguir—, pero
-- si hay que soltarla:
--
-- UPDATE sectores_pista
--    SET bandera = 'verde', auto_amarilla_piloto_id = NULL
--  WHERE auto_amarilla_piloto_id IS NOT NULL;

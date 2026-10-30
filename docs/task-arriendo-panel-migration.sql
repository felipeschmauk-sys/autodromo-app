-- Migración: un solo panel calcula la carrera (Octubre 2026)
-- Correr en Supabase SQL Editor. Va después de task-panel-unico-migration.sql.
--
-- POR QUÉ
-- La 0.43.0 movió a la base los candados de las acciones que pasan una sola
-- vez. Lo que sigue duplicado es el CÁLCULO: cada panel abierto corre su propio
-- ciclo de 1 Hz y emite su versión de la carrera por el canal `estado-<fecha>`.
-- El teléfono del piloto aplica el último mensaje que llegue, y un panel recién
-- abierto emite un estado parcial: al piloto que falta en ese mensaje se le
-- borra la pantalla (`if (!mio) setMisGaps(null)` en app/page.tsx).
--
-- La solución no es designar un panel principal a mano: si ese equipo se queda
-- sin batería a mitad de carrera, nadie calcula hasta que un humano lo
-- reconfigure. Es un ARRIENDO que se toma solo y se suelta solo.

-- ── 1. Quién está calculando ─────────────────────────────────
-- Una fila por fecha. El que la tiene renueva cada 2 s; si deja de renovar,
-- a los ~6 s queda libre y cualquier otro panel la toma.

CREATE TABLE IF NOT EXISTS panel_lider (
  fecha_id       UUID PRIMARY KEY,
  dueno          TEXT        NOT NULL,
  etiqueta       TEXT,
  expira_at      TIMESTAMPTZ NOT NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE panel_lider IS
  'Arriendo del ciclo de cálculo: un solo panel por fecha calcula posiciones, diferencias y bandera azul. Los demás son vista.';
COMMENT ON COLUMN panel_lider.dueno IS
  'Identificador al azar de la pestaña que lo tiene. Cambia en cada carga: no identifica al equipo, identifica a la sesión del panel.';
COMMENT ON COLUMN panel_lider.etiqueta IS
  'Texto legible para la pantalla ("PC", "Teléfono"). Solo para mostrar quién calcula.';

-- ── 2. Tomar o renovar, en una sola llamada ──────────────────
-- Va como función y no como UPDATE desde el cliente por el reloj: comparar
-- `expira_at` contra la hora del NAVEGADOR dejaría que un panel con el reloj
-- adelantado le robe el arriendo a otro que está trabajando bien. Acá todas
-- las horas son las del servidor. Por eso también existe lib/reloj.ts.
--
-- Devuelve siempre quién lo tiene, incluso cuando no lo consigue, para que el
-- panel pueda decir en pantalla quién está calculando.

CREATE OR REPLACE FUNCTION tomar_arriendo_panel(
  p_fecha    UUID,
  p_dueno    TEXT,
  p_etiqueta TEXT DEFAULT NULL,
  p_segundos INT  DEFAULT 6
)
RETURNS TABLE (dueno TEXT, etiqueta TEXT, expira_at TIMESTAMPTZ, soy_yo BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO panel_lider AS pl (fecha_id, dueno, etiqueta, expira_at)
  VALUES (p_fecha, p_dueno, p_etiqueta, now() + make_interval(secs => p_segundos))
  ON CONFLICT (fecha_id) DO UPDATE
    SET dueno = CASE WHEN pl.dueno = p_dueno OR pl.expira_at < now()
                     THEN p_dueno ELSE pl.dueno END,
        etiqueta = CASE WHEN pl.dueno = p_dueno OR pl.expira_at < now()
                     THEN p_etiqueta ELSE pl.etiqueta END,
        expira_at = CASE WHEN pl.dueno = p_dueno OR pl.expira_at < now()
                     THEN now() + make_interval(secs => p_segundos) ELSE pl.expira_at END,
        actualizado_at = now();

  RETURN QUERY
    SELECT pl.dueno, pl.etiqueta, pl.expira_at, (pl.dueno = p_dueno)
      FROM panel_lider pl WHERE pl.fecha_id = p_fecha;
END;
$$;

-- Soltarlo al cerrar el panel: así el relevo es inmediato en vez de esperar
-- los 6 s. Solo lo puede soltar quien lo tiene.
CREATE OR REPLACE FUNCTION soltar_arriendo_panel(p_fecha UUID, p_dueno TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE panel_lider SET expira_at = now(), actualizado_at = now()
   WHERE fecha_id = p_fecha AND dueno = p_dueno;
$$;

-- ── 3. La memoria de la llegada, fuera del navegador ─────────
-- Quién ya cruzó su meta final, con cuántas vueltas y cuándo, y con qué
-- diferencia quedó congelado. Hoy vive en refs de React (`congeladosRef`,
-- `llegadasRef`, `alTerminarRef` en components/Cronometraje.tsx) y se pierde
-- con la pestaña.
--
-- Sin esto el arriendo sería peligroso: si cambia de manos en la última vuelta,
-- el panel nuevo no sabe quién ya terminó, el líder "vuelve a terminar" y el
-- resultado sale revuelto. Es el requisito del relevo, no un extra.
--
-- Se guarda como un bloque por tanda porque se escribe entero y se lee entero,
-- unas pocas veces por carrera —cuando alguien cruza—, no en cada tick.

CREATE TABLE IF NOT EXISTS estado_carrera (
  tanda_id       UUID PRIMARY KEY,
  datos          JSONB       NOT NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE estado_carrera IS
  'Llegada de cada piloto a su meta final, para que el cálculo pueda cambiar de panel a mitad de carrera sin perder el resultado.';

-- ── 4. Acceso ────────────────────────────────────────────────
-- Abierto, igual que el resto del proyecto (ver "Antes de publicar en las
-- tiendas" en docs/PENDIENTES.md: las políticas hay que auditarlas enteras
-- antes de vender cuentas, no tabla por tabla).

ALTER TABLE panel_lider    ENABLE ROW LEVEL SECURITY;
ALTER TABLE estado_carrera ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS panel_lider_todo    ON panel_lider;
DROP POLICY IF EXISTS estado_carrera_todo ON estado_carrera;

CREATE POLICY panel_lider_todo    ON panel_lider    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY estado_carrera_todo ON estado_carrera FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ── Revisar ───────────────────────────────────────────────────
-- SELECT fecha_id, dueno, etiqueta, expira_at, expira_at < now() AS vencido
--   FROM panel_lider;
--
-- Soltarlo a mano si quedó tomado por una pestaña que ya no existe
-- (no debería hacer falta: vence solo a los 6 s):
-- UPDATE panel_lider SET expira_at = now() WHERE fecha_id = 'PEGAR-ID';

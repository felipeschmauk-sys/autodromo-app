# Prueba de cronometraje en pista — protocolo

**Objetivo de esta prueba: NO es que el cronometraje quede lindo. Es traer datos
crudos que se puedan volver a analizar mil veces en el escritorio.**

Si mañana algo sale raro y solo quedaron guardadas las vueltas calculadas, no hay
forma de saber por qué, y hace falta otra fecha de pista para averiguarlo. Con la
traza cruda, una tanda se puede reprocesar entera cambiando umbrales, sin volver
al autódromo.

Lo que se está validando, en orden de importancia:

1. Que **no se saltee vueltas**
2. Que el **conteo de vueltas** por piloto sea correcto
3. Que el **orden de posiciones** sea correcto
4. Que los relojes de los teléfonos estén **alineados entre sí** (sin esto no hay
   gaps entre pilotos posibles)

La precisión absoluta del tiempo de vuelta **no** se está validando: con GPS a
1 Hz el error típico es de ±0,2 a 0,5 s por vuelta y eso ya se dio por aceptable.
Lo que importa es que el error sea *consistente*.

---

## 1. Antes de ir (escritorio)

- [ ] **Correr `docs/task-traza-gps-migration.sql`** en el SQL Editor de Supabase.
      Sin esto no se graba nada de diagnóstico y la prueba se pierde.
- [ ] **Revisar la densidad de puntos del trazado**, sobre todo cerca de meta.
      El detector calcula el progreso sobre *cantidad de puntos*, no sobre metros.
      Si el trazado tiene muchos puntos juntos en la recta de meta y pocos en el
      resto, la ventana de detección se achica en metros y **ahí es donde se
      saltean vueltas**. Este es el chequeo más barato y el que más puede
      arruinar la jornada.
- [ ] Confirmar `circuitos.meta_idx` (dónde está la meta) y `circuitos.vuelta_min_s`
      (vuelta mínima válida, por defecto 40 s). Si el circuito se gira en menos de
      40 s, **subir ese valor no: bajarlo**, o se descartan vueltas buenas.
- [ ] Confirmar que la geocerca de pista cubre el trazado con margen. Si el GPS
      salta afuera cerca de meta, el detector se resetea y pierde el cruce.

## 2. En cada teléfono

- [ ] **Modo de bajo consumo APAGADO.** iOS fuerza el bloqueo de pantalla a los
      30 s por sobre cualquier técnica web. Es el hallazgo de la versión 0.10.3 y
      no tiene vuelta.
- [ ] Ajustes → Accesibilidad → Tocar → **Agitar para deshacer: APAGADO.**
      La app ya mitiga el diálogo, pero el gesto solo se apaga del todo acá.
- [ ] Brillo alto, permiso de ubicación concedido, app abierta en pantalla.
- [ ] Anotar: **modelo de teléfono, versión de iOS, y dónde va montado** (soporte
      en parabrisas / bolsillo / consola). La posición cambia mucho la señal.

## 3. En pista

- [ ] **Mínimo 2 autos al mismo tiempo.** Sin dos autos no se puede probar nada
      de gaps ni de banderas azules.
- [ ] **8 a 10 vueltas seguidas**, no dos. Los saltos aparecen con repetición.
- [ ] A propósito, durante la tanda:
  - una entrada y salida de boxes
  - una vuelta claramente lenta
  - un auto detenido en pista unos segundos
  - si se puede, un auto quieto en boxes cerca de la recta de meta (para ver si
    genera cruces fantasma)
- [ ] **Referencia real para contrastar:** filmar la meta con un reloj visible en
      cuadro, o que alguien anote a mano las vueltas de cada auto. Sin una
      referencia externa, los datos no se pueden verificar, solo describir.
- [ ] Anotar la hora de inicio y fin de cada tanda, y qué auto era cuál.

---

## 4. Después: qué mirar en Supabase

Reemplazar `'TANDA-ID'` por el id de la tanda en todas las consultas.

### La consulta clave: ¿se saltearon vueltas?

Cuenta los cruces **reales** viendo dónde el progreso "dio la vuelta" (cayó más
de media vuelta de golpe). Es robusto aunque se hayan perdido lecturas. Se
compara contra las vueltas que la app efectivamente registró.

```sql
WITH s AS (
  SELECT piloto_id, progreso,
         LAG(progreso) OVER (PARTITION BY piloto_id ORDER BY t_dispositivo) AS ant
  FROM traza_gps
  WHERE tanda_id = 'TANDA-ID'
),
reales AS (
  SELECT piloto_id, count(*) AS cruces_reales
  FROM s WHERE ant IS NOT NULL AND progreso < ant - 0.5
  GROUP BY piloto_id
),
grabadas AS (
  SELECT piloto_id, count(*) AS vueltas_grabadas
  FROM vueltas WHERE tanda_id = 'TANDA-ID'
  GROUP BY piloto_id
)
SELECT p.nombre, r.cruces_reales, g.vueltas_grabadas,
       r.cruces_reales - COALESCE(g.vueltas_grabadas, 0) AS salteadas
FROM reales r
LEFT JOIN grabadas g ON g.piloto_id = r.piloto_id
LEFT JOIN pilotos  p ON p.id = r.piloto_id
ORDER BY salteadas DESC;
```

**`salteadas` distinto de 0 es el problema a resolver antes de seguir con gaps.**

### ¿Se cortó el GPS? (la causa nº 1 de vueltas salteadas)

```sql
SELECT piloto_id, t_dispositivo,
       round(EXTRACT(EPOCH FROM (t_dispositivo - LAG(t_dispositivo)
         OVER (PARTITION BY piloto_id ORDER BY t_dispositivo)))::numeric, 1) AS hueco_s
FROM traza_gps
WHERE tanda_id = 'TANDA-ID'
ORDER BY hueco_s DESC NULLS LAST
LIMIT 20;
```

Huecos de más de ~6 s son peligrosos. Si aparecen, casi siempre es pantalla
bloqueada o app en segundo plano.

### ¿A qué frecuencia llegó realmente el GPS?

```sql
SELECT piloto_id, count(*) AS lecturas,
       round((count(*) / NULLIF(EXTRACT(EPOCH FROM
         (max(t_dispositivo) - min(t_dispositivo))), 0))::numeric, 2) AS hz
FROM traza_gps WHERE tanda_id = 'TANDA-ID' GROUP BY piloto_id;
```

Se espera ~1,0 Hz. Bastante menos que eso explica casi cualquier problema.

### ¿Están alineados los relojes? (habilita o mata los gaps)

```sql
SELECT p.nombre,
       min(t.offset_ms) AS min_ms, max(t.offset_ms) AS max_ms,
       round(avg(t.offset_ms)) AS promedio_ms
FROM traza_gps t LEFT JOIN pilotos p ON p.id = t.piloto_id
WHERE t.tanda_id = 'TANDA-ID' GROUP BY p.nombre;
```

Lo que importa es la **diferencia entre pilotos**. Si los promedios difieren en
menos de ~200 ms, los gaps son viables tal cual. Si difieren en segundos, hay que
corregir por `offset_ms` antes de comparar (el dato ya queda guardado para eso).

### Calidad de la señal

```sql
SELECT p.nombre,
       round(avg(t.precision_m)::numeric, 1) AS precision_media_m,
       max(t.precision_m) AS peor_m
FROM traza_gps t LEFT JOIN pilotos p ON p.id = t.piloto_id
WHERE t.tanda_id = 'TANDA-ID' GROUP BY p.nombre;
```

### Las vueltas tal como quedaron

```sql
SELECT p.nombre, v.numero, v.cruce_at, round(v.tiempo_ms / 1000.0, 2) AS seg
FROM vueltas v LEFT JOIN pilotos p ON p.id = v.piloto_id
WHERE v.tanda_id = 'TANDA-ID'
ORDER BY p.nombre, v.numero;
```

---

## 5. Después de la prueba

`traza_gps` crece rápido (≈1 fila por piloto por segundo). Cuando el análisis
esté hecho, vaciar lo viejo:

```sql
DELETE FROM traza_gps WHERE created_at < now() - interval '7 days';
```

---

## Qué viene después (no construido todavía)

Con la traza validada, el orden natural es:

1. **Distancia acumulada sobre el trazado** (metros reales, no índices de punto).
   Es el requisito para cualquier gap expresado en metros o segundos.
2. **Gap al de adelante / al de atrás.** Método estándar: para cada piloto se
   guarda el historial de (distancia en la vuelta, hora corregida). El gap contra
   el de adelante es *cuánto hace que ese piloto pasó por donde yo estoy ahora*.
   Límite honesto: las posiciones suben cada 3 s, así que el número en pantalla va
   a estar 3-5 s atrasado. Sirve como referencia estratégica, no como alarma de
   proximidad.
3. **Banderas azules.** Es lo más fácil de los tres una vez que el gap es
   confiable: doblar a un rezagado es un evento lento y tolera bien el retraso
   del dato. Criterio: diferencia de vuelta ≥ 1, gap por debajo de un umbral, y
   que se esté cerrando.

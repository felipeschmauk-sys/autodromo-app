# Prueba de cronometraje GPS — protocolo de pista

Objetivo de esta prueba: **saber si el cronometraje es una referencia confiable**,
no si es preciso. No importa que el tiempo no coincida con el oficial. Importa
que no se saltee vueltas, que cuente bien, y que dos pilotos distintos sean
comparables entre sí.

Todo lo que viene después —gap al de adelante, gap al de atrás, banderas azules—
se construye encima de eso. Si el conteo no es firme, nada de lo demás sirve.

---

## Antes de salir

### 1. Migración corrida
`docs/task-traza-gps-migration.sql` en Supabase. Verificar:

```sql
select hora_servidor();          -- devuelve fecha/hora con microsegundos
select count(*) from traza_gps;  -- devuelve 0
```

> Si algún teléfono ya tenía la app abierta cuando se corrió la migración,
> **cerrarla y volver a abrirla**. La app decide al arrancar si el registro
> está disponible.

### 2. Revisar el trazado (esto solo puede arruinar la prueba)

El detector calcula el progreso de la vuelta contando **puntos del trazado**, no
metros. Si los puntos están muy desparejos, la ventana donde detecta el cruce
puede quedar demasiado corta en una zona y saltear vueltas.

```sql
WITH t AS (
  SELECT coordenadas::jsonb AS c FROM trazado_pista WHERE activo = true LIMIT 1
),
p AS (
  SELECT (ord - 1)::int AS idx,
         (e->>'lat')::float8 AS lat,
         (e->>'lng')::float8 AS lng
  FROM t, jsonb_array_elements(t.c) WITH ORDINALITY AS x(e, ord)
),
d AS (
  SELECT 111320 * sqrt(
           power(lat - lag(lat) OVER (ORDER BY idx), 2) +
           power((lng - lag(lng) OVER (ORDER BY idx)) * cos(radians(lat)), 2)
         ) AS m
  FROM p
)
SELECT count(*) + 1                        AS puntos,
       round(sum(m)::numeric, 0)           AS largo_aprox_m,
       round(min(m)::numeric, 1)           AS separacion_min_m,
       round(avg(m)::numeric, 1)           AS separacion_media_m,
       round(max(m)::numeric, 1)           AS separacion_max_m
FROM d WHERE m IS NOT NULL;
```

**Cómo leerlo:** lo que importa es que `separacion_max_m` no sea muchas veces
`separacion_min_m`. Si la máxima es menos de ~5 veces la mínima, el trazado
sirve. Si es 20 veces, hay que redibujarlo más parejo antes de salir.

`largo_aprox_m` también sirve de control: si no se parece al largo real del
circuito, el trazado está mal cargado.

### 3. En cada teléfono
- **Modo de bajo consumo APAGADO** (iOS lo fuerza a bloquear la pantalla a los
  30 s, por encima de cualquier cosa que haga la app)
- **Agitar para deshacer APAGADO**: Ajustes → Accesibilidad → Tocar → Agitar
  para deshacer
- Permiso de ubicación en "Siempre" o "Al usar la app", con precisión exacta
- Batería sobre 50 % o cargador conectado — el GPS a 1 Hz consume
- Anotar: modelo, versión de iOS, y **dónde va montado** el teléfono

---

## En pista

Mínimo **dos autos al mismo tiempo**. Sin dos autos no se puede probar nada de
gaps, que es la mitad del objetivo.

| Qué | Por qué |
|---|---|
| 8–10 vueltas seguidas | Con dos vueltas no se ve si el conteo se degrada |
| Una entrada y salida de boxes | Es donde más probable es un cruce fantasma |
| Un auto detenido en pista un rato | Simula bandera amarilla / abandono |
| Una vuelta deliberadamente lenta | Prueba el filtro de vuelta mínima |
| Los dos autos juntos y separados | Para tener gaps chicos y grandes |

**Anotar a mano, en papel:** cuántas vueltas dio cada auto. Ese es el único
control independiente que va a haber. Sin eso, si los números no cuadran, no se
sabe cuál está mal.

Si se puede, filmar la meta con un reloj visible en cuadro.

---

## Después: qué mirar

Primero, buscar el ID de la tanda:

```sql
SELECT id, nombre, tipo, inicio, fin FROM tandas ORDER BY inicio DESC LIMIT 10;
```

Reemplazar `PEGAR-ID` en todas las consultas que siguen.

### La consulta que más importa: ¿se saltearon vueltas?

Cuenta los cruces **reales** que hay en la traza cruda (buscando el momento en
que el progreso vuelve a cero) y los compara contra las vueltas que la app llegó
a registrar. Este conteo es más robusto que el del propio detector, así que
sirve de juez.

```sql
WITH s AS (
  SELECT piloto_id, progreso,
         lag(progreso) OVER (PARTITION BY piloto_id ORDER BY t_dispositivo) AS ant
  FROM traza_gps WHERE tanda_id = 'PEGAR-ID'
),
cruces AS (
  SELECT piloto_id, count(*) AS n FROM s
  WHERE ant IS NOT NULL AND progreso < ant - 0.5
  GROUP BY piloto_id
),
reg AS (
  SELECT piloto_id, count(*) AS n FROM vueltas
  WHERE tanda_id = 'PEGAR-ID' GROUP BY piloto_id
)
SELECT p.nombre,
       coalesce(c.n, 0) AS cruces_reales,
       coalesce(r.n, 0) AS registradas,
       coalesce(c.n, 0) - coalesce(r.n, 0) AS salteadas
FROM pilotos p
LEFT JOIN cruces c ON c.piloto_id = p.id
LEFT JOIN reg    r ON r.piloto_id = p.id
WHERE c.piloto_id IS NOT NULL OR r.piloto_id IS NOT NULL
ORDER BY salteadas DESC;
```

**`salteadas` tiene que dar 0.** Cualquier otra cosa es el problema a resolver
antes de seguir con gaps o banderas azules.

### ¿Se cortó el GPS?

La causa número uno de una vuelta salteada es que el GPS dejó de llegar en el
momento del cruce.

```sql
SELECT p.nombre,
       count(*)                                        AS lecturas,
       round(max(hueco)::numeric, 1)                   AS peor_hueco_s,
       round(avg(hueco)::numeric, 2)                   AS hueco_medio_s,
       count(*) FILTER (WHERE hueco > 5)               AS cortes_mayores_5s
FROM (
  SELECT piloto_id,
         extract(epoch FROM (t_dispositivo -
           lag(t_dispositivo) OVER (PARTITION BY piloto_id ORDER BY t_dispositivo))) AS hueco
  FROM traza_gps WHERE tanda_id = 'PEGAR-ID'
) g JOIN pilotos p ON p.id = g.piloto_id
WHERE hueco IS NOT NULL
GROUP BY p.nombre ORDER BY peor_hueco_s DESC;
```

**`hueco_medio_s` debería estar cerca de 1.0.** `cortes_mayores_5s` debería ser
0. Si hay cortes largos, revisar si a ese teléfono se le bloqueó la pantalla.

### ¿Son comparables los relojes de los teléfonos?

```sql
SELECT p.nombre,
       round(avg(t.offset_ms))  AS desfase_medio_ms,
       min(t.offset_ms)         AS min_ms,
       max(t.offset_ms)         AS max_ms
FROM traza_gps t JOIN pilotos p ON p.id = t.piloto_id
WHERE t.tanda_id = 'PEGAR-ID' AND t.offset_ms IS NOT NULL
GROUP BY p.nombre ORDER BY desfase_medio_ms;
```

**Lo que importa no es el valor, sino la diferencia entre pilotos.** Si todos
tienen desfases parecidos, los gaps van a salir bien. Si uno está 2000 ms
apartado de los demás, todos sus gaps van a estar corridos 2 segundos hasta que
se aplique la corrección.

### Calidad del GPS y tiempos de vuelta

```sql
SELECT p.nombre,
       round(avg(t.precision_m)::numeric, 1) AS precision_media_m,
       round(max(t.precision_m)::numeric, 1) AS peor_m
FROM traza_gps t JOIN pilotos p ON p.id = t.piloto_id
WHERE t.tanda_id = 'PEGAR-ID' GROUP BY p.nombre;
```

```sql
SELECT p.nombre, v.numero AS vuelta, v.cruce_at,
       round(v.tiempo_ms / 1000.0, 2) AS segundos
FROM vueltas v JOIN pilotos p ON p.id = v.piloto_id
WHERE v.tanda_id = 'PEGAR-ID'
ORDER BY p.nombre, v.numero;
```

La primera vuelta de cada piloto tiene `segundos` vacío: es la vuelta de salida,
no tiene con qué compararse. Es lo esperado.

**Cómo leer los tiempos:** no compararlos contra el crono oficial. Compararlos
**entre sí**. Si un piloto dio 8 vueltas parejas y los tiempos salen consistentes
entre ellos, la referencia sirve aunque esté corrida medio segundo. Una vuelta
que salga muy fuera de la serie sin explicación en pista es la señal de alarma.

---

## Después de la prueba

La traza queda guardada, así que **se puede reprocesar la tanda entera en el
escritorio** probando otros umbrales del detector, sin volver al autódromo. Ese
era el punto de grabarla.

Cuando ya no se necesite (ocupa ~1 fila por piloto por segundo):

```sql
DELETE FROM traza_gps WHERE created_at < now() - interval '7 days';
```

---

## Lo que viene después, si la prueba sale bien

En este orden, porque cada uno depende del anterior:

1. **Distancia recorrida real en metros** en vez de progreso por índice de punto
   — es lo que falta para poder expresar un gap en segundos
2. **Gap al de adelante y al de atrás**: para cada piloto se guarda su historial
   de (distancia en la vuelta, hora corregida). El gap contra otro es cuánto
   tiempo pasó desde que el de adelante estuvo en el punto donde está el de
   atrás ahora
3. **Banderas azules**: con el gap andando es casi directo — diferencia de
   vueltas ≥ 1, gap por debajo de un umbral, y achicándose

Nota de expectativa sobre el punto 2: las posiciones suben cada 3 segundos, así
que el gap en pantalla va a tener unos 3–5 segundos de atraso. Sirve como
referencia ("venís a 1,8 s"), no como alarma de proximidad.

# Incidente del 4 de octubre de 2026 — todos los autos pierden el GPS a la vez

Durante la jornada de pruebas el sistema se cayó tres veces. En cada caída
**todos los teléfonos dejaban de reportar al mismo tiempo** y no se recuperaban
solos: hubo que reiniciar el proyecto de Supabase, y volvía a andar alrededor de
hora y media hasta la siguiente caída.

Felipe notó la correlación: las tres veces fue después de una bandera amarilla
automática por auto detenido. Tenía razón en la correlación. La causa, sin
embargo, no estaba donde parecía.

---

## 1. Lo que NO era

Vale dejarlo escrito porque se descartó con mediciones, no con opiniones:

| Hipótesis | Cómo se descartó |
|---|---|
| Los teléfonos se durmieron | Los autos iban a 79–163 km/h en el instante del corte |
| Se agotó la cuota de Realtime | 336.375 mensajes de 2.000.000 (17 %) |
| Tormenta de escrituras en `log_acciones` | 58 filas en 13 minutos |
| Demasiadas conexiones | 13 de 200 |
| Disco lleno | 0,064 de 0,5 GB |
| Muere el tiempo real y los teléfonos lo siguen | **Al revés.** Ver abajo |
| Tormenta de escrituras de sector | El caso sano tuvo *seis* escrituras en 40 s y no pasó nada |
| Sesiones duplicadas o cerradas en ese instante | Ninguna sesión se creó ni se cerró en esos minutos |

La anteúltima importa: durante un buen rato se trabajó con la idea de que el
tiempo real de Supabase moría primero y los teléfonos lo seguían un minuto
después. Eso venía de la columna "tel. vivos" del monitor, que usa una ventana
que arrastra y por eso retrasaba el corte. **Era al revés**, y apuntaba a
Supabase en vez de apuntar a la app.

---

## 2. Lo que sí era

### Las siete amarillas del día

Hubo 7 amarillas automáticas. Solo 2 tumbaron el sistema:

| amarilla | autos en pista | ¿cayó? |
|---|---|---|
| 09:05:54 | 7 | **sí, 4 s después** |
| 10:21:14 | 1 | no |
| 10:23:15 | 2 | no |
| 10:23:33 | 2 | no |
| 10:23:35 | 2 | no |
| 10:23:48 | 2 | no |
| 12:13:04 | 12 | **sí, 8 s después** |

El grupo de las 10:23 tuvo **seis escrituras de sector en 40 segundos** sin
consecuencia alguna; los dos que cayeron tuvieron **una sola**. No es el volumen
de escrituras: la diferencia es que hubiera un pelotón completo en pista.

### El instante del corte

Escrituras de posición, en bloques de 5 segundos:

```
12:13:00   19 escrituras  12 teléfonos
12:13:05   19 escrituras  12 teléfonos   ← amarilla automática 12:13:04
12:13:10   12 escrituras  11 teléfonos
12:13:15   (nada)
```

Y en `traza_gps`, la huella delatora:

```
12:13:12   46 filas  11 sesiones   ← once teléfonos volcando su traza a la vez
12:13:13   10 filas   1 sesión
(silencio)
```

Volcar el historial y la traza acumulada es exactamente lo que hace
`detenerGPS()` justo antes de apagarse. **Once teléfonos lo ejecutaron en el
mismo segundo.** En la otra caída: 45 filas de 7 sesiones a las 09:05:58, cuatro
segundos después de la amarilla de las 09:05:54.

Ocho segundos entre la amarilla y el volcado. Ese es justo el intervalo con que
el teléfono consultaba si su sesión seguía abierta.

### El defecto

En `app/page.tsx`, la consulta de sesión activa leía solo `data`:

```js
const { data } = await supabase.from("sesiones")
  .select("id, estado, bandera_piloto")
  .eq("piloto_id", pilotoId).eq("estado", "activa").maybeSingle();
if (data?.id) { iniciarGPS(data.id); }
else if (!data) {
  // sesión cerrada remotamente
  if (sesionId) detenerGPS();
}
```

El `error` no se recogía nunca. Si la consulta **fallaba**, `data` venía `null`
— idéntico a cuando de verdad no hay sesión — y el teléfono apagaba el GPS.

Se verificó que las sesiones seguían activas en ambos momentos: ninguna se cerró
ni se duplicó. O sea que la consulta devolvió `null` **porque falló**, no porque
no hubiera sesión.

Y no se recuperaban solos: revivir exige un `checkSession` exitoso, pero en ese
mismo instante once teléfonos estaban descargando su traza completa contra la
base.

### Por qué fallaba justo ahí

Esta parte es la explicación probable, no demostrada: no hay acceso a los logs
internos de consultas de Supabase.

Cuando un sector cambiaba de bandera, **cada teléfono respondía con un
`SELECT * FROM sectores_pista` completo**, más el panel por dos canales. Con
doce teléfonos eso son catorce consultas en el mismo milisegundo, encima de un
pelotón que ya escribía ~250 filas por minuto. Con los autos en boxes esa ráfaga
cae sobre una base ociosa y no pasa nada; con la pista llena, basta para que
alguna consulta se caiga. Es la única diferencia entre las dos amarillas fatales
y las cinco inofensivas.

---

## 3. Lo que se cambió

Tres cambios, todos en `app/page.tsx`:

1. **La consulta de sesión recoge el error.** Si la base no responde, no se
   toca nada: el GPS sigue corriendo y se pregunta de nuevo en el siguiente
   turno. Además hacen falta `CONFIRMACIONES_CIERRE` (3) respuestas buenas y
   seguidas sin sesión para apagar el GPS. Dejar a un piloto sin cronometraje a
   mitad de tanda es mucho peor que medir unos segundos de más.
2. **Un cambio de sector ya no cuesta consultas.** El evento de tiempo real
   trae la fila que cambió; se aplica sobre la lista que el teléfono tiene en
   memoria. Queda una recarga completa solo como red de seguridad, si el evento
   llegara sin `id`.
3. **El intervalo de consulta lleva azar** (8–12 s en vez de 8 s fijos), para
   que los teléfonos no pregunten todos alineados y una mala racha de la base no
   los golpee a todos juntos.

El punto 1 por sí solo evita el colapso aunque la consulta falle. El punto 2
evita que falle.

---

## 4. Consecuencia operativa mientras tanto

Las banderas viajan por el mismo canal de tiempo real. **Si el sistema se cae,
los pilotos no ven los cambios de bandera.** Hasta confirmar en pista que esto
quedó resuelto, las banderas se avisan además por radio.

---

## 5. Qué queda pendiente de verificar

- Confirmar en una jornada real con pelotón completo que una amarilla automática
  ya no corta nada.
- El panel (`components/DireccionCarrera.tsx` y `app/admin/page.tsx`) todavía
  recarga la tabla entera de sectores en cada cambio. Son dos clientes en el PC,
  no doce teléfonos, así que no entra en el mismo problema — pero si alguna vez
  el panel corre en la nube con varios puestos, hay que aplicarle lo mismo.
- Revisar si el patrón de "descartar el error y tratarlo como dato válido"
  aparece en otras consultas del proyecto.

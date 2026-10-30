# Interlomas, 17 y 18 de octubre — el GPS se vuelve a caer después de una amarilla

El 4 de octubre todos los autos perdieron el GPS dos veces, siempre segundos
después de una bandera amarilla automática con la pista llena. Se encontró la
causa, se corrigió y quedó escrito en `docs/INCIDENTE_2026-10-04.md`.

**Volvió a pasar tres veces en Interlomas, con el arreglo ya puesto.** Esto es
lo que muestran los datos de esa jornada y por qué el arreglo del 4 de octubre
no alcanzó.

Analizado el 30-10-2026 sobre `exportes/2026-10-25-Interlomas` con
`scripts/buscar-caidas-gps.mjs`.

---

## 1. Las tres caídas

| Momento | Teléfonos antes | A los 11-30 s | A los 31-120 s | Volcado |
|---|---:|---:|---:|---|
| 17-oct 12:21:04 | 7 | 2 | 2 | 6 sesiones a los 6 s |
| 18-oct 09:25:55 | 11 | **0** | **0** | 7 sesiones a los 4 s |
| 18-oct 10:53:51 | 10 | 2 | 2 | 8 sesiones a los 5 s |

Las tres, segundos después de una amarilla automática con pelotón en pista.
**Ninguna se recuperó sola.** La del 18 a las 09:25 dejó la pista sin un solo
teléfono transmitiendo, en medio del Entrenamiento 1, que terminó cinco minutos
después: esa tanda se perdió entera.

### La huella

Antes de apagarse, el teléfono vuelca de golpe la traza acumulada —
`detenerGPS()` llama a `volcarTraza()` antes de soltar el `watch`—. En
`traza_gps` eso se ve como muchas sesiones escribiendo en un mismo segundo,
cuando lo normal es una o dos. En toda la jornada:

```
 1 sesión   · 3.920 segundos
 2 sesiones · 1.524 segundos
 3 sesiones ·   242 segundos
 4 sesiones ·    17 segundos   ← la subida periódica normal, cada 10 s
 6 sesiones ·     1 segundo    ← 17-oct 12:21:10
 7 sesiones ·     1 segundo    ← 18-oct 09:25:59
 8 sesiones ·     1 segundo    ← 18-oct 10:53:56
```

Tres segundos en toda la jornada con 6, 7 y 8 sesiones volcando a la vez, y los
tres son las tres caídas. No hay ambigüedad.

### No es toda amarilla

Igual que el 4 de octubre. De 16 amarillas automáticas, 10 ocurrieron con
pelotón y solo 3 momentos tumbaron el GPS:

| amarilla | teléfonos | ¿cayó? |
|---|---:|---|
| 17-oct 12:21:04 | 7 | **sí** |
| 18-oct 09:25:55 y 09:26:07 | 11 | **sí** |
| 18-oct 10:47:27 · 28 · 36 · 37 | 10 | no (cuatro seguidas en 10 s) |
| 18-oct 10:53:51 y 10:53:52 | 10 | **sí** |
| 18-oct 14:18:28 | 9 | no |

Las cuatro amarillas de las 10:47, una detrás de otra con diez autos en pista,
no hicieron nada. La amarilla sola no es el disparador.

---

## 2. Lo que esto descarta

**No es el defecto del 4 de octubre.** Ese arreglo funciona.

`checkSession` ahora recoge el `error` y además exige `CONFIRMACIONES_CIERRE`
(3) respuestas buenas y seguidas sin sesión antes de apagar. Con el intervalo de
8–12 s, apagar por ese camino toma **24 segundos como mínimo**. Los tres
volcados ocurrieron a los **4, 5 y 6 segundos** de la amarilla. Por ahí no pasó.

---

## 3. Las dos puertas que quedaron sin blindar

`detenerGPS()` tiene tres llamadores en `app/page.tsx` y solo uno se blindó.

### El evento en vivo de sesiones

```js
.on("postgres_changes", { event: "UPDATE", schema: "public", table: "sesiones" },
  payload => {
    const s = payload.new;
    if (s.piloto_id === pilotoId) {
      if (s.estado === "activa")   iniciarGPS(s.id);
      if (s.estado === "inactiva") detenerGPS();   // ← sin confirmar nada
    }
  })
```

Un solo evento apaga el GPS. Sin confirmaciones, sin mirar errores, sin
reintento. Es el mismo patrón que costó el 4 de octubre, en otra puerta.

### `iniciarGPS` empieza apagando

```js
const iniciarGPS = (sid) => {
  if (sesionId === sid) return;
  detenerGPS();      // ← vuelca la traza y produce la misma huella
  ...
}
```

Si a un teléfono le llega una sesión con **otro id**, vuelca la traza igual.
Este camino produce la huella sin dejar el GPS apagado —vuelve a arrancar—,
así que puede explicar un volcado pero no que los teléfonos no vuelvan.

---

## 4. La hipótesis, que NO está demostrada

La **v0.42.2 del 17 de octubre** hizo que ingresar a un piloto **cierre primero
sus sesiones anteriores** y después abra la nueva. Eso emite `estado: inactiva`
a propósito, y el teléfono está escuchando. El orden es deliberado y está bien
razonado: el teléfono tiene que enterarse del cierre antes que de la apertura.

Lo que no se consideró es qué pasa si la apertura **no llega, llega fuera de
orden o llega tarde**: el teléfono queda apagado y solo `checkSession` puede
revivirlo, que es justo el camino al que se le agregaron 24 segundos de
prudencia.

En la caída del 18 a las 09:25, **siete pilotos entraron a pista en los 15
segundos previos** a la amarilla: siete cierres y siete aperturas encimadas. En
la del 18 a las 10:53 hay ingresos y salidas duplicados por tener dos paneles
admin abiertos. En la del 17 a las 12:21 hay una bandera a cuadros global 3
segundos después de la amarilla y 3 antes del volcado.

El hilo común no es la amarilla: es **una ráfaga de eventos en vivo con la
pista llena**. La amarilla es una de las cosas que produce esa ráfaga.

Dos de las tres caídas son del 18, es decir después de la v0.42.2. Puede ser
coincidencia —el 18 fue el día con más autos— o puede ser que el arreglo del
"Sin señal" haya abierto más esta otra puerta. **Con estos datos no se puede
distinguir.**

---

## 5. Por qué no se puede cerrar todavía

El `log_acciones` registra lo que el panel hace, no lo que el teléfono decide.
No hay forma de saber desde fuera **por qué** un teléfono llamó a
`detenerGPS()`: si recibió un `inactiva`, si falló una consulta, o si el efecto
se volvió a montar.

Es exactamente el pendiente que quedó anotado en el CHANGELOG de la 0.42.2:
**falta un registro de errores del cliente.** Sin eso, cualquier arreglo acá es
a ciegas y la próxima jornada volvería a dejar la misma pregunta.

El export tampoco trae la tabla `sesiones`, así que no se puede comprobar si
hubo cierres en esos instantes. Conviene agregarla a `exportar-prueba.mjs`.

---

## 6. Qué haría falta

En orden de lo que más sirve:

1. **Registro de errores del cliente.** Que el teléfono deje constancia de cada
   `detenerGPS()` con el motivo, y de cada consulta fallida. Es lo único que
   convierte la próxima caída en un diagnóstico en vez de en otra hipótesis
2. **Exportar `sesiones`** junto con el resto de la jornada
3. **Blindar las dos puertas**, con la misma regla del 4 de octubre: un evento
   suelto no es una orden de apagar. Confirmar el cierre contra la base antes
   de obedecer un `inactiva`, y no volcar la traza entera cuando `iniciarGPS`
   solo está cambiando de sesión
4. Recién entonces, una jornada con pelotón completo que lo confirme

El punto 3 es tentador de hacer primero porque es el más fácil. Hacerlo sin el
punto 1 deja el mismo problema de siempre: si la próxima jornada no se cae, no
se sabrá si fue por el arreglo o porque no se dio la combinación.

---

## 7. Consecuencia operativa

Sigue vigente lo del 4 de octubre: **las banderas se avisan también por radio.**
Mientras esto no esté cerrado, hay que contar con que una amarilla con la pista
llena puede dejar a varios pilotos sin pantalla y sin cronometraje por el resto
de la tanda.

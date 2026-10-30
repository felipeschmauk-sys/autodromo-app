# Plan: que la advertencia no pueda fallar en silencio

Decidido el 30-10-2026, después de `docs/EVALUACION_ADVERTENCIAS.md`.

No es un parche ni una reescritura. Es **rehacer el contrato de una sola capa**
—la pantalla de advertencia del piloto— más dos reglas.

---

## La regla que manda

> **Todo piloto en pista ve el estado vigente de las advertencias, o ve que no
> lo está viendo, dentro de N segundos. Siempre.**

Es lo único que no puede fallar. Todo lo demás —diferencias, posiciones, mejor
vuelta, el arriendo del cálculo, el replay— es negociable, y existe para que el
piloto tenga motivo de mirar la pantalla.

La regla se puede incumplir de forma medible, y por eso sirve: cualquier cambio
en esta capa se juzga preguntando si la sostiene.

---

## Por qué no alcanzaba con parchar

La evaluación encontró seis agujeros. No son seis problemas: son **un solo
defecto de diseño**. El sistema empuja eventos y nadie confirma nada — no hay
acuse de recibo, ni latido, ni forma de saber si el piloto quedó cubierto.

Un callback de estado, una consulta de respaldo y una relectura al recuperar el
foco son tres mecanismos nuevos que tapan tres síntomas del mismo defecto, y
cada mecanismo nuevo es una cosa más que se puede caer.

---

## Lo que NO se toca

Importante, porque acota el trabajo:

- **Una bandera es una fila y manda la última escritura.** Sin colas, sin orden,
  sin estado que reconstruir, y cualquier panel puede escribirla desde cualquier
  aparato. Es el diseño correcto y se queda igual
- El evento de sector se aplica desde el payload, sin re-consultar (arreglo del
  4 de octubre)
- El cronometraje, el arriendo del cálculo y el panel

---

## 1. La pizarra muestra el estado Y la edad de su conocimiento

Hoy la pizarra es función de `bandera`. Pasa a ser función de
**`(bandera, hace cuánto lo confirmé)`**.

Verde deja de significar "lo último que recibí fue verde" y pasa a significar
**"confirmé hace menos de N segundos que la pista está libre"**. Vencido ese
plazo, la pantalla lo dice con el mismo peso visual que una bandera — la
pantalla entera, no un icono en la esquina.

### Dos señales independientes de frescura

Una sola no basta: el socket puede creerse vivo y no estarlo.

1. **Estado del canal** (`subscribe((estado) => …)`): `SUBSCRIBED` es contacto;
   `CHANNEL_ERROR`, `TIMED_OUT` o `CLOSED` cortan el contacto **al instante**.
   Es inmediato y gratis
2. **Relectura de respaldo**, cada 20–30 s **con azar por teléfono**, que
   además de traer el estado reinicia el reloj de "confirmado hace". El azar no
   es un detalle: una ráfaga sincronizada de consultas es justo lo que tumbó la
   prueba del 4 de octubre. Más una relectura al recuperar el foco

"Sin contacto" cuando falla la señal 1, o cuando pasan **dos relecturas
perdidas** sin confirmar por la 2.

Con esto, el callback de estado, la consulta de respaldo y la relectura al
volver el foco dejan de ser tres parches: son tres formas de mantener fresco un
mismo dato, y la regla de arriba queda cumplida por construcción.

---

## 2. La advertencia no depende de lo que se rompe

Hoy la bandera de sector necesita la posición del teléfono, que es exactamente
lo que muere en las caídas. Y `posPiloto` nunca vence, así que el teléfono se
cree en el último sector conocido para siempre.

**Regla: sin posición fresca no se calla, se escala.**

- Posición más vieja que `FRESCURA_POS_MS` (10 s, el mismo umbral que ya usa el
  panel) → no se resuelve el sector
- Si hay **alguna** amarilla en pista y no sé dónde estoy → **muestro amarilla**

Una amarilla de más cuesta una vuelta lenta. Una amarilla de menos cuesta un
choque. Ante la duda, se avisa.

Atenuante que ya existe y conviene mantener a la vista: las banderas **globales**
siguen llegando aunque el GPS muera, porque viajan por otro efecto. Si el
director ve la caída y pone una roja global, el piloto la ve. Hasta que esto
esté hecho, ese es el procedimiento.

---

## 3. La amarilla automática tiene que ser real antes de viajar

Las 12 amarillas automáticas de Interlomas, por cuánto duraron:

| Duración | Cuántas |
|---|---:|
| 3 a 10 segundos | **8** |
| 15 a 33 segundos | 3 |
| 9 min 45 s | 1 |

Tres duraron 3, 4 y 6 segundos. Un auto "detenido" tres segundos no es un auto
detenido: es una curva lenta, un trompo que siguió o ruido del GPS. Pablo
Olmedo generó además dos episodios separados por cinco segundos — la bandera
parpadeando sobre el mismo auto.

La causa está a la vista en `checkAutoYellow` (`components/DireccionCarrera.tsx`):
decide **solo por velocidad**, con histéresis de `DETENIDO_KMH` (10) y
`REANUDA_KMH` (13), y **no exige que el auto lleve detenido ningún tiempo**. En
cambio el punto de auto detenido que se dibuja en la pantalla de los demás sí
exige `DETENIDO_MS` (5 s) sostenidos. Son dos reglas distintas para el mismo
hecho, y la que dispara la bandera es la más nerviosa.

**Regla: exigir tiempo sostenido para ponerla y para quitarla**, reutilizando
`DETENIDO_MS`. Con 5 s sostenidos, los episodios de 3 y 4 segundos no habrían
existido.

Cada amarilla falsa es un evento que se abre en abanico a todos los teléfonos:
es la carga que correlaciona con las caídas del GPS. Quitar el ruido no arregla
la caída, pero le saca la mayor parte del combustible.

---

## El orden, y por qué

1. **La pizarra con edad de conocimiento** (punto 1)
2. **Vencer la posición y escalar** (punto 2)
3. **Tiempo sostenido en la amarilla automática** (punto 3)
4. **Registro de errores del cliente** (pendiente desde la 0.42.2), y recién
   después tocar los dos caminos a `detenerGPS()` de
   `docs/INCIDENTE_2026-10-18.md`

El punto 3 es el más fácil y el más visible, y por eso es tentador ponerlo
primero. Hacerlo antes del 1 deja el sistema fallando menos seguido y de forma
igual de silenciosa, que es la situación en la que creímos estar desde el 4 de
octubre.

---

## Cómo se comprueba

- **Punto 1:** con el teléfono en pista y el modo avión unos segundos, la
  pantalla tiene que decir "sin contacto" y volver sola. Es la única prueba que
  importa y se hace en treinta segundos
- **Punto 2:** cortar el GPS del teléfono con una amarilla puesta en otro sector
- **Punto 3:** `scripts/buscar-caidas-gps.mjs` sobre la próxima jornada: los
  episodios de menos de 5 s deberían desaparecer del log

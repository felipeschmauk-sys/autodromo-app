# ¿Llega siempre la advertencia al piloto?

Evaluación del 30-10-2026, hecha contra **el objetivo principal de la app**:
que una advertencia del director llegue al piloto en pista, siempre.

Todo lo demás —cronometraje, posiciones, diferencias— existe para que el piloto
tenga motivo de mirar la pantalla. Es el anzuelo; la advertencia es la carga.
Esta evaluación mira solo la carga.

Sin cambios de código: es un diagnóstico.

---

## El camino completo de una advertencia

```
director aprieta  →  estado_pista / sectores_pista / sesiones   (una fila)
                  →  Realtime (postgres_changes)
                  →  teléfono: resuelve la jerarquía
                  →  pantalla
```

Hay cuatro clases de advertencia y **no corren el mismo riesgo**:

| Advertencia | De dónde sale | Qué necesita el teléfono |
|---|---|---|
| Global (roja, amarilla, cuadros, SC) | `estado_pista` | solo el canal de tiempo real |
| De sector (incluida la automática) | `sectores_pista` | el canal **y su posición GPS** |
| Personal (negra, taller…) | `sesiones.bandera_piloto` | el canal |
| Azul automática | cálculo del panel, por broadcast | el canal **y que alguien esté calculando** |

Esto importa: las fallas que vienen después no afectan a todas por igual.

---

## Lo que está bien resuelto

Vale decirlo, porque acota el problema.

- **Una bandera es una fila, y la última escritura manda.** No hay cola, ni
  orden, ni estado que reconstruir. Cualquier panel puede escribirla desde
  cualquier aparato. Es lo más simple que puede ser, y eso es una virtud
- **Un cambio de sector no cuesta consultas** (`app/page.tsx:1581`): el evento
  trae la fila y se aplica en memoria. Es el arreglo del 4 de octubre y está bien
- **Las banderas globales sobreviven a la caída del GPS.** El canal de banderas
  vive en un efecto aparte del GPS (`app/page.tsx:1537` vs `app/page.tsx:2160`).
  Si el GPS muere, la roja y la cuadros siguen llegando
- **Queda registro de lo que el piloto VE, no de lo que debería ver**
  (`bandera_vista` en el log, y la pestaña Pantallas con lo que informa cada
  teléfono). Muy pocos sistemas tienen esto. Es lo que permitió diagnosticar la
  azul falsa del 4 de octubre
- **El director tiene aviso de "sin señal"** por piloto, a los 20 s

---

## Los agujeros, por gravedad

### 1. El piloto no puede distinguir "verde" de "no me está llegando nada"

**El más grave de todos, y es de diseño, no un error.**

Los dos canales de banderas del teléfono se abren así
(`app/page.tsx:1578` y `app/page.tsx:1603`):

```js
.subscribe();   // sin callback de estado
```

Sin callback no hay forma de saber si la suscripción se cayó. Y no hay
**ninguna consulta de respaldo**: el estado inicial se lee una sola vez, al
entrar al evento. Si el canal muere a los dos minutos, el teléfono sigue
mostrando la última bandera que recibió **para siempre**, sin aviso.

El panel del director sí sabe: tiene `realtimeConectado` y muestra "En vivo /
Conectando…" (`app/admin/page.tsx:1242`). **El teléfono del piloto, que es
donde importa, no tiene nada de eso.**

Consecuencia directa: una pantalla verde significa dos cosas opuestas —"pista
libre" y "no tengo contacto"— y el piloto no puede distinguirlas. Es la falla
más peligrosa posible en un sistema cuyo trabajo es avisar.

### 2. La bandera de sector se calcula con una posición que puede ser de hace minutos

`posPiloto` se escribe pero **nunca se vacía ni se vence**
(`app/page.tsx:1240`, `2209`). `detenerGPS()` no lo toca.

La jerarquía lo usa sin mirar la antigüedad (`app/page.tsx:2756`):

```js
if (!posPiloto || posPiloto.dentro !== true) return null;
```

Si el GPS se apaga, el teléfono sigue creyéndose en el último sector conocido.
Puede mostrar la amarilla de un sector que ya dejó atrás, o —peor— no mostrar
la del sector donde realmente está.

Llama la atención porque el resto del proyecto sí mide frescura: el panel
descarta posiciones viejas con `FRESCURA_POS_MS` antes de clasificar. En la
pantalla del piloto, que es donde cuenta, no hay ninguna.

### 3. El GPS se sigue cayendo tras las amarillas, y eso apaga justo la de sector

Documentado en `docs/INCIDENTE_2026-10-18.md`: tres caídas en Interlomas con el
arreglo del 4 de octubre ya puesto, de 5 a 11 teléfonos cada vez, ninguna
recuperada sola.

Lo que agrega esta evaluación es **por qué es peor de lo que parecía**: la
amarilla automática es una bandera **de sector**, y la caída del GPS es
exactamente lo que deja al teléfono sin poder resolver su sector. El evento que
tumba el GPS es el mismo cuya advertencia el piloto después no puede recibir.

Atenuante real: las banderas globales siguen llegando. Si el director ve la
caída y pone una **roja global**, el piloto la ve aunque su GPS esté muerto.

### 4. La azul y la cuadros propia ahora dependen del arriendo

**Esto lo introdujimos nosotros en la v0.44.0.** Antes, cualquier panel abierto
calculaba y emitía; ahora calcula **exactamente uno**. Si nadie tiene el
arriendo —todos los paneles cerrados, o el único en una pestaña de fondo con el
reloj frenado— no hay azul, no hay cuadros propia y no hay diferencias.

Fue la decisión correcta: dos paneles emitiendo le borraban la pantalla al
piloto, que es peor. Pero cambió un riesgo de "dos verdades" por uno de "ninguna
verdad", y ese segundo no tiene aviso en la pantalla del piloto.

Por la definición del producto esto pega doble: sin diferencias no hay anzuelo,
así que el piloto además deja de tener motivo para mirar.

### 5. Nada se refresca al volver la app al frente

El Wake Lock sí se vuelve a pedir al recuperar el foco (`app/page.tsx:1667`), y
está bien resuelto. Pero **el estado de las banderas no se vuelve a leer**: los
efectos solo se rearman si cambia `stage` o la fecha.

Una llamada entrante, una notificación o el Centro de Control pueden cortar el
socket. Al volver, el teléfono muestra lo último que supo, sin saber que no sabe.

### 6. El director no tiene alerta de discrepancia

La pestaña Pantallas muestra qué bandera pinta cada teléfono, y marca la azul
imposible y los que llevan 20 s callados. Es una base muy buena, pero **nadie
compara lo que el teléfono pinta con lo que debería pintar**. Si un piloto se
quedó con una verde vieja mientras hay roja en pista, hoy hay que notarlo a ojo
en la cuadrícula.

---

## Qué tan sólido está el objetivo principal, en una línea

**No lo está.** La advertencia llega bien cuando todo funciona, y cuando algo
falla el piloto ve exactamente lo mismo que cuando la pista está libre.

El sistema tiene buenos ojos hacia adentro —el log de lo que cada teléfono
pinta, la pestaña Pantallas, el "sin señal"— pero todos miran desde la torre.
**El piloto no tiene forma de saber si su pantalla le está mintiendo.**

---

## Lo decidido

Lo de abajo fue la primera lista, y eran seis parches para un solo defecto de
diseño. Lo que se decidió hacer está en **`docs/PLAN_ADVERTENCIAS.md`**:
rehacer el contrato de esta capa —la pizarra muestra el estado y la edad de su
conocimiento— más dos reglas, en vez de sumar precauciones sueltas.

Se deja la lista original porque el orden de gravedad sigue valiendo.

## Lo que yo haría, en orden

1. **Que el teléfono sepa y diga si está recibiendo.** Callback de estado en los
   dos canales, y un indicador visible en la pizarra. Si pasa X segundos sin
   contacto confirmado, la pantalla tiene que decirlo con el mismo peso que una
   bandera. Es el cambio que más mueve la aguja y no depende de nada más
2. **Vencer `posPiloto`.** Sin posición fresca no hay bandera de sector: mejor
   "sin posición" que la del sector equivocado
3. **Consulta de respaldo de banderas**, lenta y desfasada entre teléfonos
   (p. ej. cada 20–30 s con azar), más una relectura al recuperar el foco.
   Desfasada a propósito: una ráfaga sincronizada de consultas es justo lo que
   tumbó la prueba del 4 de octubre
4. **Registro de errores del cliente** (pendiente desde la 0.42.2). Sin esto, el
   arreglo de las caídas del GPS es a ciegas
5. **Avisar en la pantalla del piloto cuando nadie está calculando**, para que
   la ausencia de azul no se confunda con "no me están doblando"
6. **Alerta de discrepancia en Pantallas**: marcar al teléfono cuya bandera no
   coincide con la que corresponde

Los puntos 1 y 2 son los que convierten "no sé si estoy avisado" en "sé que no
lo estoy". Mientras no existan, la radio no es un respaldo: es el sistema
principal.

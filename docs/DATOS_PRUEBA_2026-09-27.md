# Jornada de prueba en pista — 27 de septiembre de 2026

Primera jornada completa con el sistema de posiciones, diferencias y banderas
funcionando en pista. **Es el conjunto de datos de referencia del proyecto**: si
se toca el detector de vueltas, el cálculo de diferencias, la bandera azul o el
cierre de carrera, hay que correr el replay contra esta jornada antes de dar el
cambio por bueno.

## Dónde está

```
exportes/2026-09-27-prueba-1/     (19 MB, fuera del control de versiones)
```

Si la carpeta no está, se vuelve a generar desde Supabase mientras los datos
sigan ahí:

```bash
node scripts/exportar-prueba.mjs "prueba 1"
```

## Cómo se usa

```bash
node scripts/replay-carrera.mjs exportes/2026-09-27-prueba-1
node scripts/replay-carrera.mjs exportes/2026-09-27-prueba-1 "Carrera 5"
```

Reconstruye lo que cada teléfono habría detectado y lo que el panel habría
calculado: vueltas, llegada, resultado oficial y banderas azules. La columna
`dif` compara los cruces del replay contra los que quedaron registrados en vivo;
si da 0, el replay es fiel.

## Qué contiene

| | |
|---|---|
| Circuito | Autódromo Las Vizcachas · 1618 m · 26 puntos |
| Tandas | 9 (2 libres, 1 entrenamiento, 1 clasificación, 5 carreras) |
| Lecturas de GPS | 26.329 |
| Vueltas registradas | 120 |
| Autos | 4 en pista, más uno que se suma en la Carrera 5 |
| Categorías | una sola (`Pruebas`) — la separación por categorías no se probó |

Los autos eran de calle, no de carrera, así que los tiempos de vuelta son
irregulares (70 a 170 s) y hay arranques y detenciones. Para probar lógica eso
no molesta; para juzgar precisión de cronometraje, sí.

**Sin referencia externa.** No hubo MyLaps esta jornada. La única validación
externa del cronometraje sigue siendo la de agosto contra Codegua (0,014 s de
error medio).

## Escenarios que quedaron capturados

Esto es lo que hace valioso al conjunto: cada caso es un test de regresión real.

### Carrera 1 — el emisor congelado en la tanda equivocada
`largada_at` sin marcar (la columna no existía todavía). Durante toda la carrera
el panel repartió posiciones en modo `libre` porque el emisor quedó capturado en
la clasificación anterior. Sirve para verificar que el emisor lee la tanda
**activa** y no la seleccionada.

### Carrera 3 — primera con largada marcada
`largada_at` 12:43:11. Un solo piloto completa las vueltas programadas; los otros
tres se quedan cortos. Sirve para el caso "el líder termina y los demás nunca
cruzan de nuevo".

### Carrera 4 — llegada escalonada ajustada
`cup` 13:05:04 y `ang` 13:05:08: **4,7 segundos** entre el primero y el segundo.
Es el caso para verificar que la bandera a cuadros cae por piloto y no para todos
a la vez. Los dos quedaron estacionados con 80,8 % de vuelta recorrida, así que
también es el caso que demuestra por qué el desempate no puede ser la posición en
pista.

### Carrera 5 — el caso más completo
Cinco autos, llegada repartida en 98 segundos, y un doblado que cruza antes que
alguien de la vuelta del líder.

- **Resultado correcto**: P1 `ang`, P2 `cup`, P3 `rik`, P4 `yo`, P5
  `Andres werner`. Confirmado con el piloto que iba en pista. `Andres werner`
  cruza tercero pero termina quinto por tener una vuelta menos: **si el replay
  lo pone tercero, la regla de desempate está rota.**
- **Bandera azul**: 611 instantes encendida sobre 7.961 con alguien doblado.
  Acercamiento máximo de 0,1 s. Si un cambio de umbral o de histéresis baja
  mucho ese número, conviene mirar por qué.
- **Datos viejos**: el notebook del panel viajaba dentro de un auto, colgado de
  un teléfono, así que la señal se cortaba. Simulando un corte de 5 minutos
  sobre estos datos, el panel mostraba a un piloto **P1 cuando iba P4**. Es el
  caso que justifica el filtro de frescura.

### Entrenamiento 1 y Clasificación 1
Posiciones por mejor vuelta, sin bandera azul. Sirven para confirmar que el modo
`libre` no se contamina con lógica de carrera.

## Cosas que hay que saber al leer estos datos

**El replay detecta más cruces que los registrados**, normalmente uno por piloto.
No es pérdida de vueltas: el detector de la app exige armarse pasando por la
mitad del circuito antes de aceptar un cruce, y descarta los posteriores a que el
piloto ya terminó. El replay es más permisivo. Una diferencia de 1 es esperable;
de 2 o más, hay que mirar.

**El trazado tiene un tramo de 586 m entre dos puntos**, el 36 % de la vuelta,
mientras el resto tiene puntos cada 17 a 42 m. No se confirmó en terreno si la
pista va recta ahí. Si algún día las diferencias entre autos salen raras en una
zona concreta, esto es lo primero que hay que revisar.

**Un piloto sin categoría no recibe posición ni diferencias.** `Andres werner`
estuvo sin categoría durante la primera carrera del día y después se le asignó.
Si aparece con `Pos. --` en las tandas tempranas, es por eso y no por una falla.

**Las diferencias y las banderas azules que el panel repartió en vivo no están
guardadas.** Viajan por broadcast efímero. El replay las recalcula, pero lo que
cada piloto vio en su pantalla solo existe en las grabaciones de pantalla.

## Lo que quedó sin probar

- Dos o más categorías compitiendo a la vez
- El filtro por categoría al descargar resultados
- Carrera terminada por tiempo en vez de por vueltas: el congelado necesita
  `vueltas_programadas`
- Toda la cadena con el panel en un punto fijo y con buena conexión, que es la
  condición en la que debería operar

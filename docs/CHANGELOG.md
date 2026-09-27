# CHANGELOG.md
# Historial de Versiones — Autódromo App

---

## [0.33.0] — 27 Septiembre 2026
### Agregado (El auto detenido se ve con bandera roja)
- Con bandera roja, la pantalla del piloto marca con un **punto amarillo
  pulsante** dónde hay un auto detenido en pista
- Por qué: la roja se impone sobre cualquier otra bandera —y eso está bien—,
  pero eso mismo deja **invisible la advertencia de auto detenido** justo
  cuando hay que saber por dónde pasar con cuidado. Pasó en la prueba del 27 sep
- Se marca **la posición, no el sector**: basta con ver el punto
- El punto propio del piloto se dibuja siempre encima, para que nunca se
  confunda el suyo con uno ajeno

### Detalle
- El teléfono del piloto no recibe las posiciones de los demás, y eso no cambia:
  la posición del detenido viaja dentro del mensaje de estado que el panel ya
  mandaba cada segundo. Es la única excepción, y solo para autos detenidos
- Un auto cuenta como detenido bajo 5 km/h **sostenidos 5 segundos**, dentro de
  la geocerca. El umbral es el mismo de la amarilla automática, pero con espera:
  en una horquilla lenta un auto puede bajar de 5 km/h sin estar detenido
- Si el detenido es el propio piloto no se le marca: ya lo sabe, y su punto rojo
  ya está en pantalla

---

## [0.32.0] — 27 Septiembre 2026
### Cambiado (El cronometraje vive debajo del mapa y ya no se apaga)
- El cronometraje aparece ahora **debajo del mapa en la pestaña Dirección**:
  se sube para ver el mapa y se baja para ver los tiempos, sin cambiar de
  pestaña. En Dirección además queda más ancho que antes
- **Lo importante es lo que esto arregla, no la comodidad.** El cronometraje
  vivía dentro de su pestaña, así que mirar el mapa lo desmontaba: se cortaba
  el reparto de posiciones y de bandera azul a todos los pilotos, y se perdía
  el estado de llegada de la carrera en curso
- Es el bloqueante que estaba anotado desde el primer día del checklist de
  pruebas: "con una sola ventana siempre te falta una de las dos mitades".
  Ya no hace falta abrir dos ventanas del navegador

### Detalle
- Se monta **una sola instancia**, siempre viva, y solo se esconde con `display`
  cuando la pestaña activa no es Dirección ni Crono. Una sola, para que nunca
  haya dos emisores mandando estado a los pilotos a la vez
- La pestaña Crono sigue existiendo y muestra la misma instancia a pantalla
  completa
- Queda fuera el mapa de Dirección en sí: si se cambia a otra pestaña, la
  amarilla automática deja de correr. Con el cronometraje ya resuelto, operar
  desde Dirección deja las dos cosas vivas a la vez

---

## [0.31.1] — 27 Septiembre 2026
### Corregido (El reloj de Dirección seguía contando con la roja puesta)
- Con bandera roja el cronómetro de la pestaña **Crono** se detenía bien, pero el
  de **Dirección** seguía descontando. No eran dos relojes distintos: era el
  mismo dato, leído de una copia vieja
- Cronometraje relee las tandas cada 10 s; el panel de Dirección solo las
  recargaba al iniciar o finalizar una, así que su copia quedaba congelada desde
  antes de la pausa
- **Lo grave no era el display.** El cierre automático de la tanda usa esa misma
  copia, así que la tanda se habría finalizado sola en el horario original pese a
  estar detenida, y el tiempo recuperado se perdía igual
- Ahora la revisión que corre cada 5 s relee el estado de pausa desde la base, y
  al poner la bandera el cambio se refleja de inmediato sin esperar ese ciclo

### Detalle
- Se relee de la base y no solo del estado local porque la bandera puede venir de
  otro dispositivo: quien la pone no es necesariamente quien mira la pantalla

---

## [0.31.0] — 27 Septiembre 2026
### Agregado (El cronómetro se detiene con bandera roja)
- Con bandera roja **el tiempo de la tanda se congela**, y vuelve a correr con la
  verde. Aplica a entrenamiento, clasificación y carrera
- Antes el reloj seguía corriendo igual: en la clasificación del 27 de
  septiembre se puso roja hasta que se acabó el tiempo y esa tanda se perdió
  entera. En una carrera real ese tiempo se recupera al resolver el problema
- El indicador de tanda activa muestra **"Cronómetro detenido"** en rojo mientras
  dura la pausa, para que se vea que el reloj no está corriendo
- **Si el director finaliza la tanda a mano, se termina y ese tiempo se pierde.**
  Finalizar es finalizar

### Detalle
- Migración: `docs/task-pausa-roja-migration.sql`. Agrega `pausado_ms` (la suma
  de las pausas ya cerradas) y `pausa_desde` (la pausa en curso) a `tandas`
- El cálculo del reloj estaba repetido en cinco lugares —los dos paneles, el
  teléfono, el auto-finalizar y la tabla— y ahora vive en `lib/carrera.ts`:
  `deadlineTanda`, `transcurridoTandaS`, `pausaAcumuladaMs` y `tandaEnPausa`
- Mientras hay una pausa abierta el final de la tanda se corre al mismo ritmo
  que el reloj de pared, así que el tiempo restante se queda quieto
- Retrocompatible: sin la migración el reloj corre como antes, sin fallar
- Verificado: una tanda de 10 min que arranca 14:00 y se detiene de 14:03 a
  14:08 termina 14:15 con los 7:00 restantes intactos durante toda la pausa

---

## [0.30.0] — 27 Septiembre 2026
### Agregado (Fijar la línea de meta desde el editor de sectores)
- La meta ya no se asume en el arranque del trazado. En **Config → Sectores**
  aparece un marcador a cuadros **arrastrable sobre el mapa**, más botones `+` y
  `−` para moverlo punto a punto
- Es propiedad del **circuito**, no del primer sector: en cada autódromo la meta
  está donde está, y no tiene por qué coincidir con una división de sectores
- Se puede guardar aunque el circuito no tenga sectores divididos

### Detalle
- La columna `circuitos.meta_idx` ya existía desde la migración de cronometraje
  y las tandas ya la copiaban al crearse; lo único que faltaba era la interfaz
- **Las tandas ya creadas conservan su meta.** Se copia al iniciar la tanda, así
  que cambiarla a mitad de un evento no mueve la meta de una carrera en curso
- Verificado sobre la Carrera 5: mover la meta del punto 0 al 6 corre todos los
  cruces 11 segundos —lo que el auto tarda en recorrer ese tramo— y el conteo de
  vueltas se mantiene. La meta define dónde se corta la vuelta, no cuántas hay
- El detector se arma entre 40% y 70% de la vuelta, y como ese porcentaje es
  relativo a la meta, la zona de armado se mueve sola con ella

---

## [0.29.8] — 27 Septiembre 2026
### Corregido (El texto desaparecía sobre la bandera a cuadros)
- Con la bandera a cuadros desplegada, las letras blancas se perdían sobre los
  cuadros blancos: la posición, la vuelta y las diferencias quedaban ilegibles
  justo al terminar la carrera
- Pasa lo mismo en la **negra con blanco** y, en menor medida, en la de **rayas**:
  son fondos de dos tonos, y sobre ellos **ningún color de letra funciona solo**
- El texto se mantiene blanco y ahora lleva un halo oscuro detrás. Sobre las
  zonas negras el halo no se nota; sobre las blancas es lo que dibuja la letra.
  Es preferible a oscurecer el blanco de la bandera, que dejaría de leerse como
  bandera a cuadros
- El aro del icono de bandera también se perdía sobre los cuadros claros: lleva
  un contorno oscuro

- Un halo difuso no alcanzaba sobre un fondo tan movido. Lo que hace legible la
  letra es un **contorno nítido**: `paint-order: stroke` lo dibuja debajo del
  relleno, así que engorda la letra por fuera en vez de comérsela por dentro
- El aviso de "mantén presionado para salir" no se salva con contorno: es texto
  chico y va atenuado a propósito. Lleva una **placa oscura detrás**, que es lo
  único que garantiza contraste a ese tamaño

### Detalle
- `text-shadow` se hereda, así que los triángulos de tendencia quedan cubiertos
  sin tocarlos
- Los fondos de un solo tono no cambian: ahí el contorno sería ruido

---

## [0.29.7] — 27 Septiembre 2026
### Corregido (Sin datos recientes no hay posición)
- **El panel clasificaba con datos viejos como si fueran actuales.** Tomaba la
  última posición conocida de cada piloto sin mirar cuándo había llegado, así
  que un auto del que no se sabía hace minutos seguía en la tabla con sus
  vueltas de entonces, y todos los demás se ordenaban contra ese fantasma
- Ahora, si de algún piloto de la categoría no hay datos de los últimos 10
  segundos, **nadie de esa categoría recibe posición**: se muestra `Pos. --`
  hasta que vuelvan los datos. Si no sé dónde está uno, tampoco sé si el otro
  va tercero o cuarto
- El cálculo de diferencias ya descartaba lo que tuviera más de 8 s. El de
  posiciones no filtraba nada
- No aplica a entrenamiento ni clasificación: ese orden sale de los tiempos
  guardados en la base, que no se degradan si se corta el broadcast

### Por qué apareció
- En la prueba del 27 sep el notebook del panel viajaba **dentro de un auto**,
  conectado por el teléfono del piloto. La señal se cortaba, y como las
  posiciones viajan por broadcast efímero, lo que no llega no se recupera
- Simulando un corte de 5 minutos sobre los datos reales de la Carrera 5, el
  panel mostraba a ese piloto **P1 cuando iba P4**, con los demás congelados en
  2 y 3 vueltas. Es exactamente lo que reportó en pista
- Con el filtro, los cinco pasan a `--` en vez de recibir números equivocados

---

## [0.29.6] — 27 Septiembre 2026
### Corregido (La llegada: posición final y estado que no se puede perder)
- **El estado de llegada ahora vive en refs, no en variables del efecto.** Quién
  ya terminó, en qué posición y con cuántas vueltas venía cada uno cuando cruzó
  el líder: todo eso se perdía si el efecto se volvía a montar a mitad de
  carrera —basta con recargar el panel— y entonces el líder "volvía a terminar",
  los que ya habían llegado se recongelaban con otra posición y el resultado
  quedaba revuelto
- **La posición final ya no se recalcula por distancia recorrida.** Manda el
  número de vueltas, y entre los que tienen las mismas, quién cruzó primero.
  Antes se medía en el peor instante posible: al cruzar la meta el progreso de
  vuelta vuelve a cero, así que el que acababa de llegar aparecía detrás de
  cualquiera que viniera a mitad de su vuelta
- Un doblado termina detrás de los de la vuelta del líder aunque haya cruzado
  la meta antes que alguno de ellos

### Verificado contra la Carrera 5 del 27 sep
- Orden de cruce: ang 13:37:43, cup 13:37:48, Andres 13:38:03 (con 4 vueltas),
  rik 13:38:10, yo 13:39:21
- Resultado con la regla corregida: **P1 ang · P2 cup · P3 rik · P4 yo · P5
  Andres**, que es exactamente lo que el piloto reportó que debía ser. Andres
  cae a P5 por su vuelta de menos aunque cruzó tercero
- La bandera azul sí tenía condiciones: **474 instantes bajo el umbral de 5 s**
  con un acercamiento máximo de 0,4 s. No llegó ninguna a la pantalla

---

## [0.29.5] — 27 Septiembre 2026
### Corregido (El cierre de carrera: cada piloto termina en SU cruce)
- **La bandera a cuadros ahora cae por piloto.** Cuando cruza el primero, los
  demás siguen girando y recién terminan al pasar ellos por meta: ahí, y no
  antes, su pantalla se pone a cuadros. Antes solo cambiaba el texto a `FINAL` y
  el fondo seguía en verde, así que el piloto no tenía señal clara de que su
  carrera había terminado
- Es una bandera **personal**, distinta de la de cuadros global que pone el
  director al cerrar la tanda. Le dice a ese piloto que su carrera terminó, no
  que terminó la carrera
- **El resultado oficial ya no se mueve después de la llegada.** Entre dos
  pilotos con las mismas vueltas, el desempate ahora es quién cruzó primero.
  Antes se usaba la posición en pista, así que el que seguía girando tras la
  bandera le pasaba por delante al que ya se había detenido

### Medido sobre la Carrera 4 del 27 sep
- `cup` terminó 13:05:04 y `ang` 13:05:08: **4,7 segundos de diferencia** en los
  que cada uno debe ver su propia bandera, no los dos a la vez
- Los dos quedaron estacionados con 80,8% de vuelta recorrida, así que el
  resultado salió correcto **por casualidad**: con dos metros de diferencia
  entre dónde pararon, el orden oficial se habría invertido

### Límite conocido
- El congelado necesita `vueltas_programadas`. Un piloto que nunca vuelve a
  cruzar después de que termina el líder no recibe su bandera propia, y queda
  cubierto por la de cuadros global al cerrarse la tanda. Pasó con `rik` y
  `Andres werner` en las Carreras 3 y 4

---

## [0.29.4] — 27 Septiembre 2026
### Corregido (Los pilotos veían la posición de la tanda equivocada)
- **El emisor de posiciones a los pilotos quedaba congelado en la tanda que
  estaba seleccionada cuando arrancó.** Leía `tandaSel` dentro de un
  `setInterval` de larga vida sin declararla como dependencia, así que la
  capturaba una sola vez. La tabla del panel sí se actualizaba, porque su
  `useMemo` sí la declara — de ahí el síntoma: el admin veía bien y los pilotos
  no
- Ahora lee la tanda **activa** desde un ref que se mantiene al día. Son dos
  conceptos distintos: la seleccionada es la que el admin mira en el
  desplegable, y cambiarla no debe alterar lo que ven los pilotos en pista
- El botón de largada **avisa cuando falla**. Antes volvía a su estado normal en
  silencio

### Qué pasó en la prueba del 27 sep
- Durante toda la Carrera 1 el emisor quedó en la clasificación anterior, así que
  corrió en modo `libre`: la posición salió del **ranking por mejor vuelta** en
  vez del orden de carrera, y `sostenerAzul` nunca llegó a llamarse
- La columna `tandas.largada_at` no existía en la base — la migración
  `docs/task-largada-migration.sql` nunca se corrió — así que el botón de
  largada falló en silencio y la vuelta de formación contó como vuelta de carrera
- Replayando la carrera completa con el modo corregido: **2.053 instantes con
  alguien una vuelta abajo**, acercamiento máximo de **0,4 s** entre el doblador
  y el doblado, y **48 instantes de bandera azul** que hoy nadie vio
- El detector en sí funcionó bien: peor hueco de GPS de 1 s en casi todos los
  teléfonos, precisión mediana de 3 m y ninguna vuelta perdida

---

## [0.29.3] — 27 Septiembre 2026
### Agregado (El punto de GPS vuelve al modo conducción)
- La vista vertical siempre mostró el punto rojo del piloto sobre el mapa, pero
  la pantalla completa no: dibuja su propio SVG del trazado y ahí el punto nunca
  se había agregado
- Ahora aparece también en modo conducción. **Solo la posición del propio
  piloto**: en pista no se muestran los demás autos

### Detalle
- La posición sale de `posPiloto`, que el componente de velocidad ya venía
  guardando y que sigue montado en modo conducción, así que no hace falta un
  segundo `watchPosition` — el modo conducción no consume más batería que antes
- El punto usa las mismas funciones de proyección que dibujan el trazado, así que
  cae exactamente sobre la línea
- Anillo blanco alrededor del punto rojo: sin él se perdería contra el fondo de
  la bandera roja, donde el trazado también es rojo
- Si el piloto está lejos del circuito, el viewBox lo recorta solo. Es lo
  correcto: mejor sin punto que un punto pegado a un borde

---

## [0.29.2] — 26 Septiembre 2026
### Agregado (Exportar una jornada completa para recrearla después)
- `scripts/exportar-prueba.mjs` baja a disco todo lo que una fecha dejó grabado:
  traza GPS cruda, vueltas, circuito con su trazado y geocercas, tandas,
  sectores, categorías, log de acciones y ubicaciones. Más un `RESUMEN.md`
  legible con lecturas y vueltas por piloto
- Uso: `node scripts/exportar-prueba.mjs "prueba 1"`, o `--listar` para ver las
  fechas disponibles
- La traza es lo que permite volver a correr el detector con otros umbrales o
  recalcular las diferencias entre autos con otro algoritmo, sin volver a pista

### Detalle
- Pagina de a 1000 filas: PostgREST corta ahí y una jornada son decenas de miles
- Lo que **no** queda grabado son las diferencias y la bandera azul que el panel
  repartió en vivo: viajan por broadcast efímero y no tocan la base. Se pueden
  recalcular desde la traza, pero lo que el piloto vio en su pantalla solo existe
  en la grabación de pantalla de su teléfono
- Probado contra la fecha del 9 de agosto: 4.594 lecturas de GPS y 14 vueltas

---

## [0.29.1] — 26 Septiembre 2026
### Corregido (El mapa de fondo dejó de verse)
- **CARTO cerró su CDN gratuito de mapas** y empezó a devolver una imagen con la
  marca "API KEY REQUIRED" en vez del mapa. Lo entrega con código **200 OK**, así
  que el navegador la trata como una carga exitosa y no aparecía ningún error en
  consola: el mapa simplemente se veía roto
- Los tres mapas afectados pasan al **satélite de Esri**, que es el mismo que ya
  usaban `CircuitoManager` y `GeofenceMap` desde siempre: sin llave, sin cuenta y
  sin costo. `LeafletAdminMap`, `LeafletSectoresMap` y `LeafletPilotMap`
- Para un autódromo el satélite además es mejor que el callejero: se ve el
  asfalto real, que es justo lo que se necesita al dibujar el trazado o al
  revisar que la geocerca cubra todo el ancho de pista

### Detalle
- **Esri pide la ruta como `{z}/{y}/{x}`**, con la Y antes que la X, al revés de
  la convención habitual. Invertirlo no da error: trae imagen de otro punto del
  planeta. Verificado calculando el tile de las coordenadas del circuito
- Los contenedores llevan fondo `#0a0a0a`, igual que los otros dos mapas: el gris
  claro por defecto de Leaflet se notaba como un parpadeo bajo los tiles oscuros
- Pendiente para antes de publicar en las tiendas: los cinco mapas ocultan la
  atribución con `display:none`, y tanto Esri como OpenStreetMap la exigen en sus
  términos

---

## [0.29.0] — 10 Agosto 2026
### Agregado (La pantalla del piloto cambia según el tipo de tanda)
- **Entrenamiento y clasificación usan otra lógica**, no una variante de la de
  carrera. En carrera el orden sale de la distancia total recorrida, porque
  todos largaron juntos. En entrenamiento eso no significa nada: cada uno entró
  a pista cuando quiso y lleva vueltas distintas, así que el orden es
  **circular por posición en pista** — quién tengo físicamente delante y detrás,
  sin importar su vuelta ni su categoría
- **La posición es dentro de SU categoría.** En carrera, por orden de carrera;
  en entrenamiento y clasificación, por mejor vuelta. Un piloto de una categoría
  más rápida ya no empuja a otro hacia abajo en la tabla
- Sin tiempo marcado todavía, o sin categoría asignada, la pantalla muestra
  `Pos. --`
- **La bandera azul solo existe en carrera.** En entrenamiento nadie está
  doblando a nadie

### Detalle
- El piloto sin categoría no tiene posición ni diferencias, pero **sí participa
  de la bandera azul** (es seguridad, no clasificación) y **sigue contando como
  referencia** para los gaps de los demás: si se lo excluyera, el gap de quien
  lo tiene delante saltaría al auto siguiente y no coincidiría con lo que ve por
  el parabrisas
- Verificado replayando el Entrenamiento 1 del 9 ago: con dos autos en pista los
  números salen espejados (uno ve +42,7 s adelante y el otro −42,7 s atrás) y no
  se enciende ninguna bandera azul

---

## [0.28.0] — 10 Agosto 2026
### Agregado (Categorías de pilotos — base para separar la clasificación)
- **Categorías** (migración: `docs/task-categorias-migration.sql`). Sección
  nueva en la pestaña Pilotos, plegada por defecto: se crean, renombran y
  eliminan categorías, y se asigna a cada piloto registrado la suya
- Un piloto sin categoría queda en **lista de espera**: sale a pista con
  normalidad y su perfil sigue funcionando para banderas y seguridad, pero no
  tendrá posición ni diferencias con otros autos. El panel lo avisa
- Al eliminar una categoría, sus pilotos vuelven a la lista de espera
- **Columna CAT.** en la tabla de Crono. La tabla NO se separa por categoría:
  solo aclara a cuál pertenece cada piloto
- **La descarga se puede filtrar por categoría.** El archivo sale con la
  categoría en el nombre y en el encabezado; sin filtro salen todas

### Nota de diseño
- La categoría vive en el piloto, no en la inscripción: se asigna una vez y
  vale para todos los eventos
- Pendiente en los pasos siguientes: separar la lógica por tipo de tanda
  (entrenamiento/clasificación vs carrera) y calcular la posición dentro de la
  categoría

---

## [0.27.0] — 10 Agosto 2026
### Corregido
- **Con un solo auto en pista no aparecía nada** en la pantalla de conducción:
  ni posición, ni vuelta, ni diferencias. El panel exigía dos pilotos para emitir
  el estado de carrera. Ahora emite con uno: la posición y la vuelta son datos
  válidos aunque no haya con quién compararse
- Se bloquea la selección de texto en la pantalla de conducción. Al mantener
  presionado para salir, iOS abría el selector con la lupa encima del pizarrón
- Con bandera verde ya no se muestran el tilde ni "Circulación normal
  habilitada": el color verde ya dice que la pista está habilitada. En las demás
  banderas el texto es información de seguridad y se mantiene

### Cambiado
- Se corrigió el lenguaje de la app a **español neutro**, sin voseo: "mantén
  presionado", "si lo dibujas"

---

## [0.26.0] — 10 Agosto 2026
### Cambiado (Modo conducción — se elimina la detección de orientación)
- **El pizarrón se abre con un botón, ya no girando el teléfono.** Se eliminó la
  detección de orientación por completo: el acelerómetro no distingue la
  gravedad de la fuerza lateral, así que en curva el teléfono "creía" que lo
  habían girado y la vista se caía en el peor momento
- Dentro del modo conducción el pizarrón se dibuja **apaisado dentro de la
  pantalla vertical**. El piloto gira el teléfono y lo ve derecho, sin que el
  sistema tenga que rotar nada. El sistema de giro no se usa en ningún momento
- Botón "⛶ PISTA" en la vista del piloto. Para salir, mantener presionado 1,5 s

### Corregido
- **La rotación salía cortada** (reportado con foto). La causa: el cambio previo
  que pasó las medidas a variables CSS alcanzó también a las que posicionaban el
  contenedor, y `left`, `width` y `height` quedaron intercambiados entre sí — el
  pizarrón terminaba fuera de pantalla
- Ahora la pantalla se mide en **píxeles** y la rotación es alrededor del centro,
  sin aritmética de esquinas. Si la orientación llega a cambiar igual, se decide
  midiendo y no preguntándole al sensor, así que no puede desincronizarse

---

## [0.25.0] — 10 Agosto 2026
### Corregido (Modo conducción — la pantalla se daba vuelta en las curvas)
- **El pizarrón ya no depende de la orientación del teléfono.** En curva la
  fuerza lateral engaña al acelerómetro —no distingue la gravedad de la
  aceleración lateral— y iOS gira la pantalla solo, tirando abajo la vista de
  conducción en el peor momento. Ahora un toque la **fija**, y desde ahí la
  orientación deja de mandar
- Si el teléfono igual gira, el contenido se **rota por CSS**: el piloto sigue
  viendo lo mismo, sin importar qué crea el sensor. En iOS no existe forma de
  bloquear la orientación desde la web, así que se compensa en vez de pelearla
- Para salir hay que **mantener presionado 1,5 s**. Con el auto en pista los
  toques accidentales sobran, y salirse del pizarrón a 130 km/h por un golpe
  sería peor que no tener el modo
- El modo fijo sobrevive a una recarga (iOS puede reiniciar la app sola a mitad
  de tanda) pero se suelta al salir del evento, para que nadie quede atrapado

### Detalle técnico
- Dentro del contenedor rotado, `vw` y `vh` siguen apuntando al viewport real,
  así que todos los tamaños salían intercambiados. Se pasaron a variables
  propias que el contenedor intercambia una sola vez al rotar (17 usos)

---

## [0.24.0] — 10 Agosto 2026
### Agregado
- **Cada piloto congela su dato al cruzar su meta.** La carrera termina cuando
  cruza el primero, pero los demás siguen girando hasta pasar por meta: a cada
  uno se le congela lo suyo en SU cruce, mostrando con qué diferencia terminó en
  vez de vaciarse la pantalla. Arriba a la derecha aparece "FINAL" en lugar de
  la vuelta, para que no se lea como un número vivo que dejó de moverse
- La bandera azul se apaga al congelar: ya no tiene sentido

### Corregido
- La flecha se calcula sobre el número REDONDEADO que se exhibe, no sobre el
  valor crudo. Antes usaba un umbral fijo de 0,08 s, que podía mover la flecha
  sin que el número cambiara y viceversa. Ahora las dos cosas van juntas

---

## [0.23.0] — 10 Agosto 2026
### Agregado (Gaps en la pantalla del piloto y bandera azul automática)
- **El panel calcula y reparte.** Es el único que conoce la clasificación
  completa, así que resuelve quién va adelante y quién atrás de cada piloto y lo
  emite a 1 Hz. El admin **no ve estos números** — su vista actual le alcanza —,
  solo los calcula. Va un único mensaje por segundo con el estado de todos, así
  el costo no crece con la cantidad de autos
- **Pantalla del piloto** siguiendo el diseño de Felipe: posición en carrera
  arriba a la izquierda, vuelta arriba a la derecha, y las dos diferencias en
  las esquinas inferiores, cada una con su flecha de tendencia
- **Flecha y color dicen cosas distintas.** La flecha es el hecho físico y es
  igual en los dos lados: ▼ me acerco, ▲ me alejo. El color dice si eso conviene,
  y ahí sí se invierte — acercarme al de adelante es verde, que el de atrás se me
  acerque es rojo. El signo del número no participa: `+` es la etiqueta del
  piloto de adelante y `−` la del de atrás
- La tendencia tiene memoria: si la variación no supera un umbral se conserva la
  flecha anterior, para que no titile a 1 Hz
- **La bandera azul se enciende y se apaga sola.** Entra por debajo de la
  bandera personal en la jerarquía: si el director pone una a mano, esa manda.
  Se apaga cuando el adelantamiento se consumó, no cuando el gap creció

### Corregido en el motor, encontrado replayando
- La bandera se apagaba con **cualquier** auto que sacara una vuelta, no con el
  que la había encendido. Ahora el release es por piloto
- Un auto ya adelantado podía volver a encender la bandera: se lo descarta antes
  de evaluarla, y queda bloqueado un rato para que el ruido del GPS no la
  reactive en el momento del cruce
- Con las tres correcciones el replay de la Carrera 2 arroja **una sola bandera
  azul, continua**: pac por fac, de 18:04:04 a 18:04:49, encendida al entrar en
  los 5 s y apagada exactamente cuando lo pasa

---

## [0.22.0] — 10 Agosto 2026
### Agregado (Cálculo de gaps y bandera azul — motor, todavía sin conectar)
- `lib/gaps.ts`: diferencia de tiempo entre pilotos y detección de bandera azul.
  El gap no se calcula restando posiciones sino preguntando "¿hace cuánto que el
  de adelante pasó por el punto donde estoy yo ahora?", interpolando sobre el
  historial del otro piloto
- Reglas implementadas tal como las definió Felipe: los gaps se muestran **solo
  entre competidores de la misma vuelta** (un doblado no es rival del puntero);
  la bandera azul es la única excepción y viaja en un solo sentido — la ve
  únicamente el más lento; quien está en boxes sale del cálculo y al reingresar
  vuelve a participar
- Histéresis para la bandera azul: tolera huecos cortos de señal y garantiza una
  duración mínima en pantalla. Una bandera que titila es peor que no tenerla

### Validado replayando la Carrera 2 completa (969 s, 4 pilotos)
- Detecta correctamente que **pac fue doblado por fac** — el par real — con la
  bandera encendida 49 s mientras fac se le acercaba de 5 s a 1,2 s
- Detecta la segunda aproximación de fac cerca del final, que la carrera cortó
- Las vueltas finales del replay coinciden con el resultado real de la carrera
- Consistencia interna: el "atrás" de un piloto coincide con el "adelante" del
  que lo sigue
- El replay destapó un parpadeo de la bandera (5 tramos cortados en vez de 2);
  se corrigió antes de dar por bueno el módulo

---

## [0.21.0] — 10 Agosto 2026
### Agregado (Transporte de posiciones en vivo — base para los gaps)
- **Posiciones por Realtime broadcast a 1 Hz** (`lib/posiciones.ts`). La única
  fuente eran las escrituras a `ubicaciones_piloto` cada 3 s: suficiente para el
  semáforo de "en pista / boxes", pero no para diferencias de tiempo — 3 s de
  atraso son ~110 m a velocidad de carrera. Broadcast es efímero (no escribe una
  fila por mensaje) y va directo por el socket ya abierto
- Cada teléfono emite su posición proyectada sobre el trazado, velocidad,
  vueltas y estado de pista, con la hora ya pasada a escala de servidor
- **Medido contra el Supabase real**: 10 de 10 mensajes entregados, latencia
  media 104 ms (mín. 70, máx. 308). Antes: hasta 3 s
- La escritura cada 3 s se mantiene sin cambios, como registro histórico y como
  respaldo: si el canal de broadcast de un teléfono no abre, el panel vuelve a
  usar la tabla solo, a los 4 s de silencio
- El panel ahora usa el progreso de vuelta que el teléfono ya calculó con
  proyección sobre segmento, en vez de recalcularlo redondeando al punto más
  cercano

---

## [0.20.0] — 10 Agosto 2026
### Corregido (Precisión — base para los gaps entre pilotos)
- **Proyección sobre el segmento del trazado** (`lib/trazado.ts`). La posición
  del auto se resolvía saltando al punto más cercano del trazado: con 84 puntos
  en 2550 m, bloques de 30 m, y a 135 km/h casi 0,8 s de incertidumbre. Ahora se
  proyecta sobre el segmento entre dos puntos, así que la distancia recorrida es
  continua y no depende de cuántos puntos tenga el trazado dibujado
- **Medido contra MyLaps** replayando la Carrera 2 completa (mismo piloto, mismas
  10 vueltas, dato externo de transponder):

  | | Por punto | Por segmento |
  |---|---|---|
  | Error medio | 0,240 s | **0,014 s** |
  | Error máximo | 0,475 s | **0,037 s** |
  | Desviación | 0,299 s | **0,017 s** |

- **El desfase de reloj ya se aplica.** Se medía y guardaba desde 0.14.0 pero no
  se usaba. Cada cruce se marca con el reloj del teléfono de su piloto, y esos
  relojes no coinciden — la diferencia contra el líder arrastraba el desfase
  entero. Sobre las carreras del 9 ago la corrección mueve las diferencias hasta
  0,607 s. Los tiempos de vuelta NO se corrigen: son restas dentro del mismo
  aparato y el error del reloj ya se cancela solo
- El corredor de 45 m de la meta ahora usa la distancia perpendicular real al
  eje de pista, no la distancia al punto más cercano

---

## [0.19.0] — 10 Agosto 2026
### Agregado (Revisión de resultados)
- **Vuelta a vuelta por piloto en Crono**: tocando la fila de un piloto se
  despliega su lista de vueltas — número, tiempo, diferencia contra su propia
  mejor y hora del día — con la mejor vuelta destacada. Funciona sobre cualquier
  tanda de la fecha usando el selector que ya existía
- **La descarga pasa de CSV a .xlsx con dos hojas**: "Resultado" (la tabla
  oficial tal cual se ve en pantalla) y "Vuelta a vuelta" (un bloque por piloto
  con todas sus vueltas, con el formato de las planillas de cronometraje)
- Ambas vistas respetan la marca de largada: la vuelta de formación no aparece
  y las de carrera van numeradas desde 1

### Detalle técnico
- `lib/xlsx.ts`: escritor mínimo de .xlsx (ZIP + XML) escrito a mano para no
  sumar una librería de ~1 MB al panel. Solo texto y números, sin formato.
  Validado generando un archivo real de la Carrera 2 y abriéndolo con openpyxl

---

## [0.18.0] — 9 Agosto 2026
### Agregado
- **Botón "🟢 Largada" y vuelta de formación fuera de la tabla** (migración:
  `docs/task-largada-migration.sql`). El protocolo real es: los autos salen de
  boxes detrás del pace car, dan una vuelta de formación y la carrera larga en
  el SEGUNDO paso por meta. Esas pasadas se contaban como vueltas de carrera, y
  había que compensarlo configurando una vuelta de más (11 programadas para una
  carrera de 10). Ahora el director marca la largada y el sistema sabe cuáles
  son de formación: se ocultan de la tabla y las de carrera se renumeran desde 1
- Se puede configurar la **distancia real** de la carrera (10, no 11)
- No hace falta apretar el botón en el instante exacto: el pelotón viene
  apiñado detrás del pace car (en la Carrera 2 los cuatro autos cruzaron dentro
  de 2 s, contra 13-18 s de dispersión en vuelta normal), así que se descarta
  todo cruce dentro de 10 s de la marca. Como la vuelta mínima válida son 40 s,
  ese margen no puede confundirse con una vuelta real
- Sirve igual para relargadas tras bandera roja o safety car, que un contador
  fijo de vueltas previas no podría expresar

### Detalle
- La regla vive en `lib/carrera.ts` y la usan los cuatro lugares que deciden el
  fin de carrera: el detector del teléfono, la vigilancia del líder, el
  auto-cierre del panel y la tabla de Crono
- **Retrocompatible por diseño**: con `largada_at` en NULL el comportamiento es
  idéntico al anterior en los cuatro. Es opcional carrera por carrera
- Verificado sobre las vueltas reales de la Carrera 2: los tres que terminaron
  pasan de 11 a 10 vueltas y el rezagado de 10 a 9, con las mejores vueltas
  intactas. Desaparece la vuelta de formación de 124 s

---

## [0.17.0] — 9 Agosto 2026
### Corregido (Cronometraje — las dos fallas de la Carrera 1)
- **El detector de cruces ya no depende de la geocerca.** Antes exigía estar
  dentro del polígono y, si no, además BORRABA la memoria de dónde venía el
  auto — así que un pellizco del polígono cerca de meta borraba el cruce
  entero. Medido sobre la traza: la geocerca se angosta en la recta de meta
  (el anillo llega a pasar a 13 m del eje) y los 272 puntos rechazados están
  todos en el tramo 90-100% y 0-10% de la vuelta. Contar vueltas no puede
  depender de con cuánto cuidado se dibujó un polígono: ahora se exige ir
  dentro de un corredor de 45 m alrededor del TRAZADO. La geocerca sigue
  mandando en "en pista / boxes", que es para lo que sirve
- **El cruce se detecta por retroceso del progreso**, no por una ventana fija.
  Antes exigía ver una lectura después del 88% Y otra antes del 12%; si el GPS
  se salteaba justo esa ventana, la vuelta se perdía. Ahora pregunta si el
  progreso retrocedió más de media vuelta, que aguanta lecturas perdidas
- Verificado reproduciendo la carrera completa sobre las 3257 lecturas reales:
  el piloto que había contado 6 de 9 vueltas cuenta 9; el que contaba bien
  sigue igual (sin regresión). El tercero sigue perdiendo 1 porque ocurrió
  dentro de un apagón de GPS de 124 s — ahí no hay dato que recuperar

### Agregado
- Aviso ⚠ en la tabla de Crono cuando un piloto tiene vueltas anormalmente
  largas (2,2× su propia mejor, sin contar la de largada): señal de que se le
  perdió un cruce y su conteo puede estar corto. Calibrado contra la carrera
  del 9 ago: detecta el apagón de GPS sin marcar al que giró lento en la
  largada

---

## [0.16.0] — 9 Agosto 2026
### Agregado
- **Geocercas de varios anillos: islas y agujeros.** La geocerca de pista es un
  ANILLO, y un anillo no se puede dibujar con un solo polígono sin hacerle un
  corte que una el borde exterior con el interior. Ese corte estaba puesto en la
  meta, y los autos que pasaban justo por ahí quedaban clasificados "fuera de
  pista" — lo que hacía perder cruces. Ahora una geocerca puede tener varios
  anillos y no hace falta cortar nada
- Botón "＋ Cerrar anillo y empezar otro" en los dos editores de mapa (el de
  Config y el de Circuitos). Un anillo dibujado DENTRO de otro queda como
  agujero; uno separado, como isla
- Sin migración: `coordenadas` acepta el formato antiguo (un polígono) y el
  nuevo (lista de anillos). Al guardar un solo anillo se sigue escribiendo
  plano, así que nada de lo existente cambia de forma

### Detalle técnico
- `puntoEnGeocerca` ya usaba ray-casting par-impar. Aplicando el mismo conteo a
  todos los anillos de una vez, islas (unión) y agujeros salen sin una línea de
  lógica extra — Leaflet dibuja con esa misma regla, así que el mapa coincide
  con el cálculo
- `geocercaDefinida()` reemplaza a los viejos `.length >= 3`, que con dos
  anillos habrían dado 2 y dejado la geocerca por "no configurada"
- Verificado contra los 3257 puntos GPS reales de la Carrera 1 del 9 ago:
  **cero diferencias** de clasificación respecto de la implementación anterior

---

## [0.15.0] — 8 Agosto 2026
### Agregado
- **Inscripción libre por fecha — provisorio, marcha blanca** (migración:
  `docs/task-inscripcion-libre-migration.sql`): interruptor en el formulario de
  la fecha, debajo de Estado. Con él encendido el piloto entra al evento apenas
  aprieta "Inscribirme", sin aprobación del admin ni pago. Badge ámbar en la
  lista de fechas del admin y en la tarjeta del piloto para que nunca quede duda
  de qué fechas están abiertas así
- No reemplaza nada: el flujo normal (solicitado → inscrito → pago → confirmado)
  queda intacto y es lo que corre con el interruptor apagado. Se revierte
  desmarcándolo. El pago queda registrado como "pendiente" a propósito — nadie
  pagó, y el panel debe seguir mostrándolo así
- Al encenderlo también se destraba a quien ya tenía una solicitud pendiente de
  antes, sin tener que corregir filas a mano. Los rechazados siguen rechazados
- **No saltea la prueba de conocimientos** del campeonato, ni reemplaza el
  escaneo de QR con que el admin abre la sesión en pista

---

## [0.14.0] — 7 Agosto 2026
### Agregado (Cronometraje — instrumentación para validar)
- Traza GPS cruda (migración: `docs/task-traza-gps-migration.sql`): el teléfono
  guarda CADA lectura del GPS (~1 Hz) con lo que el detector calculó en ese
  instante — posición, precisión, velocidad, punto del trazado, progreso 0..1 y
  si la histéresis estaba armada. Se acumula en memoria y se vuelca en lotes
  cada 10 s; sin señal reintenta y conserva los últimos ~10 min. Solo graba en
  tanda o dentro de la geocerca de pista. Objetivo: reprocesar una tanda entera
  en el escritorio (otros umbrales, vueltas salteadas) sin volver al autódromo
- Desfase de reloj teléfono ↔ servidor (`lib/reloj.ts`, función SQL
  `hora_servidor()`): se mide al entrar y cada 5 min, al estilo NTP (5 muestras,
  se conserva la de menor ida-y-vuelta). Queda guardado en `vueltas.offset_ms` y
  en cada punto de la traza. **No se aplica en vivo**: `cruce_at` sigue siendo la
  hora del teléfono, para que la app se comporte igual que antes. Sin esto, los
  gaps entre dos pilotos arrastran el desfase entre sus relojes

### Corregido
- El Wake Lock no se recuperaba nunca tras una interrupción: iOS lo suelta cada
  vez que la página pierde el foco (alerta del sistema, llamada, Centro de
  Control), y solo se re-pedía en `visibilitychange`, que una alerta encima de
  la página no dispara. La pantalla quedaba libre de atenuarse hasta bloquearse
  — y con la pantalla bloqueada el detector de cruces deja de recibir GPS, así
  que también salteaba vueltas. Ahora se escucha el evento `release` del propio
  sentinel, se re-pide en `focus`/`pageshow`/`visibilitychange`, y un watchdog
  verifica cada 15 s que siga vivo
- Diálogo "Deshacer texto escrito" de iOS al agitar el teléfono (pendiente desde
  0.11.1): no existe API web para apagar el gesto, pero sí para dejar vacía la
  pila de deshacer de WebKit. Se vacía al entrar a la app y al cerrar cada
  edición del perfil, con los campos ya desmontados. Sin pasos de tecleo
  guardados, iOS no tiene qué ofrecer. Mitigación, no cura: el gesto se apaga
  del todo solo en Ajustes → Accesibilidad → Tocar → Agitar para deshacer

---

## [0.13.4] — 6 Julio 2026
### Agregado
- Tanda "Libre": sin duración ni reglas de término, para giros libres todo
  el día. Parte al tiro (sin configuración) y cuenta vueltas igual; solo
  termina cuando el director la finaliza
- Botón "⬇ Resultados" en Crono: descarga la tabla de posiciones de la
  tanda visible como CSV (pos, número, piloto, vueltas, diferencia,
  mejor, última, estado)
- Dirección muestra la tanda en curso: tipo con su color, reloj (restante
  o transcurrido) y "Vuelta L/N" en carrera, actualizado cada segundo

### Nota
- El auto-cierre reportado como fallido se debía a que la migración
  task-cronometraje-migration.sql no estaba corrida (sin la columna
  duracion_min la tanda se crea sin duración). Correrla lo habilita

---

## [0.13.3] — 6 Julio 2026
### Agregado
- Cierre automático de tandas: el panel vigila la tanda activa y, al
  cumplirse el tiempo (o las vueltas del líder en carrera), lanza la
  bandera a cuadros y finaliza la tanda solo. Finalizar a mano también
  lanza cuadros. El detector del piloto tiene ventana de gracia de 5 min
  tras el fin: la vuelta en curso se cierra, cuenta, y luego se detiene

---

## [0.13.2] — 6 Julio 2026
### Cambiado
- El Log de acciones ya no tiene controles de tanda: solo el desplegable
  junto al título y el CSV. Iniciar/finalizar tandas vive en Crono
  (mismo motor compartido; el log sigue reflejando y etiquetando todo)
- Carrera termina por TIEMPO o por VUELTAS, lo que ocurra primero: el
  detector del piloto cierra su participación en el siguiente cruce si
  se cumplió el tiempo, si él completó las vueltas programadas, o si el
  líder ya las completó (bandera de cuadros). Crono muestra "Carrera
  completada — finaliza la tanda" y "Tiempo cumplido — últimas vueltas
  en curso" según corresponda

---

## [0.13.1] — 6 Julio 2026
### Agregado (Cronometraje — Etapa 2 de 3)
- Pestaña "Crono" en el panel (Racing, Track Day y Entrenamiento): tabla de
  posiciones en vivo estilo torre de cronometraje. Entrenamiento/Clasificación
  ordena por mejor tiempo; Carrera por vueltas completadas + progreso GPS en
  la vuelta, con "Vuelta L/N" del líder y diferencias con el líder (tiempo o
  vueltas). Cabecera con estado de tanda, reloj (restante o transcurrido),
  mejor vuelta absoluta y última vuelta. Selector para revisar tandas
  anteriores de la fecha. Estados por piloto: En pista / Boxes / Sin señal /
  Sin vuelta / Finalizado (cruzó tras el límite de tiempo)

---

## [0.13.0] — 6 Julio 2026
### Agregado (Cronometraje — Etapa 1 de 3)
- Tabla `vueltas` + config de cronometraje (migración:
  `docs/task-cronometraje-migration.sql`): duración por tanda, vueltas
  programadas (carrera), meta congelada por tanda, meta y vuelta mínima
  configurables por circuito
- Iniciar tanda ahora pide duración en minutos (y vueltas si es carrera)
- Detector de cruces de meta EN el teléfono del piloto (GPS a ~1 Hz):
  progreso circular sobre el trazado con histéresis (armar al 40-70%,
  cruce 88%→12%), instante interpolado entre lecturas, vuelta mínima
  válida, solo dentro de la geocerca de pista. Primera pasada = vuelta
  de salida sin tiempo. Cumplido el tiempo de tanda, el cruce siguiente
  cierra la participación del piloto (esa última vuelta SÍ vale)
- Pendiente Etapa 2: pestaña Cronometraje con tabla de posiciones en vivo

---

## [0.12.2] — 6 Julio 2026
### Cambiado
- El recinto desaparece como estado visible: para admin y piloto solo
  existen "En pista" y "Boxes" (+ Sin señal/Sin GPS en el admin). El dato
  dentro_recinto se sigue registrando internamente como constancia de que
  el piloto asistió a la fecha, pero ninguna vista lo distingue. El log de
  salida queda como "salió de pista — en boxes"

---

## [0.12.1] — 6 Julio 2026
### Agregado
- Log de entradas y salidas de pista: "entró a pista", "salió de pista —
  entró a boxes", "salió de pista — salió del recinto", "perdió señal —
  última posición: en pista" (una sola vez por corte) y "recuperó señal
  en pista". Detectado por el panel desde las transiciones de geocerca
  del GPS; quedan etiquetados con la tanda en curso

### Cambiado
- "En recinto" → "Boxes" en la app del piloto (semáforo GPS y header),
  panel admin (estado del piloto) y mapa de Dirección (marcador gris)

---

## [0.12.0] — 5 Julio 2026
### Agregado
- Tandas por fecha (tabla `tandas`, migración: `docs/task-tandas-migration.sql`):
  desde el log de acciones el director inicia una tanda (Entrenamiento /
  Clasificación / Carrera, autonumeradas) y la finaliza al terminar. Todo lo
  que se registra mientras está en curso queda etiquetado con esa tanda
  (incluidas las amarillas automáticas). Selector en el log para ver toda la
  fecha o solo una tanda, y la descarga CSV respeta la selección con el
  nombre de la tanda en el archivo

---

## [0.11.2] — 5 Julio 2026
### Corregido
- Bug de zona horaria: "hoy" se calculaba en UTC, así que desde las 20:00
  de Chile (medianoche UTC) la fecha del día quedaba "vencida" — la
  auto-finalización la re-finalizaba al instante (imposible reabrir
  inscripciones), desaparecía del selector del header y de la portada
  "Fechas de hoy", y la vigencia diaria de la prueba fallaba. Ahora los
  5 cálculos de "hoy" usan la fecha local del dispositivo

---

## [0.11.1] — 5 Julio 2026
### Revertido
- Se revirtió la recarga de página al "Entrar al evento" (0.10.4): tras
  ese cambio la pantalla volvió a atenuarse en pista. La entrada al
  evento es directa de nuevo, como antes. Consecuencia conocida: el
  diálogo "Deshacer texto escrito" de iOS puede reaparecer con las
  vibraciones — pendiente buscar otra solución

---

## [0.11.0] — 5 Julio 2026
### Corregido
- Las estadísticas de experiencia no acumulaban nada: el historial solo se
  cosechaba al presionar "Retirar", y las sesiones de prueba nunca se
  cerraban. Ahora la app del piloto acumula EN VIVO (odómetro): km,
  minutos y velocidad máxima se guardan en historial_pista cada ~30 s
  durante la sesión, sin depender del cierre. Si la app se recarga a
  mitad de tanda, retoma lo ya acumulado de esa sesión
- La cosecha al cerrar sesión queda como respaldo y ya no infla los
  minutos de sesiones zombie (usa el último GPS real, no el reloj)

---

## [0.10.3] — 5 Julio 2026
### Revertido
- Todos los intentos de fallback de pantalla encendida (nosleep.js,
  wake.mp4 con audio, indicador de diagnóstico, video en iOS): la app
  vuelve a usar solo la API Wake Lock nativa, como antes. Hallazgo
  documentado: el apagado a los ~30 s en el teléfono de prueba lo causa
  el Modo de bajo consumo de iOS, que fuerza el bloqueo a 30 segundos
  por sobre la API Wake Lock y cualquier video web — no hay técnica web
  que lo evite; solo desactivar ese modo en el teléfono

---

## [0.10.2] — 4 Julio 2026
### Agregado
- Número de competición del piloto (hasta 3 caracteres, `pilotos.numero`,
  migración: `docs/task-numero-piloto-migration.sql`): se edita tocando el
  círculo en el resumen del piloto; vacío = vuelve a las iniciales. Se
  refleja en los avatares de Pilotos y en "Pilotos en sesión" de Dirección

### Corregido
- Contador "En pista" de la pestaña Pilotos ahora usa el estado GPS real
  (sesiones zombie sin señal ya no cuentan)

---

## [0.10.1] — 4 Julio 2026
### Agregado
- Panel admin, pestaña Pilotos: clic en el nombre de cualquier piloto abre
  un resumen con su experiencia (XP y nivel, eventos, minutos, km, velocidad
  máxima e historial por auto) — misma fórmula y datos que ve el piloto

---

## [0.10.0] — 4 Julio 2026
### Cambiado
- Perfil y Reglas disponibles apenas se abre la app (barra inferior en la
  pantalla de eventos), sin necesidad de entrar a un evento
- La prueba de conocimientos ahora es POR CAMPEONATO y se rinde al ENTRAR
  a un evento de ese campeonato por primera vez (no al registrarse). Tras
  aprobar, continúa automáticamente al evento al que iba el piloto
- Tabla `pruebas_piloto` (migración: `docs/task-prueba-por-campeonato-migration.sql`)
- Login y registro van directo a la lista de eventos

---

## [0.9.0] — 4 Julio 2026
### Agregado
- Perfil del piloto rediseñado: correo y teléfono editables (RUT fijo, una
  cuenta por correo), autos del piloto (agregar varios, elegir auto activo o
  ninguno), estadísticas permanentes (eventos, minutos, km, velocidad máxima),
  experiencia total con nivel (XP = eventos×100 + minutos + km, 500 XP por
  nivel) e historial de km/minutos por auto
- Tabla `historial_pista` + `pilotos.vehiculo_activo_id` (migración:
  `docs/task-perfil-historial-migration.sql`)
- Al cerrar cada sesión (Retirar), se cosechan minutos, km recorridos
  (Haversine sobre el GPS, filtrando saltos >300 m) y velocidad máxima,
  asignados al auto activo del piloto o solo al piloto si no tiene
- `distanciaRecorridaKm()` en lib/gps.ts
- Cambio de correo via Supabase Auth (envía confirmación al correo nuevo)

---

## [0.8.1] — 3 Julio 2026
### Cambiado
- Safety Car: el circuito completo se pinta amarillo en el modo conducción
- Negra y cuadros (circuito blanco): los sectores amarillos siguen visibles
  como advertencia; solo la roja domina todo el trazado
- El director mantiene el control por sector con Safety Car o cuadros
  activos (antes el panel lo bloqueaba como "override global"; ahora solo
  roja y amarilla global bloquean)
- Mapas admin y piloto (vertical): mismos criterios — sectores con bandera
  propia visibles bajo SC/cuadros

---

## [0.8.0] — 3 Julio 2026
### Cambiado
- Rediseño 100% visual del modo conducción (vista horizontal del piloto):
  el color de la bandera domina toda la pantalla, el circuito flota como SVG
  grueso con sombra al centro, y abajo va solo icono + texto sin cajas.
  Fondos por bandera: verde/amarillo/rojo/azul sólidos, negra (circuito
  blanco), advertencia (diagonal blanco/negro), taller (círculo naranjo
  sobre negro), cuadros (ajedrez plano), rayas (franjas verticales
  amarillo/rojo). Los sectores siguen pintándose sobre el circuito.
  Sin cambios de lógica: misma jerarquía de banderas, mismos datos,
  solo se reemplazó la capa de presentación (LeafletPilotMap 70% + panel
  30% → PizarraLandscape)

---

## [0.7.1] — 3 Julio 2026
### Corregido
- Letras casi invisibles en teléfonos con modo oscuro: la plantilla de Next.js
  invertía el color de texto base con prefers-color-scheme y quedaba blanco
  sobre las tarjetas blancas. Eliminado el bloque + `color-scheme: light` +
  base de contraste para inputs/placeholders con `:where()` (no pisa los
  estilos oscuros del panel admin)

### Cambiado
- Marca genérica "Autódromo App" en título, header del piloto y manifest PWA
  (antes decía "Autódromo Las Vizcachas" fijo — es solo una pista más de las
  que puede operar la app). La lista de autódromos del formulario de eventos
  no cambia: ahí Las Vizcachas es una opción de dato, no marca
- Etiquetas de formularios de login/registro más oscuras (gray-700)

---

## [0.7.0] — 3 Julio 2026
### Agregado
- Log de acciones real y persistente (tabla `log_acciones`, migración:
  `docs/task-log-acciones-migration.sql`). Registra: banderas globales,
  banderas por sector (director), amarillas automáticas (activación y
  reversión), banderas personales por piloto (asignar/quitar), ingresos
  por QR y retiros de pista
- Log en vivo en Dirección (Realtime + polling de respaldo), separado por
  evento, con hora exacta de cada acción
- Botón "⬇ Descargar CSV": resumen completo de la tanda, abre en Excel

---

## [0.6.1] — 3 Julio 2026
### Corregido
- El piloto veía una pista distinta a la del evento: la asociación
  fecha→circuito vivía solo en localStorage del navegador del admin.
  Ahora se persiste en la DB (`fechas_evento.circuito_id`, migración:
  `docs/task-circuito-por-fecha-migration.sql`) y la app del piloto carga
  trazado y geocercas del circuito de SU evento, con fallback al global
- El admin resuelve el circuito de la fecha desde la DB primero
  (localStorage queda como respaldo legado)

---

## [0.6.0] — 3 Julio 2026
### Agregado
- Banderas personales desde "Pilotos en sesión" (Dirección): clic en el nombre
  del piloto despliega el menú de banderas que solo ve ese piloto (azul,
  advertencia, negra, a taller — según tipo de sesión). Toggle: otro clic la
  quita. Persisten en sesiones.bandera_piloto; el piloto la ve al instante
  con prioridad sobre sector/global y el badge "DIRIGIDA A TI"
- Indicador de bandera personal activa junto al nombre del piloto en la lista

---

## [0.5.8] — 2 Julio 2026
### Agregado
- Migas de navegación en el header del panel: "🏠 Eventos › campeonato › fecha".
  Eventos vuelve al menú inicial (limpia contexto), el campeonato vuelve a la
  lista de fechas, la fecha entra a su panel de operación
- El nombre de la fecha es el link para entrar a operarla (setea el contexto
  completo y salta a Dirección); el nombre del campeonato abre sus fechas.
  Fechas finalizadas quedan como texto plano (no operables)
- Los menús desplegables del header siguen disponibles como alternativa

---

## [0.5.7] — 2 Julio 2026
### Cambiado
- "Pista habilitada — X de N cupos" y "Capacidad de pista X/N" ahora cuentan
  las sesiones del evento seleccionado (antes contaban todas las sesiones
  activas del sistema, incluidas las de otras fechas)
- Badge "Activo" en la biblioteca de circuitos: solo el circuito asignado al
  evento actual (el activo global ya no se muestra dentro de un evento)
- Los bloqueos del escáner QR siguen usando el conteo global a propósito:
  reflejan la validación real de capacidad en auth.ts

---

## [0.5.6] — 2 Julio 2026
### Corregido
- Más fugas de "fecha nueva sucia" (complemento de 0.5.5):
  - "Control por sector" del panel mostraba los sectores globales aunque el
    evento no tuviera circuito; ahora muestra "Sin circuito asignado a este evento"
  - DireccionCarrera también limpia los sectores (no solo el trazado) cuando
    el evento no tiene circuito
  - Config/Biblioteca de circuitos: aviso ámbar cuando el evento no tiene
    circuito asignado + insignia "Este evento" en el circuito asignado

---

## [0.5.5] — 2 Julio 2026
### Corregido
- Fecha nueva partía "sucia" con la pista y los pilotos de la última fecha:
  - Dirección y SectoresEditor caían al trazado global cuando el evento no
    tenía circuito asignado; ahora muestran vista limpia con guía para asignar
    circuito en Config
  - El sidebar "Pilotos en sesión" y el log de acciones mostraban sesiones de
    cualquier evento; ahora filtran por los inscritos de la fecha activa
- Los contadores de CAPACIDAD siguen siendo globales a propósito: reflejan los
  autos físicamente en pista, igual que la validación real del QR

---

## [0.5.4] — 2 Julio 2026
### Corregido
- Las solicitudes de inscripción nuevas no aparecían en la pestaña Pilotos del
  admin hasta refrescar la página: el panel nunca se suscribía a `inscripciones`.
  Ahora: Realtime filtrado por el evento activo + polling de respaldo cada 10 s,
  con recarga silenciosa (sin spinner)

---

## [0.5.3] — 2 Julio 2026
### Agregado
- El límite N|1 (último sector → primero, la línea de meta) ahora es editable
  igual que el resto: fila de botones en la lista y marcador arrastrable en el
  mapa del editor
- Sectores pueden "cruzar la meta": se guardan con `punto_inicio > punto_fin`
- Helpers `sectorContienePunto` / `sectorSlice` / `sectorLargo` en `lib/gps.ts`,
  usados por TODOS los consumidores de sectores (mapas admin/piloto, detección
  de sector del piloto, auto-yellow, editor). Al trabajar con rangos de sector,
  usar siempre estos helpers.

---

## [0.5.2] — 2 Julio 2026
### Corregido
- Estado GPS del piloto inconsistente entre vistas: el piloto veía "Fuera del
  recinto" pero el admin mostraba "En recinto" (Dirección) y "En pista" (Pilotos).
  Causa: solo se enviaba `dentro_geocerca` (pista); el estado del recinto nunca
  llegaba a la DB, y la pestaña Pilotos mostraba "En pista" por el solo hecho de
  tener sesión activa.

### Agregado
- Columna `ubicaciones_piloto.dentro_recinto` (migración: `docs/task-gps-recinto-migration.sql`)
- El piloto ahora envía su estado completo (pista + recinto) cada 3 s
- Helper único `estadoGpsPiloto()` en el panel admin: mismas etiquetas y lógica
  que la app del piloto (En pista / En recinto / Fuera del recinto / Sin señal)
  usado en Dirección y en la pestaña Pilotos
- Marcador gris del mapa admin distingue RECINTO / FUERA (antes siempre "BOXES")
- `registrarUbicacion` con fallback: si la migración no se ha corrido, reintenta
  sin la columna nueva para no perder ubicaciones

### Sin cambios (por diseño)
- Piloto sin señal cuya última posición confirmada fue EN PISTA: sigue visible
  en el mapa con marcador rojo "SIN SEÑAL" en su última ubicación conocida

---

## [0.5.1] — 2 Julio 2026
### Cambiado
- Editor de sectores (mapa): eliminados los rectángulos de texto "SECTOR N" que
  tapaban el trazado; quedan solo los círculos bicolor con números de límite
- Editor de sectores (lista): cada fila de botones ahora indica qué límite mueve
  (ej. "1|2", igual que el círculo del mapa) y el último sector muestra una fila
  informativa "N|1 — línea de largada/meta" explicando que ese punto es fijo
- Mapa del editor con `isolation: isolate` para que no se dibuje sobre el header
  del panel al hacer scroll

---

## [0.5.0] — 2 Julio 2026
### Agregado
- Flujo de permiso de ubicación en la app del piloto: overlay al entrar a la vista
  de pista que pide compartir GPS con un botón (gesto del usuario — confiable en iOS)
- Detección del estado del permiso via `navigator.permissions.query` + listener de cambios
- Pantalla de recuperación cuando el permiso quedó denegado, con instrucciones
  paso a paso para Safari/iPhone y Chrome/Android + botón reintentar
- Fallback con flag en localStorage para Safari antiguo sin Permissions API

### Cambiado
- `SpeedCard` ahora recibe `activo` (solo inicia `watchPosition` con permiso concedido)
  y `onGPSError` (reporta el código de error; antes se descartaba)
- El envío de ubicación a Supabase también espera el permiso concedido

### Corregido
- Teléfonos nuevos quedaban en "Sin GPS" para siempre: el permiso se pedía al montar
  el componente (sin gesto), y si el usuario lo denegaba o perdía el diálogo, la app
  fallaba en silencio sin forma de recuperarse

---

## [0.4.0] — Mayo 2026
### Agregado
- Panel maestro administrador en `/admin` con login propio
- Bandera roja funcional con log de timestamp
- Barra de capacidad de pista (pilotos actuales / máximo)
- Lista de pilotos en sesión con estados editables via dropdown
- Pestaña Acceso QR con resultados dinámicos (verde/amarillo/rojo)
- Pestaña Configuración con geocerca dibujable en mapa
- Selector de autódromo (5 autódromos chilenos con coordenadas reales)
- Configuración editable de máximo de pilotos y saldo mínimo
- Log de acciones en tiempo real en panel admin
- Botones de simulación ocultos en producción

### Cambiado
- Botones de test de estados QR movidos a `className="hidden"`

### Pendiente en esta versión
- Panel admin aún usa datos hardcodeados (no conectado a Supabase)
- Escaneo QR es simulación (sin cámara real)

---

## [0.3.0] — Mayo 2026
### Agregado
- QR real generado con `react-qr-code` (reemplaza QR decorativo)
- Tabla `qr_tokens` en Supabase
- Función `generarQRToken()` — genera token único, invalida anteriores
- Función `validarQRToken()` — valida contra Supabase con múltiples checks
- Función `confirmarIngreso()` — marca QR usado y crea sesión
- Función `getPilotosEnSesion()` y `getTodosLosPilotos()`
- Botón "Generar QR de acceso" real en app del piloto
- Token visible bajo el QR para debugging

### Cambiado
- Pestaña "Mi QR" ahora muestra QR real escaneable
- QR bloqueado si prueba no aprobada

---

## [0.2.0] — Mayo 2026
### Agregado
- Autenticación real con Supabase Auth
- Registro de pilotos con datos en tabla `pilotos`
- Login/logout funcional
- Perfil del piloto con datos reales (nombre, RUT, teléfono, vehículos)
- Sistema de semáforo: 🔴 deshabilitado / 🟠 pendiente / 🟢 habilitado
- Prueba de conocimientos (8 preguntas, 100% requerido)
- Regla de prueba por jornada (`prueba_aprobada` + `prueba_fecha`)
- Pestaña Reglamento permanente en app del piloto
- Flujo secuencial: login → registro → prueba → app
- Checkboxes de términos bloqueando botón "Crear cuenta"
- QR bloqueado hasta aprobar prueba
- 2 usuarios reales registrados en Supabase

### Cambiado
- App del piloto conectada a Supabase (reemplaza datos hardcodeados)

### Corregido
- Import path de `auth.ts` cambiado de `../lib/auth` a `@/lib/auth`

---

## [0.1.0] — Mayo 2026
### Agregado
- Proyecto Next.js inicializado con TypeScript y Tailwind
- Proyecto Supabase creado (`etrzcvbvypivgraazonk`)
- 5 tablas creadas: `pilotos`, `vehiculos`, `jornadas`, `pruebas_jornada`, `sesiones`
- Row Level Security habilitado en todas las tablas
- `lib/supabase.ts` — cliente Supabase
- `lib/auth.ts` — funciones base de autenticación
- Demo visual completo de app piloto (datos hardcodeados)
- Demo visual completo de panel admin (datos hardcodeados)
- Mapa GPS con vehículos en tiempo real (simulado)
- Selector de autódromo con detección GPS (simulada)
- Deployed en Vercel: `autodromo-app.vercel.app`
- GitHub conectado: `felipeschmauk-sys/autodromo-app`

---

## [0.0.1] — Mayo 2026
### Inicio del proyecto
- Definición de arquitectura: dos mundos separados (piloto / admin)
- Selección de stack: Next.js + Supabase + Vercel
- Creación de cuentas: GitHub, Vercel, Supabase
- Instalación de Node.js via nvm en Mac

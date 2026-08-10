# CHANGELOG.md
# Historial de Versiones — Autódromo App

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

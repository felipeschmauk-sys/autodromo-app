# CHANGELOG.md
# Historial de Versiones — Autódromo App

---

## [0.10.3] — 5 Julio 2026
### Corregido
- Pantalla se apagaba en iPhones con iOS < 16.4 (sin soporte de la API
  Wake Lock): fallback con nosleep.js — video invisible en loop, la misma
  técnica que mantiene la pantalla encendida en YouTube. Se activa solo,
  con reintento en el primer toque si iOS exige gesto del usuario

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

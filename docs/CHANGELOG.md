# CHANGELOG.md
# Historial de Versiones — Autódromo App

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

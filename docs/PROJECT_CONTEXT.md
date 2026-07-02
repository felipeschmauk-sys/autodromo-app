# PROJECT_CONTEXT.md
## Autódromo App — Documento Maestro de Contexto

> **Versión:** Junio 2026  
> **Propósito:** Documento único para continuar el desarrollo en cualquier conversación nueva sin revisar historial previo. Escrito como si fuera entregado a un desarrollador que nunca ha visto el proyecto.  
> **Actualizar este archivo** cada vez que se implementen cambios significativos.

---

## 1. Resumen Ejecutivo

### Objetivo General
Sistema digital de operación de pista para autódromos. Cubre: control de acceso mediante QR, monitoreo GPS de pilotos en tiempo real, comunicación de banderas desde dirección de carrera, sectorización del circuito y gestión de campeonatos y eventos.

### Problema que Resuelve
Los autódromos operan con procesos manuales o herramientas genéricas:
- Sin control digital de quién está en pista en cada momento
- Sin validación de habilitación, documentación ni capacidad
- Sin comunicación de banderas en tiempo real al piloto en pista
- Sin visibilidad de velocidad ni posición de cada auto

### Usuarios Objetivo
- **Administrador / Director de carrera:** opera el panel web desde PC o tablet en la torre de control
- **Piloto:** usa la app desde su smartphone antes y durante la sesión en pista

### Contexto Real
- Desarrollador/propietario: Felipe Schmauk, piloto profesional e instructor en Chile
- Primer autódromo objetivo: Autódromo Las Vizcachas, Santiago
- Otros autódromos futuros: Leyda, Codegua, Interlomas, Huachalalume

### Estado Actual del Desarrollo (Junio 2026)
Sistema funcional en producción (Vercel). Implementado: auth piloto, QR funcional, GPS en tiempo real, banderas globales y por sector, mapa con pilotos en tiempo real, gestión de campeonatos/eventos/inscripciones, panel de Dirección de Carrera con banderas por modalidad. En curso: jerarquía de banderas en app del piloto y patrones visuales de nuevas banderas en mapas.

---

## 2. Arquitectura General

### Stack Tecnológico
| Capa | Tecnología |
|---|---|
| Framework | Next.js 14, App Router, TypeScript |
| Estilos | Tailwind CSS |
| Base de datos | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Tiempo real | Supabase Realtime (`postgres_changes`) |
| Mapas | Leaflet (import directo, siempre `{ ssr: false }`) |
| Tiles de mapa | CartoDB Positron Light |
| QR generación | `react-qr-code` |
| QR escaneo | `jsQR` (via `QrScanner.tsx`) |
| Deploy | Vercel, rama `main` → producción automática |

### URLs
```
Producción piloto: autodromo-app.vercel.app
Producción admin:  autodromo-app.vercel.app/admin
Supabase proyecto: etrzcvbvypivgraazonk.supabase.co
```

### Variables de Entorno
```env
NEXT_PUBLIC_SUPABASE_URL=https://etrzcvbvypivgraazonk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  (legacy anon key, NO la publishable key)
```

### Estructura de Archivos Clave
```
autodromo-app/
├── app/
│   ├── page.tsx                    → re-exporta page-completo.tsx
│   └── admin/
│       └── page.tsx                → re-exporta admin-page-nuevo.tsx
├── components/
│   ├── DireccionCarrera.tsx        → Panel de control de pista en tiempo real
│   ├── LeafletAdminMap.tsx         → Mapa admin: trazado + sectores + pilotos en vivo
│   ├── LeafletPilotMap.tsx         → Mapa piloto: solo visualización
│   ├── LeafletSectoresMap.tsx      → Mapa para editor de sectores
│   ├── GeofenceMap.tsx             → Editor visual de geocercas (Leaflet draggable)
│   ├── SectoresEditor.tsx          → Editor visual de sectores del circuito
│   ├── CircuitoManager.tsx         → Biblioteca de circuitos con KML + geocercas
│   ├── AdminEventos.tsx            → Gestión de campeonatos y fechas
│   ├── QrScanner.tsx               → Lector QR con cámara (jsQR)
│   └── AdminMensajes.tsx           → Mensajes admin→piloto (DESACTIVADO temporalmente)
├── lib/
│   ├── supabase.ts                 → Cliente Supabase
│   ├── auth.ts                     → Auth, QR, sesiones
│   └── gps.ts                      → GPS, geocercas, trazado, ubicaciones
├── page-completo.tsx               → App del piloto (fuente real)
└── admin-page-nuevo.tsx            → Panel admin (fuente real)
```

> **Nota de deploy:** los archivos `page-completo.tsx` y `admin-page-nuevo.tsx` son las fuentes reales de trabajo. Se copian/importan en `app/page.tsx` y `app/admin/page.tsx`.

### Flujo de Información en Tiempo Real
```
PILOTO (smartphone)
  ├── GPS watchPosition() → registrarUbicacion() → INSERT ubicaciones_piloto (cada 4s)
  ├── Supabase Realtime SUBSCRIBE → estado_pista       (bandera global)
  ├── Supabase Realtime SUBSCRIBE → sectores_pista     (bandera por sector)
  └── Supabase Realtime SUBSCRIBE → sesiones (su fila) (bandera_piloto personal)

DIRECTOR / ADMIN (PC o tablet)
  ├── Supabase Realtime SUBSCRIBE → ubicaciones_piloto (INSERT) → posición en mapa
  ├── Supabase Realtime SUBSCRIBE → sesiones           → lista de pilotos activos
  ├── UPDATE estado_pista.bandera                      → bandera global
  ├── UPDATE sectores_pista.bandera                    → bandera por sector
  └── UPDATE sesiones.bandera_piloto                   → bandera personal por piloto
```

---

## 3. Roles de Usuario

### Piloto
- Se registra con email/password + nombre/RUT/teléfono
- Completa prueba de conocimientos del Reglamento TCC 2026 (10 preguntas, mínimo 8/10)
- Genera QR desde la app (válido 15 minutos, un solo uso)
- Ve: mapa del circuito, bandera activa, velocidad GPS en tiempo real
- Estados posibles: `deshabilitado` (sin prueba), `pendiente` (en proceso), `habilitado`
- `pilotos.prueba_aprobada = true` → puede entrar a pista

### Administrador
- Accede a `/admin` (sin autenticación propia por ahora — red interna o protección externa)
- Funciones principales:
  - Controlar banderas globales y por sector
  - Escanear QR de pilotos para validar acceso
  - Gestionar campeonatos, fechas, inscripciones
  - Ver mapa en tiempo real con posición de todos los pilotos
  - Cerrar sesiones manualmente

### Director de Carrera
En el contexto actual, el Administrador y el Director de Carrera son el mismo usuario. El panel admin tiene un tab dedicado "Dirección" que es la interfaz operativa de pista.

---

## 4. Base de Datos — Tablas

### `pilotos`
```sql
id UUID PRIMARY KEY (= auth.users.id)
nombre TEXT NOT NULL
rut TEXT NOT NULL
telefono TEXT
prueba_aprobada BOOLEAN DEFAULT false
prueba_fecha DATE
saldo_minutos INTEGER DEFAULT 0
bloqueado BOOLEAN DEFAULT false
created_at TIMESTAMPTZ
```

### `vehiculos`
```sql
id UUID PRIMARY KEY
piloto_id UUID → pilotos
marca TEXT NOT NULL
modelo TEXT NOT NULL
created_at TIMESTAMPTZ
```

### `qr_tokens`
```sql
id UUID PRIMARY KEY
piloto_id UUID → pilotos
token TEXT UNIQUE          -- formato: QR-{uid}-{timestamp}-{random6}
usado BOOLEAN DEFAULT false
created_at TIMESTAMPTZ
usado_at TIMESTAMPTZ
```
Token válido = `usado = false` AND antigüedad < 15 minutos.

### `sesiones`
```sql
id UUID PRIMARY KEY
piloto_id UUID → pilotos
estado TEXT              -- 'activa' | 'inactiva'
inicio TIMESTAMPTZ
fin TIMESTAMPTZ
bandera_piloto TEXT DEFAULT NULL  -- bandera personal asignada por director (NULL = sin bandera)
```

### `estado_pista`
```sql
id UUID PRIMARY KEY
activo BOOLEAN
bandera TEXT DEFAULT 'verde'
max_pilotos INTEGER DEFAULT 10
```
**Invariante:** siempre hay exactamente 1 fila con `activo = true`. Es la única fuente de verdad para el estado global de pista y la capacidad máxima.

### `sectores_pista`
```sql
id UUID PRIMARY KEY
nombre TEXT
orden INTEGER
punto_inicio INTEGER    -- índice en array de coordenadas del trazado
punto_fin INTEGER       -- índice en array de coordenadas del trazado
bandera TEXT DEFAULT 'verde'
```

### `trazado_pista`
```sql
id UUID PRIMARY KEY
nombre TEXT
coordenadas JSONB       -- array de { lat: number, lng: number }
activo BOOLEAN
```

### `geocerca`
```sql
id UUID PRIMARY KEY
nombre TEXT
coordenadas JSONB       -- array de { lat: number, lng: number }
activa BOOLEAN
tipo TEXT               -- 'pista' | 'recinto'
```
Dos geocercas independientes: `pista` (la pista de carrera) y `recinto` (todo el predio del autódromo).

### `ubicaciones_piloto`
```sql
id UUID PRIMARY KEY
piloto_id UUID → pilotos
sesion_id UUID → sesiones
lat DOUBLE PRECISION
lng DOUBLE PRECISION
velocidad INTEGER         -- km/h
precision_metros INTEGER
dentro_geocerca BOOLEAN   -- true = dentro geocerca de pista
timestamp TIMESTAMPTZ DEFAULT now()
```

### `campeonatos`
```sql
id UUID PRIMARY KEY
nombre TEXT
temporada INTEGER
descripcion TEXT
estado TEXT              -- 'activo' | 'inactivo'
created_at TIMESTAMPTZ
```

### `fechas_evento`
```sql
id UUID PRIMARY KEY
campeonato_id UUID → campeonatos
nombre TEXT
fecha_evento DATE
autodromo TEXT
trazado TEXT
cupos_max INTEGER DEFAULT 30
estado TEXT              -- 'borrador' | 'abierto' | 'finalizado'
tipo TEXT CHECK (tipo IN ('racing', 'track_day', 'entrenamiento'))
descripcion TEXT
```
**CHECK constraint activo:** `fechas_evento_tipo_check` — valores permitidos: `racing`, `track_day`, `entrenamiento`.  
**IMPORTANTE:** El valor `time_attack` fue renombrado a `track_day` en toda la base de código y en la DB.

### `inscripciones`
```sql
id UUID PRIMARY KEY
fecha_id UUID → fechas_evento
piloto_id UUID → pilotos
estado TEXT              -- 'solicitado' | 'inscrito' | 'confirmado' | 'en_pista' | 'finalizado' | 'cancelado'
pago_estado TEXT
created_at TIMESTAMPTZ
```

### `circuitos` (biblioteca de circuitos)
```sql
id UUID PRIMARY KEY
nombre TEXT
ubicacion TEXT
longitud_km DECIMAL
max_pilotos INTEGER DEFAULT 10
trazado_coords JSONB
geocerca_pista JSONB
geocerca_recinto JSONB
activo BOOLEAN DEFAULT false
created_at TIMESTAMPTZ
```

### RLS
Todas las tablas tienen políticas abiertas `FOR ALL USING (true)`. El control de acceso es por aplicación, no por RLS.

### Migraciones SQL Pendientes de Ejecutar
El archivo `task-56-migration.sql` debe correrse en Supabase si aún no se ha hecho:
```sql
-- Agregar bandera personal por piloto
ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS bandera_piloto TEXT DEFAULT NULL;

-- Actualizar CHECK constraint para aceptar track_day (drop + recrear)
ALTER TABLE fechas_evento DROP CONSTRAINT IF EXISTS fechas_evento_tipo_check;
ALTER TABLE fechas_evento ADD CONSTRAINT fechas_evento_tipo_check
  CHECK (tipo IN ('racing', 'track_day', 'entrenamiento'));

-- Migrar registros existentes
UPDATE fechas_evento SET tipo = 'track_day' WHERE tipo = 'time_attack';
```

---

## 5. Sistema de Banderas

### Tipos de Banderas

| Valor en DB | Nombre visual | Color / Patrón | Contexto de uso |
|---|---|---|---|
| `verde` | Pista libre | Verde `#22c55e` | Estado normal, circulación habilitada |
| `amarilla` | Amarilla | Amarillo `#eab308` | Peligro en sector, reducir velocidad, no adelantar |
| `amarilla_doble` | Doble amarilla | Amarillo (pulse) | Peligro grave (flag legacy en app piloto) |
| `roja` | Bandera roja | Rojo `#ef4444` + pulse | Detención inmediata, todos a boxes |
| `safety_car` | Safety Car | Naranja `#f97316` + pulse | Seguir vehículo de seguridad |
| `cuadros` | Cuadros | Patrón ajedrez B/N | Fin de sesión |
| `rayas` | Rayas | Diagonal amarillo+rojo | Peligro en sector (aceite, escombros) |
| `azul` | Azul | Azul `#1d4ed8` | Personal: piloto más lento debe dejar pasar |
| `negra` | Negra | Negro `#000` | Personal: exclusión del piloto |
| `negra_blanco` | Negra + blanco | Diagonal negro/blanco | Personal: advertencia formal (solo Racing) |
| `taller` | A taller | Violeta `#7c3aed` | Personal: piloto debe ir a boxes de inmediato |

### Jerarquía de Prioridad (mayor a menor)
1. **`cuadros`** — fin de sesión, siempre visible sobre todo
2. **`roja`** — detención inmediata
3. **Bandera personal del piloto** (`sesiones.bandera_piloto`)
4. **Bandera del sector** donde está el piloto (`sectores_pista.bandera`)
5. **Bandera global** (`estado_pista.bandera`)

> ⚠️ **PENDIENTE (Task #58):** La jerarquía completa aún NO está implementada en `page-completo.tsx`. Actualmente el piloto solo ve `estado_pista.bandera`. Falta: leer `sesiones.bandera_piloto` y `sectores_pista.bandera` del sector más cercano al piloto y aplicar la jerarquía.

### Banderas Disponibles por Tipo de Sesión (en DireccionCarrera — YA IMPLEMENTADO)

**Racing:**
- Global: `verde`, `roja`, `safety_car`, `cuadros`
- Sector: `verde`, `amarilla`, `rayas`
- Piloto: `azul`, `negra_blanco`, `negra`, `taller`

**Track Day:**
- Global: `verde`, `roja`, `safety_car` (label "Pace Car"), `cuadros`
- Sector: `verde`, `amarilla`, `rayas`
- Piloto: `azul`, `negra`, `taller`

**Entrenamiento:**
- Global: `verde`, `roja`, `cuadros`
- Sector: `verde`, `amarilla`, `rayas`
- Piloto: `taller`

### Auto-Yellow (automático)
Condiciones para activar amarilla automática en un sector:
1. La bandera global debe ser `verde` (no aplica si hay roja, safety car, etc.)
2. El piloto debe estar confirmado dentro de la geocerca de pista (`dentro_geocerca = true`)
3. La velocidad del piloto debe ser ≤ 5 km/h
4. El sector más cercano a la posición del piloto debe estar en `verde`

Al reanudar (velocidad > 5 km/h o salir de geocerca): la amarilla se revierte a `verde` automáticamente.
Implementado en `DireccionCarrera.tsx` → `checkAutoYellow()` y `revertAutoYellow()`.

### Banderas Personales de Piloto
- Asignadas desde el panel de Dirección, botón inline en la tarjeta del piloto.
- Toggle: un clic activa, otro clic desactiva.
- **No se borran solos** — el director debe quitarlos manualmente.
- Se persisten en `sesiones.bandera_piloto` (`NULL` = sin bandera personal).

---

## 6. Pantalla del Piloto — `page-completo.tsx`

### Flujo de Stages (lineal)
```
login → registro → prueba → eventos → app
```

**`login`:** Email + password. Botón a registro si no tiene cuenta.

**`registro`:** Nombre, RUT, teléfono, email, password. Crea cuenta Supabase Auth + registro en `pilotos` (con trigger + upsert de respaldo).

**`prueba`:** 10 preguntas del Reglamento Deportivo y Técnico TCC 2026. Mínimo 8/10 para aprobar. Al aprobar → `pilotos.prueba_aprobada = true`, avanza a `eventos`.

**`eventos`:** Selector de campeonato y fecha de evento. Muestra fechas futuras con `estado IN ['borrador', 'abierto']` y `fecha_evento >= hoy`. El piloto selecciona un evento, puede inscribirse o ver su estado de inscripción. Al confirmar, avanza a `app`.

**`app`:** Vista principal de pista (ver detalle abajo).

### Stage "app" — Vista Principal

**Portrait (vertical):**
- **Header** (`bg-indigo-700`): avatar con iniciales + nombre del piloto + badge de estado GPS + botón "Cambiar evento"
- **Mapa Leaflet** (230px altura): trazado coloreado + sectores
- **Pizarra de bandera**: panel grande con emoji + título + descripción, fondo y borde del color de la bandera activa, `animate-pulse` para roja/safety_car
- **SpeedCard**: velocidad GPS en tiempo real + indicador de geocerca de 3 niveles
- **Bottom navigation**: Pista / Perfil / Reglas
- **Botón QR flotante** (bottom-right, blanco si habilitado, oscuro si no)

**Landscape (horizontal — modo conducción):**
- Fullscreen, sin header ni bottom nav
- **70% izquierda:** mapa Leaflet fullscreen con trazado + sectores
- **30% derecha:** panel de bandera con color, emoji grande, título, descripción, badge GPS
- Se activa automáticamente al rotar el dispositivo

### SpeedCard
- Velocidad en km/h en número grande
- Semáforo GPS de 3 niveles:
  - `text-green-400 "En pista"`: `dentro_geocerca_pista = true`
  - `text-yellow-400 "En recinto"`: fuera de geocerca pista, dentro de geocerca recinto
  - `text-red-400 "Fuera"`: fuera de ambas geocercas
- Usa las dos geocercas (`pista` y `recinto`) independientemente

### Pizarra de Bandera — Colores (app piloto, `FLAG_CONFIG`)
```typescript
verde:          bg-green-950  border-green-800  text-green-400   pulse: false
amarilla:       bg-yellow-950 border-yellow-800 text-yellow-400  pulse: false
amarilla_doble: bg-yellow-950 border-yellow-700 text-yellow-300  pulse: true
roja:           bg-red-950    border-red-700    text-red-400     pulse: true
safety_car:     bg-orange-950 border-orange-700 text-orange-400  pulse: true
blanca:         bg-gray-900   border-gray-700   text-gray-200    pulse: false
negra:          bg-gray-950   border-gray-600   text-white       pulse: false
cuadros:        (PENDIENTE implementar)
```

### QR Modal
- Abre al tocar el botón flotante (solo si piloto habilitado)
- Genera token via `generarQRToken()` → guarda en `qr_tokens`
- Muestra QR con `react-qr-code`
- Expira a los 15 minutos
- Botón "Regenerar"

### GPS del Piloto
- `navigator.geolocation.watchPosition()` continuo con `enableHighAccuracy: true`
- Wake Lock activado para evitar que la pantalla apague el GPS
- Envío a Supabase cada 4 segundos (`registrarUbicacion()`)
- Velocidad: `coords.speed × 3.6` m/s → km/h (si `null` → 0)

---

## 7. Panel Administrador — `admin-page-nuevo.tsx`

### Selector de Contexto (Header)
El panel tiene un contexto activo: `{ campeonatoId, campeonatoNombre, fechaId, fechaNombre, tipo }`.
- Sin contexto: solo muestra tab `Eventos`
- Con contexto: muestra tabs completos según tipo de evento
- Fechas disponibles en selector: `estado IN ['borrador', 'abierto']` AND `fecha_evento >= hoy`

### Tabs por Tipo de Sesión
```
Racing:         Dirección | Acceso QR | Pilotos | Rev. Técnica | Config
Track Day:      Dirección | Acceso QR | Pilotos | Config
Entrenamiento:  Dirección | Acceso QR | Pilotos | Config
Sin contexto:   Eventos
```

### Tab: Dirección (`DireccionCarrera.tsx`)
Componente central de operación de pista. Secciones apiladas:

1. **Header**: "Dirección de Carrera" + tipo de sesión + chip de bandera activa
2. **Leyenda de pilotos**: dot de color + nombre por piloto
3. **Mapa Leaflet** (`mapHeight = 320px`): trazado + sectores coloreados + labels S1/S2/S3 + marcadores de pilotos
4. **Banderas globales**: grilla de botones según tipo de sesión. Activa = fondo de color + dot indicator. Cuadros usa patrón CSS checkerboard.
5. **Sectores**: fila por sector con botones **V** (verde) / **A** (amarilla) / **R** (rayas). Activo = fondo de color. Rayas usa patrón diagonal CSS.
6. **Pilotos en sesión**: tarjeta por piloto con velocidad + tiempo de última señal + botones inline de bandera personal (según tipo de sesión).

Props de `DireccionCarrera`: `{ fechaId?: string | null, mapHeight?: number }`.
El componente lee el tipo de sesión desde `fechas_evento.tipo` usando `fechaId`.

### Tab: Acceso QR
- Botón "Escanear QR" activa `QrScanner.tsx`
- Al detectar QR: llama `validarQRToken()` → muestra resultado con alerta de color
- **Resultados visuales:**
  - Verde: piloto autorizado + nombre + botón "Confirmar ingreso"
  - Naranja: pista llena
  - Rojo: bloqueado / QR inválido / QR expirado
  - Amarillo: sin saldo
- Al confirmar: `confirmarIngreso()` → crea sesión activa en DB

### Tab: Pilotos
- Lista de inscritos en la fecha activa con búsqueda
- Progresión de estado: `solicitado → inscrito → confirmado → en_pista`
- Cierre manual de sesión por piloto
- Ver saldo de minutos

### Tab: Revisión Técnica (solo Racing)
- Lista de pilotos inscritos
- Checkbox de revisión técnica aprobada por piloto

### Tab: Config

**CircuitoManager:**
- Biblioteca de circuitos guardados
- Crear/editar circuitos: nombre, ubicación, capacidad máxima, trazado KML, geocercas
- Importar trazado desde archivo KML → calcula distancia en km via Haversine
- Editor de geocerca pista y recinto (Leaflet con puntos arrastrables)
- **Activar circuito** → copia `trazado_coords` a `trazado_pista`, geocercas a `geocerca`, sincroniza `estado_pista.max_pilotos`
- Al guardar el circuito activo: también sincroniza `estado_pista.max_pilotos`

**SectoresEditor:**
- Editor visual sobre el mapa del circuito
- Divide el trazado en sectores arrastrando puntos límite
- Crear, nombrar, eliminar sectores
- Guarda en `sectores_pista`

### Tab: Eventos (`AdminEventos.tsx`)
- **Campeonatos:** crear / editar / eliminar. Grupos separados: activos e inactivos. Orden por `created_at DESC`.
- **Fechas:** crear / editar / eliminar por campeonato. Auto-finalización de fechas pasadas al cargar. Tipo: Racing / Track Day / Entrenamiento.
- Confirmación inline (Sí/No) para eliminar.

---

## 8. Mapas Leaflet

### Reglas de Importación (CRÍTICO)
```typescript
// Siempre importación directa, nunca react-leaflet:
import L from "leaflet";

// Siempre con dynamic import en el padre:
const LeafletAdminMap = dynamic(() => import("@/components/LeafletAdminMap"), { ssr: false });
```

### `LeafletAdminMap.tsx`
- Estático (sin pan/zoom del usuario)
- Muestra: trazado coloreado por bandera global, sectores coloreados por su bandera
- Labels "S1", "S2", "S3"...: fuente 9px, fondo blanco, borde del color del sector, posicionados al **25% del sector** (no al centro para no tapar el trazado), `iconAnchor` desplazado hacia abajo del trazado
- Marcadores de pilotos: cada piloto tiene un color único de la paleta `COLORES`
- Props: `{ trazado, sectores, bandera, pilotos }`

### `LeafletPilotMap.tsx`
- Visualización del trazado + sectores coloreados
- Estático en portrait, fullscreen en landscape
- Props: `{ trazado, bandera, sectores, height, onTap? }`

### `LeafletSectoresMap.tsx`
- Editor de sectores: permite arrastrar puntos límite sobre el trazado

### Colores en Mapas por Bandera
```
verde:      #22c55e   (polilínea sólida)
amarilla:   #eab308   (polilínea sólida)
roja:       #ef4444   (polilínea sólida)
safety_car: #f97316   (polilínea sólida)
rayas:      CSS repeating-linear-gradient(45deg, #eab308 0, #eab308 6px, #ef4444 6px, #ef4444 12px)
cuadros:    CSS repeating-conic-gradient(#000 0% 25%, #fff 0% 50%) 0 / 10px 10px
```
> ⚠️ **PENDIENTE (Task #59):** Los patrones CSS de `rayas` y `cuadros` no están aún aplicados sobre las polilíneas en los mapas Leaflet. Las polilíneas solo soportan colores sólidos nativamente — se necesita usar `L.divIcon` u otra técnica para el patrón.

### Tiles del Mapa
```javascript
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: "© OpenStreetMap © CARTO",
  subdomains: "abcd",
  maxZoom: 19,
})
```

---

## 9. Sistema de Geocercas

### Dos Geocercas Independientes
- **`tipo = 'pista'`**: límite exacto de la pista de carreras. Determina "en pista".
- **`tipo = 'recinto'`**: límite del autódromo completo (incluye boxes, paddock, accesos). Determina "en recinto".

### Estados del Piloto
1. **En pista**: dentro de geocerca `pista`
2. **En recinto**: fuera de `pista`, dentro de `recinto`
3. **Fuera**: fuera de ambas

### Algoritmo Ray-Casting (`puntoEnGeocerca`)
```typescript
export function puntoEnGeocerca(punto: Coordenada, poligono: Coordenada[]): boolean
```
Si el polígono tiene < 3 puntos, devuelve `true` (sin geocerca configurada = siempre dentro, para no bloquear la app en fase de desarrollo).

### Envío de Ubicación (`registrarUbicacion`)
```typescript
// Llama cada 4 segundos desde el piloto
await supabase.from("ubicaciones_piloto").insert({
  piloto_id, sesion_id, lat, lng, velocidad, precision_metros, dentro_geocerca
})
```
El campo `dentro_geocerca` refleja la geocerca de **pista** (no de recinto).

---

## 10. Sistema QR

### Flujo Completo
1. Piloto toca botón QR flotante en la app
2. `generarQRToken(piloto_id)`:
   - Invalida tokens anteriores no usados del mismo piloto (`usado = true`)
   - Genera token único: `QR-{uid}-{timestamp}-{random6chars_uppercase}`
   - Inserta en `qr_tokens`
3. Se muestra QR con `react-qr-code`
4. Admin escanea con `QrScanner.tsx` (jsQR via `getUserMedia`)
5. `validarQRToken(token, maxPilotos)`:
   - Verifica: token existe y `usado = false`
   - Verifica: antigüedad < 15 minutos
   - Verifica: piloto no bloqueado (`pilotos.bloqueado`)
   - Verifica: sesiones activas < `max_pilotos`
   - *(Saldo no verificado en fase actual)*
6. Si válido: admin ve nombre del piloto + botón "Confirmar ingreso"
7. `confirmarIngreso(qr_id, piloto_id)`:
   - Marca token `usado = true` con timestamp
   - Inserta sesión activa en `sesiones`

### Motivos de Rechazo Posibles
- "QR inválido o ya utilizado"
- "QR expirado (máximo 15 minutos)"
- "Piloto no encontrado en el sistema"
- "Piloto bloqueado por el administrador"
- `Pista al máximo de capacidad (N/M autos)`

---

## 11. Funciones de `lib/auth.ts`

```typescript
registrarPiloto({ email, password, nombre, rut, telefono })
  → Supabase Auth signUp + upsert en tabla pilotos

loginPiloto(email, password)
  → Supabase Auth signInWithPassword

cerrarSesion()
  → supabase.auth.signOut()

getPiloto()
  → pilotos.select('*, vehiculos(*)') del usuario autenticado

agregarVehiculo(piloto_id, marca, modelo)
  → INSERT vehiculos

aprobarPrueba(piloto_id)
  → UPDATE pilotos SET prueba_aprobada=true, prueba_fecha=hoy

pruebaVigenteHoy(piloto_id)
  → Verifica prueba_aprobada=true AND prueba_fecha=hoy

generarQRToken(piloto_id?)
  → Invalida anteriores + INSERT qr_tokens → retorna token string

validarQRToken(token, maxPilotos=20, _minSaldo=0)
  → Validaciones + retorna ValidacionResult

confirmarIngreso(qr_id, piloto_id)
  → UPDATE qr_tokens (usado=true) + INSERT sesiones (activa)

cerrarSesionAdmin(piloto_id)
  → UPDATE sesiones SET estado='inactiva', fin=now()

getPilotosEnSesion()
  → sesiones WHERE estado='activa' con JOIN pilotos+vehiculos

getTodosLosPilotos()
  → pilotos.select('*, vehiculos(*)') ORDER BY created_at DESC
```

---

## 12. Funciones de `lib/gps.ts`

```typescript
getTrazadoActivo(): Promise<Coordenada[] | null>
  → trazado_pista WHERE activo=true

guardarTrazado(coordenadas, nombre?)
  → Desactiva trazado anterior + INSERT trazado_pista activo

getGeocercaActiva(tipo: 'pista' | 'recinto'): Promise<Coordenada[] | null>
  → geocerca WHERE activa=true AND tipo=tipo

guardarGeocerca(coordenadas, tipo, nombre?)
  → Desactiva geocerca anterior del mismo tipo + INSERT

puntoEnGeocerca(punto, poligono): boolean
  → Ray-casting algorithm

registrarUbicacion(ubicacion: UbicacionPiloto): Promise<{error?}>
  → INSERT ubicaciones_piloto

getUltimasUbicaciones()
  → última ubicación por piloto (deduplicado)

iniciarGPS(pilotoId, sesionId, geocerca, onActualizar, intervaloMs=4000): () => cleanup
  → watchPosition continuo + setInterval para envío a Supabase
```

---

## 13. Diseño UX/UI — Decisiones Tomadas

### Filosofía
> Sistema de operación de pista profesional, no dashboard corporativo genérico.  
> Inspiración: Tesla UI, F1 Race Control, Garmin Motorsport, software de cronometraje profesional.

### Paleta de Colores Base
```css
Fondo principal:     bg-gray-950  (#030712)
Fondo tarjetas:      bg-gray-900  (#111827)
Bordes:              border-gray-800 (#1f2937)
Texto secundario:    text-gray-500 (#6b7280)
Texto primario:      text-white
```

### Identidad del Piloto
```css
Header app piloto:   bg-indigo-700  (único color no oscuro — diferencia al piloto del admin)
```

### Principios de Operación Rápida
- El director debe poder activar una bandera en ≤ 2 toques desde cualquier estado
- Los botones de bandera son grandes y siempre visibles (no en menús)
- Las alertas de rechazo de QR son grandes y en colores reconocibles a distancia

### Estilos de Componentes
- Tarjetas: `rounded-2xl`, `border`, fondo `bg-gray-900`
- Botones activos: escala `active:scale-95`, transition
- Chips/badges de estado: `rounded-full`, `text-xs font-bold`
- Labels de datos numéricos: `tabular-nums font-black`
- Secciones del panel: separadas por `border-t border-gray-800`

### Comportamiento Responsive
- App del piloto: `max-width: 480px`, centrado, mobile-first
- Panel admin: full width en desktop, adaptable en tablet
- Mapas: altura fija en px (no %)

### Animaciones de Bandera
- `animate-pulse` en: `roja`, `safety_car`, `amarilla_doble`
- Sin pulse en: `verde`, `amarilla`, `cuadros`, `blanca`
- El patrón de `cuadros` usa CSS: `repeating-conic-gradient(#fff 0% 25%, #111 0% 50%) 0 / 10px 10px`
- El patrón de `rayas` usa CSS: `repeating-linear-gradient(45deg, #eab308 0, #eab308 6px, #ef4444 6px, #ef4444 12px)`

---

## 14. Funcionalidades Implementadas ✅

| # | Funcionalidad | Archivo(s) clave |
|---|---|---|
| 1 | Auth piloto (registro/login/logout) | `auth.ts`, `page-completo.tsx` |
| 2 | Prueba de conocimientos Reglamento TCC 2026 | `page-completo.tsx` |
| 3 | Generación de QR temporal (15 min, un uso) | `auth.ts` |
| 4 | Escáner QR con cámara (jsQR) | `QrScanner.tsx` |
| 5 | Validación QR con motivos de rechazo visuales | `auth.ts`, `admin-page-nuevo.tsx` |
| 6 | Confirmación de ingreso y creación de sesión | `auth.ts` |
| 7 | GPS en tiempo real del piloto | `gps.ts`, `page-completo.tsx` |
| 8 | Wake Lock para GPS continuo | `page-completo.tsx` |
| 9 | Envío de ubicación a Supabase cada 4s | `gps.ts` |
| 10 | Dos geocercas independientes (pista + recinto) | `gps.ts`, `GeofenceMap.tsx` |
| 11 | Indicador GPS de 3 niveles (pista/recinto/fuera) | `page-completo.tsx` |
| 12 | Mapa del piloto con trazado + sectores | `LeafletPilotMap.tsx` |
| 13 | Mapa admin con pilotos en tiempo real | `LeafletAdminMap.tsx` |
| 14 | Banderas globales (verde/amarilla/roja/safety_car) | `admin-page-nuevo.tsx`, `estado_pista` |
| 15 | Sincronización bandera admin→piloto en tiempo real | Supabase Realtime |
| 16 | Sectorización visual del circuito | `SectoresEditor.tsx` |
| 17 | Banderas por sector | `DireccionCarrera.tsx`, `sectores_pista` |
| 18 | Auto-yellow por piloto detenido en pista (≤5 km/h, dentro geocerca) | `DireccionCarrera.tsx` |
| 19 | Labels S1/S2/S3 en mapa del admin | `LeafletAdminMap.tsx` |
| 20 | Modo landscape (conducción) en app del piloto | `page-completo.tsx` |
| 21 | PWA (manifest + icons + safe-area) | `app/` |
| 22 | Biblioteca de circuitos con KML + geocercas + distancia km | `CircuitoManager.tsx` |
| 23 | max_pilotos persistido en DB y sincronizado con circuito activo | `CircuitoManager.tsx`, `estado_pista` |
| 24 | Gestión de campeonatos y fechas (crear/editar/eliminar) | `AdminEventos.tsx` |
| 25 | Selector de contexto (campeonato/fecha) en panel admin | `admin-page-nuevo.tsx` |
| 26 | Tabs dinámicos según tipo de sesión | `admin-page-nuevo.tsx` |
| 27 | Auto-finalización de fechas pasadas | `AdminEventos.tsx` |
| 28 | Filtrado de pilotos en mapa por evento activo | `DireccionCarrera.tsx` |
| 29 | Control de inscripciones con estados | `admin-page-nuevo.tsx` |
| 30 | Revisión Técnica tab (solo Racing) | `admin-page-nuevo.tsx` |
| 31 | DireccionCarrera rediseñado por modalidad de sesión | `DireccionCarrera.tsx` |
| 32 | Banderas personales por piloto (toggle, persisten en DB) | `DireccionCarrera.tsx`, `sesiones.bandera_piloto` |
| 33 | Renombrado completo `time_attack` → `track_day` en todo el sistema | Todos los archivos |
| 34 | Stage "eventos" en app del piloto (selector de evento) | `page-completo.tsx` |
| 35 | Campeonatos agrupados activos/inactivos, orden por created_at | `AdminEventos.tsx` |

---

## 15. Funcionalidades Pendientes 🔜

### Prioritarias — Sprint Inmediato

| Task | Archivo | Descripción |
|---|---|---|
| **Correr SQL** | Supabase | Ejecutar `task-56-migration.sql` si no se ha hecho (bandera_piloto + constraint track_day) |
| **#58** | `page-completo.tsx` | Jerarquía de banderas en app del piloto: cuadros > roja > personal > sector > global. Leer `sesiones.bandera_piloto` y `sectores_pista` del sector más cercano al piloto. |
| **#59** | `LeafletAdminMap.tsx`, `LeafletPilotMap.tsx` | Patrones visuales de `rayas` (diagonal amarillo+rojo) y `cuadros` (ajedrez) en polilíneas de sectores en mapas. |

### Próxima Iteración

| Funcionalidad | Descripción |
|---|---|
| Animación cuadros en piloto | Cuando `bandera = cuadros`, animación fullscreen de cuadros a pantalla completa del piloto |
| Flash de alerta sectorial | Cuando el sector del piloto cambia de bandera, mostrar flash de alerta breve en la app |
| Cobro por tiempo | Descuento automático de `saldo_minutos` mientras sesión activa y dentro geocerca de pista. No pausable por piloto. Solo con bandera roja o cierre oficial. |
| Cierre automático por geocerca | Si piloto fuera de geocerca más de X minutos: cerrar sesión automáticamente, requerir nuevo QR para reingresar |

### Mediano Plazo

| Funcionalidad | Descripción |
|---|---|
| Leaderboard | Tabla de tiempos/posiciones durante evento |
| Cronometraje | Tiempos por vuelta (requiere detección de paso por línea de meta) |
| Reservas | Reservar slot en fecha de evento con hora específica |
| Membresías | Planes de tiempo prepagado |
| Multas automáticas | Penalizaciones por conducta en pista |
| Control de semáforos | Activar semáforo físico desde el panel (requiere hardware) |
| Telemetría básica | Datos del auto en tiempo real (requiere hardware) |
| Mensajes admin→piloto | Ya existe `AdminMensajes.tsx` y la tabla, desactivado temporalmente |
| Auth del panel admin | Actualmente sin autenticación propia |
| Strava OAuth para trazados | Importar trazados desde Strava (Task #29) |

---

## 16. Reglas de Negocio

1. **Sesión activa = auto en pista.** No puede haber dos sesiones activas para el mismo piloto.

2. **max_pilotos:** Límite de autos simultáneos. Configurado por circuito, persiste en `estado_pista.max_pilotos`. Se verifica al validar QR.

3. **Prueba de conocimientos:** Requerida para acceder a pista. El admin puede aprobarla manualmente. El campo `prueba_fecha` permite verificar vigencia diaria.

4. **QR de un solo uso, 15 minutos.** Al generar uno nuevo, los anteriores del mismo piloto se invalidan.

5. **Cobro por tiempo (pendiente):** Empieza con la sesión. No se puede pausar si el auto está en movimiento. Solo se detiene con bandera roja o cierre oficial. Sale de geocerca → deja de cobrarse.

6. **Cierre automático (pendiente):** Si piloto fuera de geocerca más de X minutos, sesión se cierra y necesita nuevo QR para reingresar.

7. **Bandera roja:** Detención total. No cierra sesiones automáticamente (el director las cierra manualmente).

8. **Cuadros:** Señal de fin de sesión. No cierra sesiones automáticamente.

9. **Piloto bloqueado:** `pilotos.bloqueado = true` → no puede ingresar aunque tenga QR válido.

10. **Auto-yellow:** Solo dentro de geocerca de pista y con velocidad ≤ 5 km/h. Umbral elegido: 2 km/h era demasiado estricto (vibraciones GPS generaban falsos detenidos).

11. **Tipo de sesión:** Determina qué banderas están disponibles para el director. No afecta la visualización del piloto (pendiente Task #58).

---

## 17. Bugs Conocidos y Consideraciones Técnicas

### Resueltos
- ✅ GPS nunca conectaba en teléfonos nuevos → el permiso se pedía al montar (sin gesto) y una denegación quedaba silenciosa para siempre. Ahora: overlay que pide ubicación con botón, detección de estado via Permissions API, pantalla de recuperación si está denegado (Julio 2026)
- ✅ Auto-yellow disparándose desde fuera del autódromo → `dentroGeocerca !== true` guard
- ✅ max_pilotos perdido entre recargas → `estado_pista.max_pilotos` en DB
- ✅ CHECK constraint bloqueaba renombrado time_attack→track_day → drop+recrear constraint
- ✅ Sector labels cubrían el trazado → labels S1/S2/S3 pequeños (9px) al 25% del sector, desplazados bajo el trazado

### Pendientes / A Vigilar

| Problema | Riesgo |
|---|---|
| **Leaflet + SSR** | Cualquier componente Leaflet sin `dynamic({ssr: false})` rompe el build |
| **Stale closures en Supabase Realtime** | Usar `useRef` para cualquier valor leído dentro de callbacks de Supabase. Los `useEffect` con deps vacías no ven actualizaciones de estado. |
| **GPS en iOS en background** | Wake Lock evita que la pantalla se apague pero no garantiza GPS en background real en iOS. El piloto debe mantener la pantalla encendida. |
| **QR en localhost** | Acceso a cámara requiere HTTPS. En localhost puede fallar en algunos navegadores. |
| **Campeonatos con mismo timestamp** | Si dos campeonatos se crean en el mismo segundo, el orden por `created_at DESC` puede ser inestable. En la práctica es insignificante. |
| **GPS accuracy en pista estrecha** | GPS de celular tiene margen de ±10m. En pistas con sectores cortos puede producir falsos cambios de sector. |
| **Conectividad débil en autódromos** | Algunos autódromos chilenos tienen señal débil. El sistema no tiene modo offline. |
| **Sesiones zombie** | Sesiones marcadas como `activa` cuyo piloto no tiene GPS reciente no se cierran automáticamente. Requiere lógica de cierre por inactividad (pendiente). |

---

## 18. Decisiones Tomadas — No Reabrir

| Decisión | Razón | Cuándo se tomó |
|---|---|---|
| `time_attack` → `track_day` en todo el sistema | "Time Attack" es marca registrada con derechos | Sesión junio 2026 |
| max_pilotos en DB (`estado_pista.max_pilotos`) | Era solo estado React, se perdía en recarga. DB es fuente de verdad. | Sesión mayo 2026 |
| Panel de Dirección es solo lectura + control de banderas | "El panel de dirección es para visualizar y controlar, no para ajustar configuraciones." | Sesión mayo 2026 |
| Umbral de velocidad para auto-yellow: ≤5 km/h | 2 km/h producía falsos auto-yellows por vibración GPS | Sesión mayo 2026 |
| Auto-yellow solo dentro de geocerca de pista | Piloto detenido en su casa no debe generar amarilla | Sesión mayo 2026 |
| Labels de sector: S1/S2 abreviado, 9px, al 25% del sector | Labels completos/centrados cubrían el trazado | Sesión mayo 2026 |
| Banderas personales no se auto-borran | El director debe borrarlas manualmente. "Las banderas personales duran hasta que el director las borre." | Sesión junio 2026 |
| Leaflet import directo (no react-leaflet) | react-leaflet tiene problemas de SSR con Next.js App Router | Fase 2 |
| Dos geocercas independientes (pista + recinto) | Piloto en boxes/paddock no está "en pista" pero sí "en recinto" | Sesión anterior |
| Sin patente de vehículo | Decisión explícita del propietario | Sesión inicial |
| Sin categoría en registro inicial | Puede agregarse después según niveles de uso | Sesión inicial |
| Campeonatos ordenados por `created_at DESC` | Orden por temporada era inestable con empates | Sesión mayo 2026 |
| `AdminMensajes` desactivado | Existe pero temporalmente desactivado, no eliminado | Sesión anterior |
| RLS abierta `FOR ALL USING (true)` | Control de acceso por aplicación, no por base de datos | Sesión inicial |

---

## 19. TODO Priorizado

### Inmediato (próxima sesión)
1. **Correr `task-56-migration.sql`** en Supabase (si no se ha hecho aún)
2. **Task #58** — Implementar jerarquía de banderas en `page-completo.tsx`:
   - Suscribir a `sesiones` del piloto para leer `bandera_piloto`
   - Calcular en qué sector está el piloto comparando su posición con `sectores_pista`
   - Aplicar jerarquía: cuadros > roja > personal > sector > global
   - Mostrar la bandera resultante en la pizarra
3. **Task #59** — Patrones visuales `rayas` y `cuadros` en Leaflet:
   - Los sectores con `bandera = 'rayas'` deben mostrar patrón visual (no solo color sólido)
   - Técnica sugerida: `L.polylineDecorator` o polilínea con dash de dos colores alternados

### Próxima iteración
4. Animación fullscreen de cuadros en app del piloto
5. Flash de alerta en piloto al cambiar bandera de su sector
6. Lógica de cobro por minuto con geocerca
7. Cierre automático de sesión por tiempo fuera de geocerca

### Deuda técnica
8. Auth para panel admin (actualmente sin protección)
9. Cleanup de sesiones zombie (sesiones `activa` sin GPS reciente)
10. Manejo de error de GPS (mostrar mensaje amigable cuando falla)

---

## 20. Instrucciones de Colaboración con el LLM

El usuario (Felipe) tiene las siguientes instrucciones que deben respetarse siempre:

1. **Desacuerdo estructurado:** "Cuando me equivoque, di: 'no estoy de acuerdo porque [RAZÓN]. Esto es lo que haría en su lugar: [alternativa]. El riesgo de tu enfoque es [CONSECUENCIA ESPECÍFICA].'"
2. **Verdad incómoda primero:** "Dame primero la respuesta incómoda. Si hay una verdad que probablemente no quiero escuchar, empieza por ella."
3. **Sin párrafos de introducción:** "No uses párrafos de introducción innecesarios. Evita frases como 'Hay varias formas de abordar esto'. Empieza con lo más útil."
4. **Mantener posición:** "Si te cuestiono, no cambies de postura a menos que me proporciones información realmente nueva."

---

## 21. Cómo Iniciar una Sesión Nueva

### Prompt de inicio recomendado
```
Continúa desarrollando el proyecto Autódromo App.

Lee primero PROJECT_CONTEXT.md en la carpeta del proyecto para entender el estado actual.
El documento está en: autodromo app/PROJECT_CONTEXT.md

Tarea específica: [describir aquí la tarea]
```

### Estado de las Tasks en el Tracker Interno
- Tasks #1–#55: completadas (historial)
- Task #56 → completada como #61 (SQL migration)
- Task #57 → completada como #62 (DireccionCarrera rediseño)
- Task #58 → **PENDIENTE REAL** (strip del piloto, jerarquía de banderas)
- Task #59 → **PENDIENTE REAL** (patrones visuales en mapas)
- Task #60 → completada como #63 (renombrado time_attack→track_day)
- Task #29 → pendiente (Strava OAuth)

### Archivos que NO Tocar sin Entender Bien
- `gps.ts` — lógica de geocerca probada en producción
- `auth.ts` — flujo QR probado en producción  
- Políticas RLS en Supabase — abiertas intencionalmente (`FOR ALL USING (true)`)
- El CHECK constraint `fechas_evento_tipo_check` — recién recreado, acepta: `racing`, `track_day`, `entrenamiento`

# PROJECT_CONTEXT.md
# Autódromo App — Contexto Completo del Proyecto
# Última actualización: Mayo 2026

---

## 1. OBJETIVO REAL DE LA APP

Esta aplicación NO es una app social ni de telemetría casual.

**Objetivo principal:**
Controlar el ingreso de pilotos a pista y mejorar la seguridad operacional de autódromos en Chile.

**Problema que resuelve:**
- Los autódromos chilenos no tienen sistema digital de control de acceso
- El ingreso a pista se maneja manualmente, sin validación de saldo, documentación ni habilitación
- No existe control de capacidad de pista en tiempo real
- El director de pista no tiene visibilidad de quién está en pista en cada momento

**Contexto de uso real:**
- El propietario/desarrollador es piloto profesional e instructor de automovilismo en Chile
- El sistema se probará primero en Autódromo Las Vizcachas, Santiago
- Los autódromos objetivo son: Las Vizcachas, Leyda, Codegua, Interlomas, Huachalalume

---

## 2. ARQUITECTURA GENERAL

```
autodromo-app.vercel.app        → App piloto (móvil first)
autodromo-app.vercel.app/admin  → Panel maestro administrador
```

**Dos mundos completamente separados:**
- El piloto NUNCA ve el panel admin
- El admin tiene login propio con credenciales separadas
- No hay navegación cruzada entre ambos

**Stack tecnológico:**
- Framework: Next.js 16 con App Router
- Lenguaje: TypeScript
- Estilos: Tailwind CSS
- Base de datos + Auth: Supabase
- Deployment: Vercel (free tier)
- QR generación: react-qr-code
- QR escaneo: pendiente (html5-qrcode planificado)
- Control de versiones: GitHub (felipeschmauk-sys/autodromo-app)

---

## 3. ESTRUCTURA DE ARCHIVOS

```
autodromo-app/
├── app/
│   ├── page.tsx          → App del piloto (PRINCIPAL)
│   ├── admin/
│   │   └── page.tsx      → Panel maestro administrador
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── supabase.ts       → Cliente Supabase
│   └── auth.ts           → Todas las funciones de auth y QR
├── public/
├── .env.local            → Variables de entorno (NO subir a GitHub)
├── vercel.json           → Configuración framework Next.js
└── package.json
```

---

## 4. CREDENCIALES Y CONFIGURACIÓN

```
GitHub: felipeschmauk-sys/autodromo-app
Vercel: autodromo-app.vercel.app
Supabase URL: https://etrzcvbvypivgraazonk.supabase.co
Supabase Key: sb_publishable_W1r0tNYOIsy9XEu9JI7Ybw_sAU4CJty
Admin panel demo: admin@autodromo.cl / admin123
```

**.env.local:**
```
NEXT_PUBLIC_SUPABASE_URL=https://etrzcvbvypivgraazonk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_W1r0tNYOIsy9XEu9JI7Ybw_sAU4CJty
```

---

## 5. BASE DE DATOS SUPABASE

### Tablas existentes (todas con RLS habilitado):

**pilotos**
```sql
id uuid references auth.users PRIMARY KEY
nombre text NOT NULL
rut text NOT NULL UNIQUE
telefono text
licencia_url text
prueba_aprobada boolean DEFAULT false
prueba_fecha date
saldo_minutos integer DEFAULT 0
bloqueado boolean DEFAULT false
created_at timestamp with time zone
```

**vehiculos**
```sql
id uuid PRIMARY KEY
piloto_id uuid references pilotos
marca text NOT NULL
modelo text NOT NULL
created_at timestamp with time zone
```

**jornadas**
```sql
id uuid PRIMARY KEY
autodromo text NOT NULL
fecha date DEFAULT current_date
activa boolean DEFAULT true
created_at timestamp with time zone
```

**pruebas_jornada**
```sql
id uuid PRIMARY KEY
piloto_id uuid references pilotos
jornada_id uuid references jornadas
aprobada boolean DEFAULT false
fecha timestamp with time zone
UNIQUE(piloto_id, jornada_id)
```

**sesiones**
```sql
id uuid PRIMARY KEY
piloto_id uuid references pilotos
jornada_id uuid references jornadas
vehiculo_id uuid references vehiculos
inicio timestamp with time zone
fin timestamp with time zone
minutos_usados integer DEFAULT 0
estado text DEFAULT 'activa'
created_at timestamp with time zone
```

**qr_tokens**
```sql
id uuid PRIMARY KEY
piloto_id uuid references pilotos
token text NOT NULL UNIQUE
usado boolean DEFAULT false
created_at timestamp with time zone
usado_at timestamp with time zone
```

### Usuarios reales en Supabase (mayo 2026):
- felipe.schmauk@gmail.com
- juanprueba@gmail.com

---

## 6. FUNCIONES IMPLEMENTADAS EN lib/auth.ts

Todas implementadas y funcionales:

```typescript
registrarPiloto({ email, password, nombre, rut, telefono })
// Crea usuario en auth.users + registro en tabla pilotos

loginPiloto(email, password)
// Login con Supabase Auth

cerrarSesion()
// Logout

getPiloto()
// Obtiene piloto autenticado con sus vehículos

agregarVehiculo(piloto_id, marca, modelo)
// Agrega vehículo al piloto

aprobarPrueba(piloto_id)
// Marca prueba_aprobada=true y guarda fecha de hoy

pruebaVigenteHoy(piloto_id)
// Verifica si prueba_aprobada=true Y prueba_fecha=hoy

generarQRToken(piloto_id)
// Invalida QR anteriores no usados del piloto
// Genera token único: QR-{piloto_id}-{timestamp}-{random}
// Inserta en tabla qr_tokens
// Retorna el token string

validarQRToken(token, maxPilotos=6, minSaldo=5)
// Busca token en qr_tokens donde usado=false
// Verifica: piloto no bloqueado
// Verifica: saldo_minutos >= minSaldo
// Verifica: prueba_aprobada=true Y prueba_fecha=hoy
// Verifica: sesiones activas < maxPilotos
// Retorna: { autorizado, motivo, piloto, qr_id, token }

confirmarIngreso(qr_id, piloto_id)
// Marca QR como usado con timestamp
// Crea sesión activa en tabla sesiones

getPilotosEnSesion()
// Obtiene sesiones activas con datos del piloto

getTodosLosPilotos()
// Lista todos los pilotos registrados con vehículos
```

---

## 7. APP DEL PILOTO (app/page.tsx)

### Estados del flujo:
```
"login" → "registro" → "prueba" → "app"
```

### Flujo completo:
1. Login o registro
2. Registro paso 1: nombre, rut, correo, teléfono, contraseña, licencia, vehículos (opcional)
3. Registro paso 2: aceptación de términos (3 checkboxes obligatorios, botón bloqueado hasta marcar todos)
4. Prueba de conocimientos (8 preguntas, necesita 100% para avanzar, reintentos ilimitados)
5. App habilitada

### Sistema de semáforo:
- 🔴 Rojo → cuenta deshabilitada (no completó prueba)
- 🟠 Naranjo → prueba pendiente (en proceso)
- 🟢 Verde → habilitado para pista

### Pestañas de la app (solo visibles habilitado):
- 👤 Perfil: datos personales, saldo, vehículos, estado de prueba
- 📷 Mi QR: genera QR real con react-qr-code
- ⏱ Saldo: paquetes de minutos (placeholder, sin pago real aún)
- 📄 Reglamento: banderas, normas, PDFs descargables

### QR real:
- Botón "Generar QR de acceso" llama a generarQRToken()
- Se muestra QR real con react-qr-code (no decorativo)
- El token se guarda en Supabase tabla qr_tokens
- Al generar uno nuevo, invalida los anteriores del mismo piloto
- QR es para UN SOLO ingreso

### Prueba de conocimientos (8 preguntas reales):
1. ¿Por qué lado sobrepasar? → Derecho
2. Si eres adelantado, ¿qué hacer? → Mantener línea y facilitar el paso
3. ¿Bandera roja? → Detención inmediata
4. ¿Bandera amarilla? → Peligro, reducir velocidad, no adelantar
5. ¿Bandera amarilla doble? → Peligro grave, adelantar prohibido
6. ¿Cobro si vehículo detenido en pista? → Continúa dentro de geocerca
7. ¿Quién pausa el cobro? → Solo director de pista
8. ¿Al salir de geocerca? → Tanda se cierra automáticamente

### Regla de jornada:
- La prueba se renueva por jornada (no por 24h)
- El admin abre/cierra jornadas
- Al inicio de cada jornada todos los pilotos están "pendientes"

---

## 8. PANEL MAESTRO ADMIN (app/admin/page.tsx)

### Login:
- Pantalla separada, fondo oscuro (#1a1a2e)
- Credenciales demo: admin@autodromo.cl / admin123
- ⚠ PENDIENTE: autenticación real con Supabase para admin

### Pestañas del panel:
1. 🚦 Dirección de pista
2. 📷 Acceso QR
3. 👥 Pilotos
4. ⚙️ Configuración

### Pestaña Dirección de pista:
- Banner de estado (verde/rojo) con botón bandera roja
- Barra de capacidad: pilotos actuales / máximo configurado
- Lista de pilotos en sesión con estados editables via dropdown
- Mapa GPS (actualmente visual, sin GPS real)
- Log de acciones en tiempo real
- Registro de eventos especiales (rescate, multa, daño)

### Estados de piloto en sesión:
```
en_pista  → 🟢 En pista (dentro de geocerca)
box       → 📦 Box (salió temporalmente)
fuera     → ⬜ Fuera (sin sesión activa)
espera    → 🔵 En espera (QR validado, pendiente de ingresar)
bloqueado → 🔴 Bloqueado (impedido por admin)
```

### Bandera roja:
- Botón prominente en header del panel
- Al activar: banner rojo global, bloquea nuevos ingresos en scanner QR
- Al activar: log registra timestamp
- Al levantar: log registra timestamp, cobro reanudado

### Pestaña Acceso QR:
- Zona de escaneo (actualmente simulación, pendiente cámara real)
- Botones de simulación OCULTOS en producción (className="hidden")
- Botones de simulación VISIBLES solo en development
- Resultados dinámicos post-escaneo:
  - ✅ Verde: acceso autorizado + datos del piloto
  - 🚦 Amarillo: pista llena
  - 🔴 Rojo: bloqueado o sin saldo

### Pestaña Configuración:
- Selector de autódromo activo (5 autódromos chilenos)
- Máximo de pilotos en pista (editable, default 6)
- Saldo mínimo para ingresar (editable, default 5 min)
- Geocerca dibujable: clic en mapa para marcar vértices, polígono SVG
- Reglas operacionales (informativas)

### ⚠ PROBLEMA ACTUAL: Pilotos en panel admin son datos HARDCODEADOS (demo)
Pendiente conectar con Supabase usando getTodosLosPilotos() y getPilotosEnSesion()

---

## 9. FLUJO QR ENTRE DISPOSITIVOS

```
PILOTO (celular)                    STAFF/ADMIN (computador/tablet)
─────────────────                   ──────────────────────────────
1. Abre app → login
2. Completa prueba jornada
3. Tap "Generar QR"
4. generarQRToken() → Supabase      
5. QR mostrado en pantalla
                                    6. Admin abre panel /admin
                                    7. Va a pestaña Acceso QR
                                    8. Activa cámara
                                    9. Escanea QR del piloto
                                    10. validarQRToken() → Supabase
                                    11. Resultado visual (verde/rojo)
                                    12. Si ok → "Confirmar ingreso"
                                    13. confirmarIngreso() → Supabase
                                    14. QR marcado como usado
                                    15. Sesión creada en tabla sesiones
                                    16. Piloto aparece en lista operativa
```

---

## 10. AUTÓDROMOS CONFIGURADOS

```javascript
{ id: "vizcachas",    nombre: "Las Vizcachas",         lat: -33.5847, lng: -70.5372 }
{ id: "leyda",        nombre: "Autódromo de Leyda",     lat: -33.617,  lng: -71.509  }
{ id: "codegua",      nombre: "Autódromo de Codegua",   lat: -34.033,  lng: -70.717  }
{ id: "interlomas",   nombre: "Interlomas Motor Park",  lat: -33.283,  lng: -70.883  }
{ id: "huachalalume", nombre: "Autódromo Huachalalume", lat: -31.633,  lng: -71.167  }
```

Detección automática por GPS: la app calcula distancia a cada autódromo y selecciona el más cercano.

---

## 11. REGLAS DE UX/UI — NO ROMPER

### Separación de mundos:
- La app del piloto NUNCA muestra: banderas, otros pilotos, mapa GPS general, decisiones administrativas
- El panel admin NUNCA es accesible desde la app del piloto

### Sistema de colores de señales:
```
🟢 Verde  → habilitado, autorizado, en pista, ok
🟠 Naranja → pendiente, advertencia leve, prueba no completada
🔴 Rojo   → bloqueado, denegado, bandera roja, error crítico
🔵 Azul   → en espera, informativo
📦 Gris   → fuera de geocerca, box, inactivo
```

### QR:
- QR es para UN SOLO INGRESO — siempre comunicar esto claramente
- Al salir de pista el QR queda invalidado
- Para reingresar siempre generar QR nuevo
- No usar QR decorativos (la versión anterior los tenía decorativos, se cambió a reales)

### Prueba de conocimientos:
- Requiere 100% de respuestas correctas (no 80%, no 90%, 100%)
- Reintentos ilimitados
- Las respuestas correctas se muestran en verde al evaluar
- Las incorrectas elegidas en rojo
- No se puede avanzar con menos del 100%

### Botones de simulación en panel admin:
- OCULTOS en producción (className="hidden")
- Solo visibles durante desarrollo
- Nunca mostrar botones de estados manuales al staff operativo

### Pantalla Acceso QR del admin:
- Estado inicial: solo zona de cámara + buscador manual
- Los resultados (verde/amarillo/rojo) aparecen SOLO después de escanear
- No hay botones permanentes de estados

### Registro:
- Vehículos son OPCIONALES (badge visible)
- Sin patente (decisión tomada, no agregar)
- Sin categoría en registro (puede agregarse después según uso)
- Checkboxes de términos bloquean el botón "Crear cuenta" hasta marcarse todos

---

## 12. FUNCIONALIDADES COMPLETADAS ✓

- [x] Registro real de pilotos con Supabase Auth
- [x] Login/logout real
- [x] Perfil del piloto con datos reales
- [x] Prueba de conocimientos (8 preguntas, 100% requerido)
- [x] Sistema de semáforo (rojo/naranja/verde) por estado de prueba
- [x] QR real generado con react-qr-code y token guardado en Supabase
- [x] Invalidación de QR anteriores al generar uno nuevo
- [x] QR bloqueado si prueba no aprobada
- [x] Pestaña Reglamento permanente en app del piloto
- [x] Panel admin con login propio
- [x] Bandera roja funcional en panel admin (con log)
- [x] Barra de capacidad de pista
- [x] Lista de pilotos en sesión con estados editables
- [x] Log de acciones en tiempo real
- [x] Geocerca dibujable en panel de configuración
- [x] Selector de autódromo (5 opciones)
- [x] Configuración de máximo de pilotos y saldo mínimo
- [x] Botones de simulación ocultos en producción
- [x] Deployed en Vercel (autodromo-app.vercel.app)
- [x] Base de datos con 6 tablas y RLS configurado

---

## 13. FUNCIONALIDADES PENDIENTES (por orden de prioridad)

### CRÍTICO — Próxima sesión:
- [ ] Conectar panel admin con Supabase (reemplazar datos hardcodeados)
- [ ] Escaneo QR real con cámara en panel admin (html5-qrcode)
- [ ] Resultado de validación con datos reales del piloto
- [ ] Piloto escaneado aparece en lista operativa del admin
- [ ] Autenticación real del admin (no solo demo hardcoded)

### IMPORTANTE:
- [ ] GPS real y geocerca funcional
- [ ] Estado automático en_pista/box según GPS
- [ ] Detección de vehículo detenido en pista (alerta de seguridad)
- [ ] Sistema de jornadas gestionado por admin

### DESPUÉS:
- [ ] Pagos reales (Webpay o MercadoPago)
- [ ] Carga de saldo real
- [ ] Subida real de licencia de conducir
- [ ] Historial de sesiones del piloto
- [ ] Tiempo de vuelta y velocidad máxima
- [ ] Notificaciones push
- [ ] App nativa iOS/Android (actualmente web app responsive)
- [ ] Telemetría básica

---

## 14. DECISIONES TÉCNICAS IMPORTANTES YA TOMADAS

1. **Web app responsive primero, no app nativa** — decisión tomada para velocidad de desarrollo. La app funciona desde celular sin App Store.

2. **Next.js App Router** — se usó `create-next-app` con TypeScript, Tailwind, App Router.

3. **Supabase** — elegido sobre Firebase por mejor soporte SQL y Row Level Security más granular.

4. **Token QR formato:** `QR-{piloto_id}-{timestamp}-{random6chars}` — único por piloto, invalidable, trazable.

5. **Prueba por jornada, no por 24h** — el admin activa la jornada, no el reloj. Más flexible para eventos de un día.

6. **Sin patente de vehículo** — decisión explícita, no agregar.

7. **Sin categoría en registro** — puede agregarse después con sistema de niveles según uso acumulado.

8. **Botones de simulación ocultos con `hidden`** — no eliminados, solo ocultos, para facilitar testing futuro.

9. **Vercel free tier** — suficiente para fase piloto. Región: East US (North Virginia).

10. **Supabase free tier** — suficiente para fase piloto. Compute: Nano.

---

## 15. REGLAS OPERACIONALES DEL SISTEMA (lógica de negocio)

```
1. Cada salida de geocerca cierra la tanda automáticamente
2. Para reingresar siempre se necesita QR nuevo
3. El piloto NO puede detener el cobro dentro de la geocerca
4. Solo el director pausa el cobro (bandera roja o cierre manual)
5. Vehículo detenido dentro de pista: cobro continúa
6. Si pista llena: QR da error, piloto espera
7. Si bandera roja activa: nuevos ingresos bloqueados
8. QR válido para un solo ingreso
9. Prueba de conocimientos debe aprobarse antes de cada jornada
10. Saldo mínimo configurable (default 5 min) para ingresar
```

---

## 16. PROBLEMAS CONOCIDOS

1. **Panel admin usa datos hardcodeados** — los pilotos Marcos Reyes, Camila Araya, etc. son ficticios. Pendiente conexión con Supabase.

2. **Login admin hardcodeado** — admin@autodromo.cl / admin123 está en el código. Pendiente autenticación real.

3. **Escaneo QR es simulación** — la cámara no escanea realmente todavía. Pendiente html5-qrcode.

4. **GPS no implementado** — el mapa en panel admin es visual/estático. No hay geocerca funcional aún.

5. **Subida de licencia es placeholder** — el botón existe pero no sube archivo real a Supabase Storage.

6. **Pagos son placeholder** — los botones de Webpay y MercadoPago no están conectados.

7. **Conflicto de políticas RLS** — puede haber conflicto entre política de piloto y política de admin en tabla qr_tokens. Verificar al implementar escaneo real.

8. **nvm no persiste entre sesiones de Terminal** — cada vez que se abre una nueva pestaña hay que correr `source ~/.nvm/nvm.sh` para activar Node.

---

## 17. RIESGOS FUTUROS

1. **Supabase free tier limits** — 500MB DB, 2GB bandwidth. Con GPS polling cada 3s puede saturarse rápido en eventos grandes.

2. **GPS accuracy en pista** — GPS de celular tiene margen de ±10m. En pistas estrechas puede dar falsos positivos/negativos en la geocerca.

3. **Conectividad en autódromo** — algunos autódromos chilenos tienen señal débil. El sistema necesita funcionar con conectividad limitada.

4. **Seguridad del token QR** — el token actual es predecible en estructura. Considerar JWT firmado para producción.

5. **Escalabilidad del panel admin** — actualmente asume un solo admin activo. Eventos grandes pueden tener múltiples directores de pista.

6. **Tiempo real sin WebSockets** — actualmente no hay realtime. El panel admin necesita refrescar manualmente para ver cambios. Supabase Realtime debe configurarse.

---

## 18. PARTES DEFINITIVAS vs PROTOTIPO

### Definitivas (no cambiar):
- Arquitectura dos mundos (piloto / admin)
- Flujo de registro (datos + vehículo opcional + términos + prueba)
- Sistema de semáforo por estado de prueba
- Regla de prueba por jornada
- QR de un solo uso
- Lógica de validarQRToken()
- Autódromos configurados con coordenadas reales
- Sistema de banderas (colores y significados)
- 8 preguntas de la prueba (pueden editarse, no eliminarse)

### Prototipo (puede cambiar):
- Diseño visual del panel admin
- Diseño visual de la app del piloto
- Login admin hardcodeado
- Datos de pilotos en panel admin
- Mapa GPS (actualmente SVG estático)
- Geocerca (actualmente dibujable pero no funcional)
- Precios de paquetes de minutos

---

## 19. PRÓXIMA SESIÓN — PASO INMEDIATO

**Tarea:** Conectar panel admin con datos reales + escaneo QR funcional

**Comandos necesarios al inicio:**
```bash
source ~/.nvm/nvm.sh  # activar Node
cd autodromo-app      # entrar al proyecto
npm run dev           # iniciar servidor local
```

**Librerías a instalar:**
```bash
npm install html5-qrcode
```

**Archivos a modificar:**
1. `app/admin/page.tsx` — reemplazar datos hardcodeados con llamadas a Supabase
2. Implementar escaneo real con html5-qrcode
3. Conectar validarQRToken() con resultado visual

**Para hacer deploy después de cambios:**
```bash
git add .
git commit -m "descripcion del cambio"
git push origin main
# Vercel despliega automáticamente
```

---

## 20. CONTEXTO PERSONAL DEL PROPIETARIO

- Nombre: Felipe Schmauk
- GitHub: felipeschmauk-sys
- Correo: felipe.schmauk@gmail.com
- Perfil: Piloto profesional, instructor de automovilismo en Chile
- Mac con Apple Silicon (MacBook Air)
- Usa Safari como navegador principal
- Terminal con zsh + conda (base)
- Sin experiencia previa en programación al inicio del proyecto
- El proyecto se desarrolló íntegramente con asistencia de IA (Claude)

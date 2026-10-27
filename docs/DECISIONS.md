
## DECISION: Stack de QR Scanner — 26 Mayo 2026

**Decisión:** Usar `@zxing/browser` en vez de `html5-qrcode`

**Motivo:** `html5-qrcode` está abandonada desde 2023 y tiene problemas serios con Next.js App Router (SSR crashes). `@zxing/browser` es la librería subyacente, activamente mantenida y con mejor soporte TypeScript.

---

## DECISION: Legacy Anon Key de Supabase — 26 Mayo 2026

**Decisión:** Usar la key legacy `eyJ...` en vez de la nueva `sb_publishable_...`

**Motivo:** Supabase lanzó un nuevo sistema de API keys pero la key nueva no funciona correctamente con el cliente `@supabase/supabase-js` actual. Mientras no migren completamente, usar la key legacy desde **Settings → API Keys → Legacy anon, service_role API keys**.

---

## DECISION: RLS desactivado temporalmente — 26 Mayo 2026

**Decisión:** Se desactivó RLS en tabla `qr_tokens`

**Motivo:** Las políticas existentes no permitían al admin (no autenticado en Supabase Auth) leer los tokens. Solución temporal para pruebas.

**Acción pendiente:** Reactivar RLS con política que permita lectura anónima para validación de tokens, o autenticar el admin con Supabase Auth.

---

## DECISION: Validaciones QR desactivadas temporalmente — 26 Mayo 2026

**Decisión:** Se comentaron las validaciones de saldo mínimo y prueba de jornada en `validarQRToken`

**Motivo:** Pruebas sin saldo cargado. Reactivar cuando haya sistema de carga de minutos funcionando.

# DECISIONS.md
# Registro de Decisiones Técnicas — Autódromo App

Formato: fecha · decisión · razón · alternativa descartada

---

## Mayo 2026

### Web app responsive, no app nativa
**Decisión:** Desarrollar como web app (Next.js) accesible desde celular, no como app nativa iOS/Android.
**Razón:** Velocidad de desarrollo, sin necesidad de App Store, funciona en cualquier dispositivo con navegador.
**Alternativa descartada:** React Native — demasiado complejo para fase inicial.
**Revisión futura:** Evaluar después de validar el modelo de negocio en uso real.

### Supabase sobre Firebase
**Decisión:** Usar Supabase como base de datos y autenticación.
**Razón:** Mejor soporte SQL, Row Level Security más granular, gratis para fase piloto, interfaz visual más clara.
**Alternativa descartada:** Firebase — NoSQL menos adecuado para relaciones entre pilotos/sesiones/QR.

### Prueba de conocimientos por jornada, no por 24 horas
**Decisión:** La prueba se renueva cuando el admin abre una nueva jornada, no automáticamente cada 24h.
**Razón:** Los eventos de automovilismo en Chile raramente son dos días consecutivos. El admin tiene control total de cuándo se renueva.
**Implicación:** El admin debe abrir una jornada explícitamente al inicio de cada evento.

### 100% en prueba de conocimientos (no 80%)
**Decisión:** El piloto necesita responder correctamente las 8 preguntas para habilitarse.
**Razón:** La seguridad en pista no admite margen de error en conocimiento de banderas y normas.
**Alternativa descartada:** 80% — inaceptable desde perspectiva de seguridad operacional.

### QR de un solo uso
**Decisión:** Cada QR es válido para exactamente un ingreso. Al confirmarse, queda invalidado.
**Razón:** Evita que un QR sea reutilizado o compartido entre pilotos.
**Implicación:** El piloto debe generar un QR nuevo cada vez que quiera ingresar a pista.

### Sin patente de vehículo en registro
**Decisión:** El registro de vehículo solo pide marca y modelo, no patente.
**Razón:** La patente no agrega valor operacional en la primera fase. Puede agregarse después.

### Sin categoría en registro
**Decisión:** No se pide categoría (amateur/sport/competición) en el registro inicial.
**Razón:** Se plantea un sistema futuro donde la categoría sube automáticamente según uso acumulado de la app.

### Botones de simulación ocultos con `hidden`, no eliminados
**Decisión:** Los botones de test en el panel admin se ocultan con `className="hidden"`, no se borran del código.
**Razón:** Facilita testing durante desarrollo sin tener que reescribir código. En producción no se ven.

### Token QR formato texto simple
**Decisión:** `QR-{piloto_id}-{timestamp}-{random6chars}`
**Razón:** Simple, trazable, suficiente para fase piloto.
**Revisión futura:** Considerar JWT firmado para mayor seguridad en producción real.

### Vercel + Supabase free tier
**Decisión:** Usar planes gratuitos de ambas plataformas para fase piloto.
**Razón:** Costo cero, suficiente capacidad para validar el sistema.
**Límites actuales:** Supabase 500MB DB / 2GB bandwidth. Vercel sin límite de builds.
**Revisión futura:** Upgradear cuando haya uso real sostenido.

### Dos rutas separadas (/ y /admin)
**Decisión:** App piloto en `/`, panel admin en `/admin`. Sin navegación cruzada.
**Razón:** Separación clara de mundos. El piloto nunca ve ni accede al panel operacional.

### Vehículos opcionales en registro
**Decisión:** El campo de vehículo es opcional durante el registro.
**Razón:** Reduce fricción inicial. El piloto puede agregar vehículos después desde su perfil.

### Sentido de giro = orden de los puntos del trazado (15 Octubre 2026)
**Decisión:** El sentido de giro de un circuito no se guarda como un dato aparte. Es el orden de los puntos de `trazado_coords`: los autos recorren el punto 0, luego el 1, el 2... Para cambiarlo, el botón de Config → Sectores invierte ese orden y reubica la meta, los sectores y la meta de las tandas al mismo lugar físico (`invertirSentidoCircuito` en `lib/gps.ts`).
**Razón:** Todo lo que depende del sentido —detector de cruces, sectores, diferencias, bandera azul, replay— ya trabaja sobre el orden de los puntos. Corregir el dato en el origen deja todo eso funcionando sin tocarlo. El horario/antihorario que muestra el panel se calcula del trazado (área con signo), así que el rótulo y el comportamiento nunca pueden contradecirse.
**Alternativa descartada:** Una columna `sentido` en `circuitos` que cada pantalla interprete. Obliga a modificar el detector de cruces, los sectores, los mapas, las diferencias y el replay, y basta con que uno se olvide de mirarla para que el cronometraje deje de contar vueltas sin avisar.

### Orden de carrera: mismo instante + adelantamiento confirmado (15 Octubre 2026)
**Decisión:** El panel ordena a los autos llevándolos todos al mismo instante (cada uno se adelanta con su velocidad reciente desde su última lectura, máx. 2 s) y un cambio de posición estrecho solo se acepta si se sostiene 2,5 s o la ventaja supera 25 m (`ordenEstable` en `lib/gaps.ts`). Posiciones y diferencias salen de ese mismo orden.
**Razón:** Las lecturas de GPS de los teléfonos no están sincronizadas: hasta 1 s (~28 m) entre dos autos. Comparar la última lectura de cada uno invertía autos pegados de forma SOSTENIDA, no intermitente. La estabilidad sola (idea inicial de Felipe) habría congelado el orden equivocado; por eso primero se corrige la causa y la estabilidad va encima, para el error de unos metros del GPS.
**Alternativa descartada:** Solo histéresis sobre el orden crudo, o decidir por "porcentaje del tiempo adelante". Ambas promedian un error sistemático en vez de eliminarlo.

### "Quién me dobla" se mide en distancia, no en vueltas (15 Octubre 2026)
**Decisión:** La bandera azul y el "ya me pasó" comparan el recorrido total, no los contadores de vueltas.
**Razón:** Los contadores saltan en la meta. Si el doblado cruza antes que el doblador, quedan iguales unos segundos y la azul se apagaba con el puntero encima.

### Banderas desde cualquier vista; una sola vez lo que tiene memoria (27 Octubre 2026)
**Decisión:** Cualquier panel abierto puede poner banderas y la última escritura manda. Lo que tiene que pasar exactamente una vez —abrir la tanda, cerrarla, marcar la largada, reclamar un sector para la amarilla automática— se resuelve con una condición en la base, no con un candado en memoria del navegador.
**Razón:** Las banderas ya viajan por una fila de `estado_pista` / `sectores_pista` y el teléfono las lee con `postgres_changes`: son idempotentes y el último toque gana sin dañar nada. Eso es justamente lo que permite dejar el PC en la torre y bajar a boxes a operar desde el teléfono. Los candados en memoria, en cambio, no se ven entre paneles: en Interlomas dos paneles con la lista de tandas vacía crearon dos "Libre 4" y los dos repitieron el cierre.
**Alternativa descartada:** Un "admin principal" y los demás como veedores sin poder de escritura. Quita la flexibilidad que se necesita en pista y no resuelve nada: el problema no son los botones —que son idempotentes— sino el cálculo duplicado y las acciones con memoria.

### La amarilla automática se apaga antes que adivinar (27 Octubre 2026)
**Decisión:** Si falta la columna `sectores_pista.auto_amarilla_piloto_id`, la amarilla automática se desactiva y el panel lo dice en pantalla. No hay camino de respaldo que la ponga sin registrar dueño.
**Razón:** El respaldo tendría que volver a guardar el dueño en memoria del navegador, que es el problema que se está arreglando, y sería un segundo camino que solo corre en los minutos que pasan entre desplegar y correr el SQL — nunca probado en pista. Una función de seguridad apagada y visible es más segura que una que funciona a medias sin avisar. Las banderas por sector se siguen poniendo a mano.


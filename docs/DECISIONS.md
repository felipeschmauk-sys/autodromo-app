
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

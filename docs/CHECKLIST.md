
## CHECKLIST DE SEGURIDAD — Antes de lanzar a producción

### 1. Reactivar RLS en Supabase
Ir a **Authentication → Policies** y reactivar RLS en estas tablas:

- `qr_tokens` — política: permitir SELECT anónimo solo para validar token, INSERT/UPDATE solo al dueño
- `sesiones` — política: solo el admin puede INSERT/UPDATE/DELETE
- `pilotos` — política: cada piloto ve solo su fila, admin ve todas
- `vehiculos` — política: cada piloto ve solo sus vehículos

### 2. Reactivar validaciones en `lib/auth.ts`
Descomentar en `validarQRToken`:
- Validación de saldo mínimo (líneas ~129-131)
- Validación de prueba aprobada hoy (líneas ~135-137)

### 3. Cambiar credenciales admin
En `app/admin/page.tsx` el login está hardcodeado:
- Email: `admin@autodromo.cl`
- Password: `admin123`

Cambiar a autenticación real con Supabase Auth antes de lanzar.

### 4. Variables de entorno en Vercel
Confirmar que `NEXT_PUBLIC_SUPABASE_ANON_KEY` usa la key legacy `eyJ...` y no la `sb_publishable_...`

### 5. Tabla `qr_tokens` — limpiar tokens viejos
Hay tokens con `piloto_id: null` generados durante pruebas. Limpiar con:
```sql
DELETE FROM qr_tokens WHERE piloto_id IS NULL;
```

### 6. Probar flujo completo en producción
- Piloto se registra → aprueba prueba → genera QR → admin escanea → piloto aparece en pista → admin confirma ingreso

---

¿Quieres que sigamos trabajando en el bug del QR o lo dejamos para la próxima sesión?

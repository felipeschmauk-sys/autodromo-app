# SESSION_STARTER.md
# Plantilla para iniciar cada sesión de trabajo

---

## PROMPT DE INICIO (copiar y pegar al abrir conversación nueva)

---

Estoy trabajando en una app de control de acceso a pista para autódromos en Chile.
Por favor lee el siguiente contexto completo antes de continuar:

[PEGAR AQUÍ EL CONTENIDO COMPLETO DE docs/PROJECT_CONTEXT.md]

Estamos en la siguiente etapa:
[DESCRIBIR BREVEMENTE QUÉ QUIERES HACER HOY]

Tengo VS Code abierto con el proyecto `autodromo-app`.
El servidor local está corriendo en localhost:3000.
Si necesito ejecutar comandos, uso la Terminal con:
- source ~/.nvm/nvm.sh (para activar Node si es necesario)
- cd autodromo-app (para entrar al proyecto)

---

## RECORDATORIO AL CERRAR CADA SESIÓN

Antes de cerrar la conversación, pide a Claude que te ayude a actualizar los siguientes documentos según lo que hiciste hoy:

---

### ✅ SIEMPRE actualizar:

**docs/PROJECT_CONTEXT.md**
- Sección "Funcionalidades completadas" → agregar lo que se terminó hoy
- Sección "Funcionalidades pendientes" → actualizar prioridades
- Sección "Problemas conocidos" → agregar o resolver problemas
- Sección "Próxima sesión" → escribir exactamente qué hay que hacer la próxima vez

**docs/CHANGELOG.md**
- Agregar entrada con la versión y fecha de hoy
- Listar: qué se agregó, qué se cambió, qué se corrigió

---

### 🔄 Actualizar SI corresponde:

**docs/DECISIONS.md**
→ Si se tomó alguna decisión técnica importante hoy
→ Formato: fecha · decisión · razón · alternativa descartada

**docs/QR_FLOW.md** *(cuando exista)*
→ Si cambió algo en la lógica del QR o del flujo de ingreso

**docs/ADMIN_GUIDE.md** *(cuando exista)*
→ Si cambió la interfaz o flujo del panel admin

---

### 📋 Checklist antes de cerrar:

- [ ] Hice `git commit` con descripción clara de los cambios
- [ ] Hice `git push origin main`
- [ ] Verifiqué que Vercel desplegó correctamente
- [ ] Actualicé PROJECT_CONTEXT.md
- [ ] Actualicé CHANGELOG.md
- [ ] Actualicé DECISIONS.md si corresponde
- [ ] Anoté en "Próxima sesión" exactamente dónde quedé

---

## COMANDOS FRECUENTES

```bash
# Activar Node (si es nueva pestaña de Terminal)
source ~/.nvm/nvm.sh

# Entrar al proyecto
cd autodromo-app

# Iniciar servidor local
npm run dev

# Ver en navegador
# localhost:3000 → app piloto
# localhost:3000/admin → panel admin

# Subir cambios a GitHub y Vercel
git add .
git commit -m "descripcion clara del cambio"
git push origin main

# Instalar nueva librería
npm install nombre-libreria
```

---

## ESTADO RÁPIDO DEL PROYECTO

| Componente | Estado |
|---|---|
| App piloto | ✅ Funcional con Supabase |
| Registro/Login real | ✅ Funcionando |
| QR real | ✅ Generado con react-qr-code |
| Prueba de conocimientos | ✅ Funcional |
| Panel admin | ⚠️ Funcional pero con datos demo |
| Escaneo QR con cámara | ❌ Pendiente |
| GPS / Geocerca real | ❌ Pendiente |
| Pagos | ❌ Pendiente |

---

## CREDENCIALES RÁPIDAS

```
App piloto:    autodromo-app.vercel.app
Panel admin:   autodromo-app.vercel.app/admin
Admin demo:    admin@autodromo.cl / admin123
GitHub:        felipeschmauk-sys/autodromo-app
Supabase:      etrzcvbvypivgraazonk.supabase.co
```

SESSION_STARTER.md:
Es tu documento de referencia personal. Al iniciar cada sesión nueva con Claude, abre ese archivo, copia el prompt de inicio, pega el contenido de PROJECT_CONTEXT.md donde indica, y describe qué quieres hacer ese día. Al terminar, sigue el checklist al final.
El flujo completo queda así:

Abres conversación nueva
Copias el prompt de SESSION_STARTER
Pegas PROJECT_CONTEXT.md completo
Describes la tarea del día
Trabajas
Al terminar, actualizas los docs según el checklist
Haces commit y push




Checklist inicio de sesión
1. Abrir conversación nueva con Claude
2. Copiar y pegar este prompt:

"Estoy trabajando en una app de control de acceso a pista para autódromos en Chile. Lee el siguiente contexto antes de continuar: [PEGAR CONTENIDO DE docs/PROJECT_CONTEXT.md] — Tarea de hoy: [DESCRIBIR QUÉ QUIERES HACER]"

3. Antes de escribir código, verificar en Terminal:
source ~/.nvm/nvm.sh
cd autodromo-app
npm run dev

Checklist cierre de sesión
1. Subir cambios a GitHub:
git add .
git commit -m "descripcion del cambio"
git push origin main
2. Verificar que Vercel desplegó → autodromo-app.vercel.app
3. Actualizar docs/PROJECT_CONTEXT.md:

¿Qué terminé hoy? → agregar a "Funcionalidades completadas"
¿Qué falta? → actualizar "Funcionalidades pendientes"
¿Qué problema encontré? → agregar a "Problemas conocidos"
¿Qué hago la próxima vez? → actualizar "Próxima sesión"

4. Actualizar docs/CHANGELOG.md:

Agregar entrada con fecha y qué cambió

5. Si tomé una decisión técnica importante:

Agregar a docs/DECISIONS.md


Credenciales rápidas para tener a mano
App piloto:   autodromo-app.vercel.app
Panel admin:  autodromo-app.vercel.app/admin
Admin demo:   admin@autodromo.cl / admin123
GitHub:       felipeschmauk-sys/autodromo-app

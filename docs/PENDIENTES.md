# Pendientes

Cosas identificadas y **no construidas**. Cada una con el contexto suficiente
para retomarla sin volver a deducir por qué existe.

No es el roadmap del producto (eso es `ROAD_MAP`) ni el registro de decisiones
tomadas (`DECISIONS.md`): son cabos sueltos con dueño claro.

---

## Auto de seguridad visible en tiempo real

**Qué:** que el pace car tenga su propia cuenta y que su posición se vea como un
punto en la pantalla de todos los pilotos, en vivo. Cada piloto sabría
exactamente dónde está el auto de seguridad durante la neutralización. Y cuando
la neutralización termina, alguna señal que lo anuncie.

**Por qué:** hoy la bandera de safety car dice que hay neutralización pero no
dónde está el auto. El piloto no sabe si lo tiene a diez metros o a media
vuelta, que es justo lo que necesita para saber a qué ritmo ir y dónde formarse.

**Por dónde empezar:** el camino ya está abierto. El 27 sep se construyó el
reparto de **autos detenidos** (`AutoDetenido` en `lib/posiciones.ts`), que
manda posiciones de terceros a la pantalla del piloto dentro del mensaje de
estado que el panel ya emite cada segundo. El pace car usa exactamente ese
mecanismo:

1. Marcar una sesión o un piloto como pace car (un campo, no una tabla nueva)
2. Incluir su posición en el mensaje de estado, igual que los detenidos
3. Dibujarlo en `PizarraLandscape` con un marcador propio — naranjo `#c2570b`,
   que es el color que el sistema ya usa para safety car
4. El piloto no recibe posiciones de los demás y eso **no debe cambiar**: el
   pace car es una excepción deliberada, como los autos detenidos

**Lo que falta definir:** cómo se anuncia el fin de la neutralización. En
reglamento se avisa una vuelta antes ("safety car in this lap") y recién después
cae el verde. Eso es un estado intermedio que hoy no existe, y probablemente sea
más importante que el punto mismo: el piloto necesita saber que la
neutralización está por terminar, no enterarse cuando ya terminó.

**No se puede probar todavía:** requiere un auto de seguridad real con un
teléfono a bordo.

---

## Anular la vuelta en curso durante una bandera roja

Si alguien va a mitad de vuelta cuando cae la roja, esa vuelta queda registrada
con un tiempo enorme y contamina la mejor vuelta y la tabla. En cronometraje
real esa vuelta se anula.

Quedó pendiente al construir la pausa del cronómetro (0.31.0) porque es un
problema aparte: ese cambio detuvo el reloj de la tanda, no tocó las vueltas
individuales.

---

## El tramo de 586 m del trazado de Las Vizcachas

El trazado tiene los puntos cada 17 a 42 metros en casi todo el recorrido, y un
salto de **586 metros** entre el punto 24 y el 0 — el 36% de la vuelta.

No se confirmó en terreno si la pista va recta ahí. Si va recta está perfecto; si
dobla, el trazado corta camino y las **diferencias entre autos salen
distorsionadas en esa zona**, porque se calculan en metros recorridos.

Se revisa en menos de un minuto: abrir Config → Sectores y mirar si la línea
sigue el asfalto sobre el satélite. El conteo de vueltas no debería verse
afectado, porque la meta está en un tramo bien mapeado.

---

## El punto de auto detenido no aparece en la vista vertical

Se construyó para el modo conducción, que dibuja su propio SVG. La vista
vertical usa el mapa de Leaflet y ahí el punto no está.

Si un piloto puede estar en vista vertical durante una tanda, tiene el mismo
derecho a esa advertencia.

---

## El mapa de Dirección se apaga al cambiar de pestaña

Desde 0.32.0 el cronometraje está siempre montado, pero el mapa no: al irse a
otra pestaña, la **amarilla automática deja de correr**.

En la práctica importa poco porque ahora se opera todo desde Dirección, donde
las dos cosas están vivas. Se dejó así porque Leaflet escondido con `display`
tiene sus propias mañas al reaparecer (hay que invalidar el tamaño).

---

## Dos categorías compitiendo a la vez

Toda la lógica de clasificación por categoría está construida y **nunca se probó
con más de una**. Sin eso no se ha verificado: la posición separada por
categoría, el piloto sin categoría en lista de espera, el filtro por categoría al
descargar resultados, ni que las diferencias crucen entre categorías distintas.

---

## Panel en la nube

Hoy el ciclo que calcula posiciones y banderas vive en una pestaña del navegador:
si ese equipo se duerme o pierde señal, los pilotos se quedan sin nada. Pasó el
27 sep con el notebook viajando dentro de un auto.

La conversación completa —opciones evaluadas, por qué un proceso chico siempre
encendido es el camino, y por qué no arregla la cobertura del autódromo— está en
el historial. Lo esencial: `lib/gaps.ts`, `lib/trazado.ts` y `lib/carrera.ts` son
TypeScript puro sin nada del navegador, así que se mudan sin cambios. Lo único
acoplado a React es de dónde salen las categorías.

---

## Secuelas del incidente del 4 de octubre

El análisis está en `docs/INCIDENTE_2026-10-04.md` y los tres arreglos ya están
aplicados. Quedan tres cabos:

- **Confirmar en pista.** Falta una jornada con pelotón completo donde una
  amarilla automática no corte nada. Hasta entonces, las banderas se avisan
  también por radio: viajan por el mismo canal de tiempo real
- **El panel todavía recarga la tabla entera de sectores** en cada cambio
  (`components/DireccionCarrera.tsx` y `app/admin/page.tsx`). Son dos clientes
  en el PC, no doce teléfonos, así que hoy no hace daño — pero si el panel
  alguna vez corre en la nube con varios puestos, hay que aplicarle lo mismo que
  al teléfono
- **Buscar el mismo patrón en el resto del proyecto:** consultas que leen solo
  `data` y descartan el `error`, tratando un fallo como un dato válido. Esa fue
  la causa raíz y no hay razón para suponer que aparece una sola vez

---

## Antes de publicar en las tiendas

- **Borrado de cuenta dentro de la app.** Es obligatorio y hoy no existe: rechazo
  automático. Hay que decidir qué pasa con los tiempos de un piloto borrado —
  lo razonable es anonimizar y no borrar, porque son registro de competencia
- **Auditar las políticas de acceso de Supabase.** Al menos la migración de
  categorías usa `USING (true) WITH CHECK (true)`. En una app publicada la llave
  va dentro del binario
- **Atribución de los mapas.** Los cinco mapas la ocultan con `display:none`, y
  tanto Esri como OpenStreetMap la exigen en sus términos
- **Decidir el cobro de inscripciones.** Un servicio del mundo real está exento
  de la comisión de las tiendas, pero el flujo tiene que mostrar de forma
  evidente el evento, el lugar y la fecha

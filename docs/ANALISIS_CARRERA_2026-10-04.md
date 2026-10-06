# Análisis de la Carrera 2 del 4 de octubre de 2026

Primera vez que hay **acta oficial de cronometraje profesional** para contrastar.
Eso convierte esta carrera en el patrón de referencia del sistema.

Datos: Codegua AIC, Turismo Carretera, Carrera 2, largada 14:47:33 (acta) /
14:47:34 (sistema). Export completo en `exportes/` vía `exportar-prueba.mjs`.

**Contexto que cambia la lectura:** Sebastián Vera, ganador, corrió **sin
teléfono** (batería agotada antes de largar). Otros pilotos también iban sin
equipo. El sistema nunca lo vio, así que su "líder" era Iván del Pino.

---

## 1. Lo que funcionó

### El detector de vueltas es exacto

Sobre la traza guardada, la lógica actual detecta los cruces sin un solo error:

| | |
|---|---|
| Cruces falsos | **0** |
| Vueltas perdidas por mala detección | **0** |
| Retrocesos de progreso que no fueran cruce | **0** |

Los tiempos calzan con el acta oficial casi al milisegundo:

| Piloto | Sistema | Acta | Diferencia |
|---|---|---|---|
| Alexis Facusse | 1:05.956 | 1:05.956 | **0 ms** |
| Nicolas Juri | 1:09.441 | 1:09.442 | 1 ms |
| Iván del Pino | 1:05.249 | 1:05.220 | 29 ms |
| Matias Berndt | 1:10.932 | 1:10.899 | 33 ms |
| Martin Vargas | 1:09.930 | 1:09.981 | 51 ms |

El cruce n°13 de Iván quedó registrado a las **14:59:49**. El acta le da
12:17.081 desde las 14:47:33, o sea 14:59:50. **Un segundo.**

### La bandera azul está bien calculada

Replay de la carrera completa contra la lógica de `lib/gaps.ts`: la azul se
encendió **únicamente a los cuatro autos que estaban siendo doblados de verdad**
(Berndt, Eyzaguirre, Pato Labbe, Pablo Olmedo). A Iván **nunca**. Él siempre fue
el que doblaba.

Tampoco hubo bandera personal azul: la única personal del día fue "A taller →
Martin Vargas" a las 14:54:55.

---

## 2. Por qué Iván vio una azul yendo segundo

La lógica es correcta, pero el **número de vueltas que su teléfono transmitía**
no lo era.

El teléfono lleva su propia cuenta en `cronoRef.current.cruces`, un arreglo con
los instantes de sus cruces, y transmite `vu` así
([app/page.tsx:2141](../app/page.tsx)):

```js
vu: vueltasDeCarrera(cronoRef.current.cruces, tanda?.largadaMs ?? null)
```

Ese arreglo se vacía cada vez que el detector se reinicia
([app/page.tsx:1792](../app/page.tsx)):

```js
cronoRef.current = { …, numero: 0, cruces: [], … };
```

Y el reinicio ocurre siempre que `tandaPilotoRef.current` pasa por `null` y
vuelve — entre otras cosas, **en la limpieza del propio efecto**
([app/page.tsx:1870](../app/page.tsx)), que corre cada vez que cambia `stage`,
`eventoActivo.fechaId` o `pilotoData.id`; y también si la app se recarga.

Después del reinicio hay una recuperación desde la base… **pero solo repone
`numero` y `ultimoCruceMs`, no `cruces`**:

```js
.then(({ data }) => {
  const u = data?.[0];
  if (u && tandaPilotoRef.current?.id === t.id) {
    cronoRef.current.numero        = u.numero;
    cronoRef.current.ultimoCruceMs = new Date(u.cruce_at).getTime();
  }   // ← `cruces` queda vacío para siempre
});
```

Resultado: tras un reinicio el teléfono transmite **`vu = 0`** mientras el resto
va en la vuelta 7. En `calcularGaps` la condición de la azul es

```js
if (otro.vueltas <= yo.vueltas) continue   // no me está doblando
```

Con `vu = 0`, **todos los autos de la pista lo están doblando**. Bandera azul
permanente para el segundo de la carrera.

### Por qué le tocó a Iván y no a otro

Su teléfono fue el único que se cortó. Medido sobre `ubicaciones_piloto` en la
ventana de la carrera:

| Piloto | Filas escritas | Pares a menos de 1 s | Cortes > 10 s |
|---|---|---|---|
| **Iván del Pino** | **372** | **55** | **4 (el peor de 47 s)** |
| Todos los demás | exactamente 360 | 0 a 2 | 0 o 1 |

Y el log lo confirma: `📶 Iván del pino recuperó señal en pista`, **tres veces a
las 14:50:23**.

Esos cortes son del mismo defecto corregido el 4-10-2026 en
`docs/INCIDENTE_2026-10-04.md`: una consulta de sesión caída apagaba el GPS. El
arreglo de ese día ataca la causa de los cortes; **el `vu = 0` sigue vivo** y se
dispara con cualquier reinicio del detector, no solo con un corte de señal.

---

## 3. La carrera se cerró 104 segundos antes de tiempo

| Hora | Qué pasó |
|---|---|
| 14:43:08 | Tanda abierta · "15 min · 15 vueltas" |
| 14:47:34 | **Largada** |
| 14:58:10 | Sistema: bandera a cuadros **automática** y tanda finalizada |
| 14:58:17 | Bandera global vuelta a verde (a mano) |
| **14:59:54** | **Bandera a cuadros real** |

Los 15 minutos se contaron **desde que se abrió la tanda**, no desde la largada.
Los 4 minutos 26 segundos de grilla y formación se comieron la carrera.

Consecuencia directa en el resultado: a casi todos les falta **una vuelta**
respecto del acta.

| | Acta | Sistema |
|---|---|---|
| Iván del Pino | 11 | 10 |
| Alexis Facusse | 11 | 10 |
| Martin Vargas, Juri, Pérez, Naser, Feres | 11 | 10 |
| Berndt, Eyzaguirre | 10 | 10 |

La vuelta existe en la traza de cada teléfono — el cruce n°13 de Iván está
guardado a las 14:59:49. Lo que falta es que el sistema la contara, porque para
él la carrera ya había terminado.

**Decisión pendiente de Felipe:** el reloj de carrera debe correr desde la
largada, no desde la apertura de la tanda. Es una regla deportiva, no un detalle
técnico, y la define él.

---

## 4. Lo que no se puede cerrar con estos datos

No queda registro de **qué bandera vio realmente cada piloto**. La azul de Iván
se reconstruyó por deducción: la lógica es correcta, su teléfono se cortaba, y el
`vu = 0` produce exactamente ese síntoma. Pero no hay una línea en la base que
diga "a las 14:52:10 el teléfono de Iván mostró azul".

Mientras eso no exista, cualquier reclamo de un piloto sobre una bandera es
indemostrable en los dos sentidos.

---

## 5. Errores de método cometidos en este análisis

Para no repetirlos:

- Medí "saltos de GPS > 300 m en menos de 10 s" y reporté 17 saltos de Iván como
  si fueran coordenadas basura. **Estaba mal**: a 110 km/h un auto recorre eso
  legítimamente. Al recalcular por velocidad implícita y revisar las coordenadas
  una por una, ninguna estaba lejos de Codegua y la precisión media era de 4 m.
  Lo que el indicador estaba capturando eran escrituras casi simultáneas — que
  resultaron ser la pista buena, pero por otra razón.
- Crucé el acta contra el sistema por número de auto sin verificar antes que la
  tabla `pilotos` tuviera los números cargados. Están vacíos: el cruce dio
  "el sistema no lo vio" para los 14 pilotos.

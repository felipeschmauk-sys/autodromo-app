// ── Diferencias de tiempo entre pilotos y bandera azul ────────
//
// El gap NO se calcula restando posiciones: se calcula preguntando "¿hace
// cuánto que el de adelante pasó por el punto exacto donde estoy yo ahora?".
// Por eso cada piloto necesita el HISTORIAL del otro, no su posición actual.
//
// Todos los instantes vienen ya en hora de servidor (el desfase de reloj de
// cada teléfono se corrige antes de emitir), así que son comparables entre sí.

/** Una muestra del recorrido de un piloto. */
export interface Muestra {
  /** Instante en hora de servidor (ms) */
  t: number
  /** Metros totales de carrera: (vueltas + progreso) × largo del circuito */
  recorrido: number
}

export interface EstadoPiloto {
  pid: string
  /** Vueltas de carrera completadas */
  vueltas: number
  /** Progreso 0..1 dentro de la vuelta actual, con la meta como origen */
  progreso: number
  /** Instante de su última posición conocida (hora de servidor) */
  t: number
  /** true = dentro de la geocerca de pista. false = boxes → sale del cálculo */
  enPista: boolean | null
  /** Historial reciente, ordenado por t ascendente */
  historia: Muestra[]
}

export interface GapPiloto {
  /** Segundos hasta el competidor de adelante de su misma vuelta. null = va puntero */
  adelante: number | null
  /** Segundos hasta el competidor de atrás de su misma vuelta. null = va último */
  atras: number | null
  /** Bandera azul: lo está por doblar alguien y viene a menos del umbral */
  azul: { pid: string; segundos: number } | null
  /**
   * Pilotos que le sacaban una vuelta y acaban de pasarlo (ya van adelante en
   * pista). Es lo que apaga la bandera azul: no se apaga porque el gap creció,
   * se apaga porque el adelantamiento se consumó. Va por piloto y no como
   * bandera global, porque en pista puede haber varios doblando a la vez y solo
   * debe apagarla el que efectivamente la había encendido.
   */
  pasaronPor: string[]
}

export interface OpcionesGap {
  /** Largo del circuito en metros */
  largo: number
  /**
   * Cómo se resuelve quién va adelante y quién atrás:
   *
   *  · "carrera": por distancia total recorrida. Todos largaron juntos, así que
   *    la distancia acumulada ES la clasificación. Los doblados quedan fuera de
   *    los gaps y se activa la bandera azul.
   *
   *  · "libre" (entrenamiento y clasificación): por POSICIÓN EN PISTA, de forma
   *    circular. Cada uno entró cuando quiso y lleva vueltas distintas, así que
   *    la distancia acumulada no significa nada: lo único que importa es quién
   *    tengo físicamente delante y detrás, sin importar su vuelta ni su
   *    categoría. Sin bandera azul: nadie está doblando a nadie.
   */
  modo?: 'carrera' | 'libre'
  /** Umbral de bandera azul, en segundos */
  umbralAzul?: number
  /** Cuánto puede tener de viejo un piloto para seguir participando (ms) */
  frescuraMs?: number
  /** Ahora, en hora de servidor. Se inyecta para poder replayar carreras */
  ahora?: number
  /**
   * Orden de carrera ya resuelto (pids, del primero al último), normalmente el
   * de `ordenEstable`. Si no se pasa, se ordena por recorrido al instante `ahora`.
   */
  orden?: string[]
}

/** Recorrido total de carrera, en metros. */
export function recorridoTotal(e: { vueltas: number; progreso: number }, largo: number): number {
  return (e.vueltas + e.progreso) * largo
}

// ── Todos los autos en el mismo instante ──────────────────────
//
// Cada teléfono lee el GPS en un momento distinto dentro del segundo, y el
// panel tiene de cada uno su ÚLTIMA lectura: entre dos autos puede haber hasta
// un segundo de diferencia, casi 30 metros a 100 km/h. Ordenar con eso es
// comparar fotos sacadas en momentos distintos. En la simulación de Interlomas
// (15-10-2026) dos autos a 8 m quedaron invertidos 12 segundos seguidos —el
// teléfono del de adelante siempre leía medio segundo antes—: posiciones
// cambiadas en pantalla y una diferencia negativa con el de adelante.
//
// Antes de ordenar, cada auto se adelanta hasta `ahora` con su velocidad de los
// últimos segundos. Esto es solo para ORDENAR: las diferencias de tiempo siguen
// saliendo del historial real de cada uno.

/** Lo máximo que se adelanta un auto. Más allá ya no es un dato, es una suposición. */
export const MAX_ADELANTO_MS = 2000

/** Recorrido total estimado en el instante `ahora`. */
export function recorridoAhora(e: EstadoPiloto, largo: number, ahora: number): number {
  const rec = recorridoTotal(e, largo)
  const h = e.historia
  if (h.length < 2) return rec
  // Velocidad sobre ~3 lecturas y no sobre la última: el error del GPS en una
  // sola lectura mueve la velocidad un 15%
  const ult = h[h.length - 1], ant = h[Math.max(0, h.length - 4)]
  const dt = ult.t - ant.t
  const dd = ult.recorrido - ant.recorrido
  if (dt <= 0 || dd < 0) return rec
  return rec + (dd / dt) * Math.min(Math.max(0, ahora - e.t), MAX_ADELANTO_MS)
}

// ── Orden estable ─────────────────────────────────────────────
//
// Aun comparando en el mismo instante, el GPS tiene unos metros de error: dos
// autos rueda con rueda podrían "intercambiarse" una y otra vez sin que nadie
// haya adelantado. Idea de Felipe: en pantalla, un adelantamiento aparece solo
// cuando es claro que un auto va delante del otro. Un cambio de posición entre
// dos autos se acepta:
//  · al tiro, si la ventaja es clara (más de MARGEN_CLARO_M), o
//  · si se sostiene CONFIRMAR_ORDEN_MS seguidos.
// Así un adelantamiento real con los autos todavía pegados se muestra apenas se
// consolida, y un vaivén de un segundo no mueve las posiciones.

/** Ventaja a partir de la cual un adelantamiento se da por hecho sin esperar. */
export const MARGEN_CLARO_M = 25

/** Cuánto debe sostenerse un adelantamiento estrecho para mostrarse. */
export const CONFIRMAR_ORDEN_MS = 2500

export interface EstadoOrden {
  /** pids del primero al último */
  orden: string[]
  /** "A>B" → desde cuándo B viene delante de A sin confirmarse todavía */
  pendientes: Record<string, number>
}

export function ordenEstable(
  pilotos: EstadoPiloto[],
  largo: number,
  ahora: number,
  previo?: EstadoOrden,
): EstadoOrden {
  const rec = new Map(pilotos.map((p) => [p.pid, recorridoAhora(p, largo, ahora)]))
  const r = (pid: string) => rec.get(pid) ?? 0

  // Se parte del orden anterior; quien aparece por primera vez entra directo
  // en el lugar que le corresponde
  const orden = (previo?.orden ?? []).filter((pid) => rec.has(pid))
  for (const pid of [...rec.keys()].sort((a, b) => r(b) - r(a))) {
    if (orden.includes(pid)) continue
    const i = orden.findIndex((o) => r(o) < r(pid))
    if (i < 0) orden.push(pid); else orden.splice(i, 0, pid)
  }

  const pendientes: Record<string, number> = {}
  for (let pasada = 0; pasada < orden.length; pasada++) {
    let cambio = false
    for (let i = 0; i < orden.length - 1; i++) {
      const a = orden[i], b = orden[i + 1]
      const ventaja = r(b) - r(a) // > 0: b va delante de a
      if (ventaja <= 0) continue
      const clave = `${a}>${b}`
      const desde = pendientes[clave] ?? previo?.pendientes[clave] ?? ahora
      if (ventaja > MARGEN_CLARO_M || ahora - desde >= CONFIRMAR_ORDEN_MS) {
        orden[i] = b; orden[i + 1] = a
        delete pendientes[clave]
        cambio = true
      } else {
        pendientes[clave] = desde
      }
    }
    if (!cambio) break
  }
  return { orden, pendientes }
}

/**
 * Instante en que este piloto pasó por una marca de recorrido dada.
 * Interpola entre las dos muestras que la rodean. Devuelve null si su historial
 * todavía no llegó hasta ahí — pasa cuando el gap es más chico que el intervalo
 * de emisión, y ahí hay que extrapolar en vez de inventar un número.
 */
export function instanteEn(historia: Muestra[], marca: number): number | null {
  if (historia.length < 2) return null
  // El historial es monótono creciente en recorrido: se busca desde el final,
  // que es donde está lo que casi siempre se necesita
  for (let i = historia.length - 1; i > 0; i--) {
    const b = historia[i], a = historia[i - 1]
    if (a.recorrido <= marca && marca <= b.recorrido) {
      const tramo = b.recorrido - a.recorrido
      if (tramo <= 0) return b.t
      return a.t + ((marca - a.recorrido) / tramo) * (b.t - a.t)
    }
  }
  return null
}

/**
 * Diferencia de tiempo entre dos pilotos: cuánto hace que `adelante` pasó por
 * donde está `atras` ahora. Si el historial no alcanza, extrapola con la
 * velocidad reciente del de adelante en vez de devolver nada.
 */
export function gapEntre(adelante: EstadoPiloto, atras: EstadoPiloto, largo: number): number | null {
  const marca = recorridoTotal(atras, largo)
  const t = instanteEn(adelante.historia, marca)
  if (t != null) return (atras.t - t) / 1000

  // Sin dato todavía: el de adelante aún no reportó haber pasado por ahí.
  // Ocurre con gaps más chicos que el intervalo de emisión (~1 s).
  const h = adelante.historia
  if (h.length < 2) return null
  const ult = h[h.length - 1], ant = h[h.length - 2]
  const dt = ult.t - ant.t
  const dd = ult.recorrido - ant.recorrido
  if (dt <= 0 || dd <= 0) return null
  const vel = dd / dt // metros por ms
  const faltan = marca - ult.recorrido
  // faltan > 0: la última lectura del de adelante es más vieja que la mía y
  // todavía no informó haber pasado por ahí. Se lo adelanta con su velocidad,
  // pero solo por la fracción de segundo que puede separar dos lecturas
  if (faltan > 0 && faltan / vel > MAX_ADELANTO_MS) return null
  return (atras.t - (ult.t + faltan / vel)) / 1000
}

/**
 * Instante en que `otro` pasó por un punto del TRAZADO (no por una distancia
 * acumulada). Sirve cuando los pilotos llevan vueltas distintas y no se pueden
 * comparar por recorrido total, que es el caso de entrenamiento.
 */
export function instanteEnPista(
  otro: EstadoPiloto,
  progresoObjetivo: number,
  largo: number,
): number | null {
  // Si el punto que busco quedó atrás suyo en esta vuelta, pasó por ahí en la
  // vuelta actual; si no, en la anterior. Se prueba también una vuelta más
  // atrás porque cerca de meta el redondeo puede correr la referencia.
  const base = progresoObjetivo <= otro.progreso ? otro.vueltas : otro.vueltas - 1
  for (const vr of [base, base - 1]) {
    const t = instanteEn(otro.historia, (vr + progresoObjetivo) * largo)
    if (t != null) return t
  }
  return null
}

/** Separación en pista de `otro` respecto de `yo`, 0..1 hacia adelante. */
function deltaPista(yo: EstadoPiloto, otro: EstadoPiloto): number {
  return (((otro.progreso - yo.progreso) % 1) + 1) % 1
}

/**
 * Calcula, para cada piloto, la diferencia con el competidor de adelante y el
 * de atrás, y si le corresponde bandera azul.
 *
 * Reglas, definidas con Felipe:
 *  · Los gaps se muestran SOLO entre competidores reales, de la misma vuelta.
 *    Un doblado no es rival del puntero y no debe aparecer en su pantalla.
 *  · La bandera azul es la excepción: sí relaciona al doblado con el que lo
 *    dobla, pero el dato viaja en un solo sentido — lo ve únicamente el más
 *    lento, nunca el puntero.
 *  · Quien está en boxes sale del cálculo. Al reingresar vuelve a participar.
 */
export function calcularGaps(
  pilotos: EstadoPiloto[],
  opciones: OpcionesGap,
): Map<string, GapPiloto> {
  const { largo, umbralAzul = 5, frescuraMs = 8000, ahora = Date.now(), modo = 'carrera' } = opciones
  const salida = new Map<string, GapPiloto>()

  // En boxes o sin señal reciente: no participa, pero se lo devuelve vacío para
  // que su pantalla muestre guiones en vez de un número congelado
  const activos = pilotos.filter(p => p.enPista !== false && ahora - p.t <= frescuraMs)
  for (const p of pilotos) salida.set(p.pid, { adelante: null, atras: null, azul: null, pasaronPor: [] })
  if (activos.length < 2 || !largo) return salida

  // ── Entrenamiento y clasificación ─────────────────────────
  // Nadie está corriendo contra nadie en pista: solo importa quién tengo
  // físicamente delante y detrás, dando la vuelta al circuito.
  if (modo === 'libre') {
    for (const yo of activos) {
      const g: GapPiloto = { adelante: null, atras: null, azul: null, pasaronPor: [] }

      let ade: EstadoPiloto | null = null, dAde = Infinity
      let atr: EstadoPiloto | null = null, dAtr = Infinity
      for (const otro of activos) {
        if (otro.pid === yo.pid) continue
        const d = deltaPista(yo, otro)
        if (d <= 0) continue
        if (d < dAde) { dAde = d; ade = otro }          // el más cercano adelante
        if (1 - d < dAtr) { dAtr = 1 - d; atr = otro }  // el más cercano atrás
      }

      if (ade) {
        const t = instanteEnPista(ade, yo.progreso, largo)
        if (t != null) g.adelante = (yo.t - t) / 1000
      }
      if (atr) {
        const t = instanteEnPista(yo, atr.progreso, largo)
        if (t != null) g.atras = -((atr.t - t) / 1000)
      }
      salida.set(yo.pid, g)
    }
    return salida
  }

  // Orden de carrera: más recorrido = más adelante, con todos los autos llevados
  // al mismo instante (ver recorridoAhora). Si viene un orden ya estabilizado
  // (ordenEstable), manda ese.
  const recAhora = new Map(activos.map((p) => [p.pid, recorridoAhora(p, largo, ahora)]))
  const ra = (p: EstadoPiloto) => recAhora.get(p.pid) ?? recorridoTotal(p, largo)
  const porPid = new Map(activos.map((p) => [p.pid, p]))
  const orden = opciones.orden
    ? [
        ...opciones.orden.map((pid) => porPid.get(pid)).filter((p): p is EstadoPiloto => !!p),
        ...activos.filter((p) => !opciones.orden!.includes(p.pid)).sort((a, b) => ra(b) - ra(a)),
      ]
    : [...activos].sort((a, b) => ra(b) - ra(a))

  for (let i = 0; i < orden.length; i++) {
    const yo = orden[i]
    const g: GapPiloto = { adelante: null, atras: null, azul: null, pasaronPor: [] }
    const miRec = ra(yo)

    // Una diferencia negativa no existe en pantalla: si el orden todavía no
    // confirmó un adelantamiento estrecho, lo honesto es "van juntos" (0,0)
    // ── Competidor de adelante: el primero que NO me saque una vuelta ──
    for (let j = i - 1; j >= 0; j--) {
      const otro = orden[j]
      if (ra(otro) - miRec >= largo) continue // me dobló: no es rival
      const gap = gapEntre(otro, yo, largo)
      g.adelante = gap == null ? null : Math.max(0, gap)
      break
    }

    // ── Competidor de atrás: el primero al que NO le saque una vuelta ──
    for (let j = i + 1; j < orden.length; j++) {
      const otro = orden[j]
      if (miRec - ra(otro) >= largo) continue // lo doblé: no es rival
      const gap = gapEntre(yo, otro, largo)
      g.atras = gap == null ? null : -Math.max(0, gap) // negativo: viene atrás
      break
    }

    // ── Quién me está doblando, medido en DISTANCIA ───────────
    // Antes se comparaban los contadores de vueltas (`otro.vueltas >
    // yo.vueltas`). Falla justo en la meta: si el doblado la cruza con el
    // puntero 3-5 s atrás, por esos segundos los dos tienen el mismo número de
    // vueltas y la app concluía que nadie lo estaba doblando. La azul se
    // apagaba ~4 s y volvía, con el puntero encima (simulación de Interlomas,
    // 15-10-2026). La distancia no salta en la meta.
    //
    // ventaja = cuánto me lleva en la carrera. k = vueltas que me saca.
    //   resto < 0  → viene detrás mío en pista, alcanzándome: candidato a azul
    //   resto >= 0 → ya me pasó; si está JUSTO adelante (< 20% de vuelta), el
    //                adelantamiento acaba de consumarse y la azul se apaga ya,
    //                sin esperar a que la diferencia crezca
    for (const otro of activos) {
      if (otro.pid === yo.pid) continue
      const ventaja = ra(otro) - miRec
      const k = Math.round(ventaja / largo)
      if (k < 1) continue // no me saca vuelta: es un rival, no un doblador
      const resto = ventaja - k * largo
      if (resto >= 0) {
        if (resto < 0.2 * largo) g.pasaronPor.push(otro.pid)
        continue
      }

      // ¿Cuándo pasé YO por donde está él ahora? Su posición en mi carrera es
      // su recorrido menos las vueltas que me saca
      const t = instanteEn(yo.historia, recorridoTotal(otro, largo) - k * largo)
      if (t == null) continue

      const segundos = (otro.t - t) / 1000
      if (segundos >= 0 && segundos <= umbralAzul) {
        if (!g.azul || segundos < g.azul.segundos) g.azul = { pid: otro.pid, segundos }
      }
    }

    salida.set(yo.pid, g)
  }

  return salida
}

// ── Tendencia de la diferencia ────────────────────────────────
//
// Compara la décima EXHIBIDA, no el valor crudo: el piloto ve un número
// redondeado, y la flecha tiene que responder a lo que él está viendo. Si el
// dígito en pantalla no se movió, se conserva la tendencia anterior en vez de
// inventar una dirección con ruido que ni siquiera se está mostrando.
//
// Lo usan el teléfono del piloto (triángulo) y el mapa del panel (color del
// cartel). Tiene que ser la MISMA función en los dos: es lo que permite
// contrastar una pantalla contra la otra y detectar si algo se lee mal.
//
//   -1  la diferencia baja  → se está acercando
//   +1  la diferencia sube  → se está alejando
//    0  sin dato
export function tendenciaGap(
  nuevo: number | null,
  viejo: number | null,
  previa: number,
): number {
  if (nuevo == null || viejo == null) return 0
  const a = Math.round(Math.abs(nuevo) * 10)
  const b = Math.round(Math.abs(viejo) * 10)
  if (a > b) return 1
  if (a < b) return -1
  return previa
}

// ── Histéresis de la bandera azul ─────────────────────────────
// El gap oscila alrededor del umbral y basta una lectura perdida para que la
// condición deje de cumplirse un segundo. Al piloto hay que mostrarle una
// señal estable: una bandera que titila es peor que no tenerla.
//
// Dos amortiguadores distintos, que resuelven cosas distintas:
//  · soltarMs: cuánto sigue encendida después de dejar de cumplirse. Tapa los
//    huecos de una o dos lecturas sin apagar una bandera que sigue vigente.
//  · minimoMs: lo mínimo que se muestra una vez encendida, para que un cruce
//    fugaz del umbral no produzca un destello ilegible.
//  · confirmarMs: cuánto debe sostenerse la condición ANTES de encender. No
//    había ninguno: la bandera prendía en el primer instante en que se cumplía
//    y después el mínimo la sostenía 5 segundos. Bastaba un desacuerdo de un
//    segundo entre dos teléfonos para que el piloto viera azul cinco segundos.
//    Así fue como el 4-10-2026 le salió azul al segundo de la carrera.
export interface EstadoAzul {
  activa: boolean
  pid: string | null
  desde: number
  ultimoOk: number
  /** pid → instante hasta el cual no puede volver a encender la bandera */
  bloqueados?: Record<string, number>
  /** Candidato a encender y desde cuándo se viene cumpliendo, sin prender aún */
  candidatoPid?: string | null
  candidatoDesde?: number
}

export function sostenerAzul(
  previo: EstadoAzul | undefined,
  azul: GapPiloto['azul'],
  ahora: number,
  opciones: {
    soltarMs?: number; minimoMs?: number; pasaronPor?: string[];
    bloqueoMs?: number; confirmarMs?: number;
  } = {},
): EstadoAzul {
  const {
    soltarMs = 3000, minimoMs = 5000, pasaronPor = [],
    bloqueoMs = 20000, confirmarMs = 2000,
  } = opciones
  const est: EstadoAzul = previo ?? { activa: false, pid: null, desde: 0, ultimoOk: 0, bloqueados: {} }
  const bloqueados = { ...(est.bloqueados ?? {}) }

  // El adelantamiento se consumó: se apaga ya, sin esperar los amortiguadores.
  // Y ese piloto queda bloqueado un rato: con el ruido del GPS el auto que
  // acaba de pasar puede parecer que retrocede un instante, y sin bloqueo la
  // bandera se volvía a encender de inmediato.
  if (est.activa && est.pid && pasaronPor.includes(est.pid)) {
    bloqueados[est.pid] = ahora + bloqueoMs
    return { activa: false, pid: null, desde: 0, ultimoOk: 0, bloqueados }
  }

  const vigente = azul && !(bloqueados[azul.pid] > ahora) ? azul : null
  if (vigente) {
    // Ya encendida: se sostiene y se refresca.
    if (est.activa) {
      return { ...est, activa: true, pid: vigente.pid, ultimoOk: ahora, bloqueados }
    }
    // Todavía apagada: la condición tiene que sostenerse confirmarMs sobre el
    // MISMO doblador. Si cambia de candidato, el reloj vuelve a empezar.
    const candidatoDesde = est.candidatoPid === vigente.pid ? (est.candidatoDesde ?? ahora) : ahora
    if (ahora - candidatoDesde < confirmarMs) {
      return { ...est, activa: false, pid: null, bloqueados,
               candidatoPid: vigente.pid, candidatoDesde }
    }
    return { activa: true, pid: vigente.pid, desde: ahora, ultimoOk: ahora, bloqueados,
             candidatoPid: vigente.pid, candidatoDesde }
  }
  if (!est.activa) return { ...est, bloqueados, candidatoPid: null, candidatoDesde: 0 }
  if (ahora - est.ultimoOk < soltarMs) return { ...est, bloqueados }  // hueco corto: sigue
  if (ahora - est.desde < minimoMs) return { ...est, bloqueados }     // recién encendida: sigue
  return { activa: false, pid: null, desde: 0, ultimoOk: 0, bloqueados,
           candidatoPid: null, candidatoDesde: 0 }
}

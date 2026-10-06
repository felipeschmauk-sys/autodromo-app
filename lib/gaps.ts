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
}

/** Recorrido total de carrera, en metros. */
export function recorridoTotal(e: { vueltas: number; progreso: number }, largo: number): number {
  return (e.vueltas + e.progreso) * largo
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
  // Solo se extrapola hacia atrás (el de adelante ya pasó) y por poco tiempo
  if (faltan > 0) return null
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

  // Orden de carrera: más recorrido = más adelante
  const orden = [...activos].sort((a, b) => recorridoTotal(b, largo) - recorridoTotal(a, largo))

  for (let i = 0; i < orden.length; i++) {
    const yo = orden[i]
    const g: GapPiloto = { adelante: null, atras: null, azul: null, pasaronPor: [] }
    const miRec = recorridoTotal(yo, largo)

    // ── Competidor de adelante: el primero que NO me saque una vuelta ──
    for (let j = i - 1; j >= 0; j--) {
      const otro = orden[j]
      if (recorridoTotal(otro, largo) - miRec >= largo) continue // me dobló: no es rival
      g.adelante = gapEntre(otro, yo, largo)
      break
    }

    // ── Competidor de atrás: el primero al que NO le saque una vuelta ──
    for (let j = i + 1; j < orden.length; j++) {
      const otro = orden[j]
      if (miRec - recorridoTotal(otro, largo) >= largo) continue // lo doblé: no es rival
      const gap = gapEntre(yo, otro, largo)
      g.atras = gap == null ? null : -gap // negativo: viene atrás
      break
    }

    // ── ¿Ya lo pasaron? ───────────────────────────────────────
    // Quien le sacaba una vuelta y ahora aparece JUSTO adelante en pista acaba
    // de adelantarlo. Ahí la bandera azul cumplió su función y debe apagarse,
    // sin esperar a que el gap crezca.
    for (const otro of activos) {
      if (otro.pid === yo.pid || otro.vueltas <= yo.vueltas) continue
      // Diferencia de posición en pista, 0..1 hacia adelante
      const delta = (((otro.progreso - yo.progreso) % 1) + 1) % 1
      if (delta > 0 && delta < 0.2) g.pasaronPor.push(otro.pid)
    }

    // ── Bandera azul ──────────────────────────────────────────
    // Se busca a quien viene ALCANZÁNDOME por pista y ya me sacó una vuelta.
    // Está físicamente detrás mío en el trazado, pero adelante en la carrera.
    for (const otro of activos) {
      if (otro.pid === yo.pid) continue
      if (otro.vueltas <= yo.vueltas) continue // no me está doblando
      // Si ya me pasó, no corresponde bandera: va adelante mío en pista.
      // Sin este filtro, la referencia de vuelta podía caer en la anterior y
      // devolver un número chico para alguien que en realidad ya se fue.
      if (g.pasaronPor.includes(otro.pid)) continue

      // ¿Cuándo pasé YO por donde está él ahora? Si él viene más atrás en la
      // vuelta que yo, fue en esta misma vuelta; si no, en la anterior.
      // Cerca de la meta el redondeo puede dejar la referencia en la vuelta
      // equivocada, así que se prueba también la anterior antes de rendirse:
      // sin esto la bandera parpadeaba una vez por vuelta.
      const vueltaRef = otro.progreso <= yo.progreso ? yo.vueltas : yo.vueltas - 1
      let t: number | null = null
      for (const vr of [vueltaRef, vueltaRef - 1]) {
        t = instanteEn(yo.historia, (vr + otro.progreso) * largo)
        if (t != null) break
      }
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

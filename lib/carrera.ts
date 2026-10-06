// ── Largada: separar la vuelta de formación de las de carrera ──
//
// Protocolo real: los autos salen de boxes detrás del pace car, dan una vuelta
// de formación, y la carrera larga en el SEGUNDO paso por meta. Sin marcar ese
// instante, esas pasadas se contaban como vueltas de carrera y había que
// compensarlo configurando una vuelta de más.
//
// El director marca la largada con un botón. No hace falta que sea exacto: el
// pelotón viene apiñado detrás del pace car —en la Carrera 2 del 9 ago 2026 los
// cuatro autos cruzaron dentro de 2 segundos, contra 13-18 s de dispersión en
// las vueltas normales— así que basta con descartar todo cruce dentro de un
// margen alrededor de la marca. Como la vuelta mínima válida es de 40 s, un
// margen de 10 s no puede confundirse nunca con una vuelta real.

export const MARGEN_LARGADA_MS = 10_000

/**
 * ¿Este cruce cuenta como vuelta de carrera?
 * Con la largada sin marcar cuenta todo, igual que antes de existir esta marca.
 */
export function esVueltaDeCarrera(cruceMs: number, largadaMs: number | null): boolean {
  if (largadaMs == null) return true
  return cruceMs > largadaMs + MARGEN_LARGADA_MS
}

/** Instante a partir del cual un cruce ya es vuelta de carrera. */
export function desdeLargadaMs(largadaMs: number | null): number | null {
  return largadaMs == null ? null : largadaMs + MARGEN_LARGADA_MS
}

/**
 * Vueltas de carrera completadas, a partir de los instantes de cruce de UN piloto.
 * Sin largada marcada se descuenta la vuelta de salida, como siempre.
 */
export function vueltasDeCarrera(cruces: number[], largadaMs: number | null): number {
  if (largadaMs == null) return Math.max(0, cruces.length - 1)
  return cruces.filter((t) => esVueltaDeCarrera(t, largadaMs)).length
}

/**
 * Vueltas que SE PUEDEN COMPARAR CONTRA OTRO PILOTO, o null si no se sabe.
 *
 * `vueltasDeCarrera` tiene dos reglas distintas según si se conoce la largada:
 * sin ella descuenta una vuelta a ojo, con ella cuenta solo lo posterior al
 * verde. Las dos son razonables por separado, pero **dan números distintos para
 * el mismo auto**, y el panel compara ese número entre teléfonos para decidir
 * quién está doblando a quién.
 *
 * Eso rompió la carrera del 4-10-2026. Cada auto cruza la meta dos veces antes
 * de que empiece a contar la carrera (formación + largada). En esa ventana:
 *   · el teléfono que todavía no recibió la marca de largada decía  2 - 1 = 1
 *   · el que ya la recibió decía                                          0
 * El que estaba BIEN quedaba con menos vueltas que todos los demás, así que el
 * panel concluía que la pista entera lo estaba doblando y le mandaba bandera
 * azul. Le tocó a Iván del Pino yendo segundo, sin haber sido doblado nunca.
 *
 * La consulta de tanda del teléfono corre cada 10 s, así que la ventana puede
 * durar eso. La salida no es adivinar mejor: es admitir que no se sabe. Un
 * piloto con vueltas desconocidas queda fuera de la clasificación por unos
 * segundos —ve guiones— y, sobre todo, ni recibe ni provoca bandera azul.
 */
export function vueltasComparables(
  cruces: number[],
  tanda: { tipo?: string | null; largadaMs?: number | null } | null | undefined,
): number | null {
  if (tanda?.tipo === 'carrera' && tanda.largadaMs == null) return null
  return vueltasDeCarrera(cruces, tanda?.largadaMs ?? null)
}

// ── Reloj de la tanda, con las pausas por bandera roja ────────
//
// Con bandera roja nadie corre, así que el tiempo de la tanda se detiene y
// vuelve a correr con la verde. En una carrera real ese tiempo se recupera
// cuando se resuelve el problema, y acá tiene que pasar lo mismo.
//
// Se guarda de dos formas: `pausado_ms` acumula lo que ya se detuvo, y
// `pausa_desde` marca una pausa en curso. Mientras hay una pausa abierta el
// final de la tanda se va corriendo al mismo ritmo que el reloj de pared, así
// que el tiempo restante se queda quieto.
//
// Si el director finaliza la tanda a mano, se termina y ese tiempo se pierde:
// finalizar es finalizar.

export interface RelojTanda {
  inicio: string | number
  duracion_min?: number | null
  pausado_ms?: number | null
  pausa_desde?: string | null
  /** Instante del verde. Cuando existe, el reloj corre desde acá. */
  largada_at?: string | null
}

const inicioMs = (t: RelojTanda) =>
  typeof t.inicio === 'number' ? t.inicio : new Date(t.inicio).getTime()

/**
 * Instante desde el cual corre el reloj de la tanda.
 *
 * En una carrera es la LARGADA, no la apertura de la tanda. El tiempo de
 * grilla y la vuelta de formación no son carrera, y descontarlos no es un
 * detalle: en la Carrera 2 del 4-10-2026 pasaron 4 minutos 26 segundos entre
 * abrir la tanda y dar el verde, así que los 15 minutos se acabaron a las
 * 14:58:10 cuando la carrera recién terminó a las 14:59:54. El sistema tiró la
 * bandera a cuadros solo, 104 segundos antes, y a casi todos les quedó una
 * vuelta menos que en el acta oficial.
 *
 * Sin largada marcada —entrenamiento, clasificación, o una carrera que todavía
 * no largó— la referencia sigue siendo la apertura de la tanda.
 */
const referenciaMs = (t: RelojTanda) =>
  t.largada_at ? new Date(t.largada_at).getTime() : inicioMs(t)

/** Milisegundos que la tanda estuvo detenida, incluida una pausa en curso. */
export function pausaAcumuladaMs(t: RelojTanda, ahora: number = Date.now()): number {
  const fijo = t.pausado_ms ?? 0
  if (!t.pausa_desde) return fijo
  return fijo + Math.max(0, ahora - new Date(t.pausa_desde).getTime())
}

/** ¿La tanda está detenida ahora mismo? */
export function tandaEnPausa(t: RelojTanda): boolean {
  return !!t.pausa_desde
}

/** Instante en que se acaba el tiempo de la tanda, corrido por las pausas. */
export function deadlineTanda(t: RelojTanda, ahora: number = Date.now()): number | null {
  if (!t.duracion_min) return null
  return referenciaMs(t) + t.duracion_min * 60000 + pausaAcumuladaMs(t, ahora)
}

/** Segundos de tanda efectivamente corridos, descontando las pausas. */
export function transcurridoTandaS(t: RelojTanda, ahora: number = Date.now()): number {
  return Math.max(0, Math.floor((ahora - referenciaMs(t) - pausaAcumuladaMs(t, ahora)) / 1000))
}

// ── Orden de relargada tras una bandera roja ──────────────────
//
// Reglamento Deportivo de F1 de la FIA, edición 2025:
//
//  · Art. 57.3 — el orden se toma en el último punto en que fue posible
//    determinar la posición de todos los autos. O sea el último paso por meta,
//    NO el orden físico en que quedaron al detenerse. Un auto que adelantó
//    después de cruzar la meta devuelve esa posición.
//
//  · Art. 58.4 — los autos que habían sido doblados por el líder al momento de
//    la suspensión completan una vuelta adicional antes de reanudar. Esa vuelta
//    extra es la recuperación de la vuelta perdida. Es UNA vuelta: quien venía
//    dos abajo, queda una abajo.
//
// Lo que el reglamento de F1 no cubre, por ser monocategoría: qué pasa cuando
// te dobla el líder de OTRA categoría. Se aplica el criterio de las carreras
// multiclase —cada clase se clasifica por separado—, así que el "líder" que
// define el doblaje es el de la propia categoría. Ser doblado por una categoría
// más rápida no cuesta nada ni hay nada que recuperar.
//
// La fila se arma por bloques de categoría, en el orden configurado.

export interface CruceRelargada {
  pid: string
  categoria: string | null
  /** Vueltas de carrera completadas al momento de la roja */
  vueltas: number
  /** Instante de su último paso por meta (ms) */
  ultimoCruce: number | null
}

export interface PuestoRelargada {
  pid: string
  /** Lugar en la fila india, global */
  pos: number
  categoria: string | null
  /** Posición dentro de su categoría */
  posCategoria: number
  /** Vueltas ya con la recuperación aplicada */
  vueltas: number
  /** Recuperó una vuelta por el art. 58.4 */
  recuperoVuelta: boolean
}

/**
 * Arma la fila de relargada a partir del último paso por meta de cada piloto.
 * `ordenCategoria` da el lugar del bloque de cada categoría (menor va primero);
 * los pilotos sin categoría van al final.
 */
export function ordenDeRelargada(
  pilotos: CruceRelargada[],
  ordenCategoria: (cat: string | null) => number = () => 0,
): PuestoRelargada[] {
  const bloques = new Map<string, CruceRelargada[]>()
  for (const p of pilotos) {
    const clave = p.categoria ?? '￿' // sin categoría: al final
    if (!bloques.has(clave)) bloques.set(clave, [])
    bloques.get(clave)!.push(p)
  }

  const clavesOrdenadas = [...bloques.keys()].sort((a, b) => {
    const ca = a === '￿' ? null : a
    const cb = b === '￿' ? null : b
    return ordenCategoria(ca) - ordenCategoria(cb) || a.localeCompare(b)
  })

  const salida: PuestoRelargada[] = []
  let pos = 0

  for (const clave of clavesOrdenadas) {
    const grupo = bloques.get(clave)!
    // El líder de ESTA categoría define quién está doblado
    const lider = Math.max(...grupo.map(p => p.vueltas))
    const conVuelta = grupo.map(p => {
      const doblado = p.vueltas < lider
      return {
        ...p,
        vueltasFinal: doblado ? p.vueltas + 1 : p.vueltas,   // art. 58.4
        recuperoVuelta: doblado,
      }
    })
    // El orden de la fila sale de las vueltas ORIGINALES, no de las
    // recuperadas: el art. 58.4 devuelve la vuelta pero los reincorpora
    // DETRÁS, no en la posición que tenían antes de ser doblados.
    //
    // Ordenar por las recuperadas metería al doblado delante de los de la
    // vuelta del líder, porque su último cruce es más antiguo —es de una vuelta
    // anterior— y las horas de cruce de vueltas distintas no son comparables.
    //
    // Quien nunca cruzó va al final de su bloque.
    conVuelta.sort((a, b) =>
      b.vueltas - a.vueltas ||
      (a.ultimoCruce ?? Infinity) - (b.ultimoCruce ?? Infinity))

    conVuelta.forEach((p, i) => {
      pos += 1
      salida.push({
        pid: p.pid,
        pos,
        categoria: p.categoria,
        posCategoria: i + 1,
        vueltas: p.vueltasFinal,
        recuperoVuelta: p.recuperoVuelta,
      })
    })
  }
  return salida
}

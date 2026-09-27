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
}

const inicioMs = (t: RelojTanda) =>
  typeof t.inicio === 'number' ? t.inicio : new Date(t.inicio).getTime()

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
  return inicioMs(t) + t.duracion_min * 60000 + pausaAcumuladaMs(t, ahora)
}

/** Segundos de tanda efectivamente corridos, descontando las pausas. */
export function transcurridoTandaS(t: RelojTanda, ahora: number = Date.now()): number {
  return Math.max(0, Math.floor((ahora - inicioMs(t) - pausaAcumuladaMs(t, ahora)) / 1000))
}

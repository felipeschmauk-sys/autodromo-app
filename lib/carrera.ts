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

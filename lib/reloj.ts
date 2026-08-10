import { supabase } from './supabase'

// ── Desfase de reloj: teléfono ↔ servidor ─────────────────────
//
// El detector de cruces marca cada vuelta con la hora DEL TELÉFONO del piloto.
// Para el tiempo de vuelta de un piloto eso no molesta: el error del reloj se
// cancela al restar dos cruces del mismo aparato. Pero en el momento en que se
// comparan DOS pilotos —gap al de adelante, gap al de atrás, banderas azules—
// un teléfono adelantado 2 s desplaza todos sus tiempos 2 s.
//
// Se mide igual que NTP: varias muestras, y se conserva la de menor ida-y-vuelta,
// que es la menos contaminada por la latencia de la red.
//
//   offsetMs > 0  →  el servidor va adelantado respecto del teléfono
//   hora real ≈ hora del teléfono + offsetMs

let offsetMs: number | null = null
let margenMs: number | null = null

/** Desfase medido en ms, o null si todavía no se pudo medir. */
export function getOffsetReloj() {
  return offsetMs
}

/** Margen de error de la última medición, en ms (mitad del ida-y-vuelta). */
export function getMargenReloj() {
  return margenMs
}

/**
 * Pasa un instante medido con el reloj DEL TELÉFONO a la escala del servidor.
 * Necesario para comparar contra cualquier hora que venga del servidor (inicio
 * de tanda, largada, fin) y para comparar pilotos entre sí. Los tiempos de
 * vuelta NO deben corregirse: son diferencias dentro del mismo aparato y el
 * error del reloj ya se cancela solo.
 */
export function aHoraServidor(msDispositivo: number): number {
  return offsetMs == null ? msDispositivo : msDispositivo + offsetMs
}

async function unaMuestra(): Promise<{ offset: number; rtt: number } | null> {
  try {
    const t0 = Date.now()
    const { data, error } = await supabase.rpc('hora_servidor')
    const t1 = Date.now()
    if (error || !data) return null

    const tServidor = new Date(data as string).getTime()
    if (!Number.isFinite(tServidor)) return null

    // Se asume ida y vuelta simétricas: el servidor respondió a mitad de camino
    const rtt = t1 - t0
    return { offset: tServidor - (t0 + rtt / 2), rtt }
  } catch {
    // Sin señal en pista: se conserva el último desfase medido
    return null
  }
}

/**
 * Mide el desfase contra el servidor y lo deja guardado en memoria.
 * Devuelve null si la función hora_servidor() todavía no está migrada —
 * en ese caso se sigue usando la hora local sin corregir.
 */
export async function medirOffsetReloj(muestras = 5): Promise<number | null> {
  let mejor: { offset: number; rtt: number } | null = null
  for (let i = 0; i < muestras; i++) {
    const m = await unaMuestra()
    if (m && (!mejor || m.rtt < mejor.rtt)) mejor = m
  }
  if (!mejor) return null

  offsetMs = Math.round(mejor.offset)
  margenMs = Math.round(mejor.rtt / 2)
  return offsetMs
}

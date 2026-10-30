import type { GapsPiloto } from './posiciones'
import type { EstadoLlegadas, Llegada } from './llegadas'

// ── La llegada a la meta final, en un módulo aparte ───────────
//
// Esto vivía dentro del ciclo emisor de Cronometraje.tsx, y el replay
// (scripts/replay-carrera.mjs) tenía SU PROPIA copia de la misma regla. Dos
// implementaciones de lo único que decide el resultado de una carrera, y la
// del replay ya había quedado atrás: ordenaba por `vueltas + progreso` en vez
// de usar el orden estable del panel.
//
// Acá viven las dos cosas que hacen falta para que el replay pruebe el código
// de verdad y no una imitación: la regla, y la memoria que el arriendo tiene
// que poder traspasar de un panel a otro (ver lib/arriendo.ts).

export interface MemoriaLlegada {
  /** El líder ya cruzó su meta: para los demás, su meta es el cruce siguiente. */
  liderTermino: boolean
  /** Vueltas que llevaba cada uno cuando cruzó el líder. */
  alTerminar: Map<string, number>
  /** Cómo llegó cada uno de los que ya terminaron. */
  llegadas: Map<string, Llegada>
  /** El dato congelado de cada uno: la diferencia con la que terminó. */
  congelados: Map<string, GapsPiloto>
}

export function memoriaVacia(): MemoriaLlegada {
  return { liderTermino: false, alTerminar: new Map(), llegadas: new Map(), congelados: new Map() }
}

export function hidratarMemoria(datos: EstadoLlegadas | null): MemoriaLlegada {
  if (!datos) return memoriaVacia()
  return {
    liderTermino: datos.liderTermino,
    alTerminar:   new Map(Object.entries(datos.alTerminar)),
    llegadas:     new Map(Object.entries(datos.llegadas)),
    congelados:   new Map(Object.entries(datos.congelados)),
  }
}

export function serializarMemoria(m: MemoriaLlegada): EstadoLlegadas {
  return {
    liderTermino: m.liderTermino,
    alTerminar:   Object.fromEntries(m.alTerminar),
    llegadas:     Object.fromEntries(m.llegadas),
    congelados:   Object.fromEntries(m.congelados),
  }
}

/** ¿Hay algo que valga la pena guardar? Antes de la primera llegada, no. */
export function hayLlegada(m: MemoriaLlegada): boolean {
  return m.liderTermino || m.llegadas.size > 0 || m.congelados.size > 0
}

/** Lo mínimo que la regla necesita de cada auto, en orden de carrera. */
export interface EnOrden { pid: string; vueltas: number }

/**
 * Congela a cada piloto en SU cruce de meta y pisa su dato vivo.
 *
 * La carrera termina cuando cruza el primero, pero los demás siguen girando
 * hasta pasar por meta: a cada uno se le congela lo suyo en su propio cruce,
 * con la diferencia con la que terminó.
 *
 * `pilotos` se modifica: el dato congelado reemplaza al vivo, porque el piloto
 * que ya terminó no debe ver números que sigan moviéndose.
 */
export function aplicarLlegada(
  m: MemoriaLlegada,
  pilotos: Record<string, GapsPiloto>,
  orden: EnOrden[],
  opciones: {
    programadas: number | null
    /** Instante en hora de SERVIDOR: de acá sale el orden entre los que
     *  terminan en la misma vuelta, y se compara entre paneles distintos. */
    ahoraServidor: number
    categoriaDe: (pid: string) => string | null
  },
): void {
  const { programadas, ahoraServidor, categoriaDe } = opciones

  if (programadas && orden.length) {
    if (!m.liderTermino && orden[0].vueltas >= programadas) {
      m.liderTermino = true
      // Se anota en qué vuelta venía cada uno cuando cayó la bandera: su meta
      // es el cruce SIGUIENTE
      orden.forEach(e => m.alTerminar.set(e.pid, e.vueltas))
    }

    for (const e of orden) {
      if (m.congelados.has(e.pid)) continue
      const suyo = pilotos[e.pid]
      if (!suyo) continue
      const yaCruzoSuMeta =
        e.vueltas >= programadas ||
        (m.liderTermino && e.vueltas > (m.alTerminar.get(e.pid) ?? Infinity))
      if (!yaCruzoSuMeta) continue
      // Se anota CÓMO llegó: con cuántas vueltas y en qué instante. La posición
      // sale de ahí y no de la distancia recorrida, porque al cruzar la meta el
      // progreso de vuelta vuelve a cero y ese es el peor momento para medir:
      // el que acaba de llegar aparecería detrás de cualquiera que venga a
      // mitad de su vuelta.
      m.llegadas.set(e.pid, { vueltas: e.vueltas, t: ahoraServidor })
      m.congelados.set(e.pid, { ...suyo, azul: false, fin: true })
    }

    // Posición final de los que ya llegaron: mandan las vueltas, y entre los
    // que tienen las mismas, quién cruzó primero. Un doblado termina detrás de
    // los de la vuelta del líder aunque haya cruzado antes que alguno de ellos.
    // Se recalcula entero porque un piloto puede llegar después y con MÁS
    // vueltas que otro que ya había terminado.
    const porCategoria = new Map<string, { pid: string; vueltas: number; t: number }[]>()
    m.llegadas.forEach((ll, pid) => {
      const cat = categoriaDe(pid)
      if (!cat) return
      if (!porCategoria.has(cat)) porCategoria.set(cat, [])
      porCategoria.get(cat)!.push({ pid, ...ll })
    })
    porCategoria.forEach(lista => {
      lista.sort((a, b) => b.vueltas - a.vueltas || a.t - b.t)
      lista.forEach((l, i) => {
        const cong = m.congelados.get(l.pid)
        if (cong) m.congelados.set(l.pid, { ...cong, pos: i + 1 })
      })
    })
  }

  // El dato congelado pisa al vivo
  m.congelados.forEach((v, pid) => { pilotos[pid] = v })
}

import type { Coordenada } from './gps'

// ── Posición sobre el trazado, continua ───────────────────────
//
// Antes la posición del auto se resolvía saltando al punto más cercano del
// trazado. Con 84 puntos en 2550 m eso son bloques de 30 metros: a 135 km/h,
// casi 0,8 s de incertidumbre — más grande que las diferencias que se quieren
// mostrar. Comparado contra MyLaps, ese redondeo era la mayor fuente de error.
//
// Acá la posición se PROYECTA sobre el segmento entre dos puntos, así que la
// distancia recorrida es continua y no depende de cuántos puntos tenga el
// trazado dibujado.
//
// Se trabaja en metros con una proyección plana local (equirectangular): en un
// circuito de pocos kilómetros el error de esa aproximación es milimétrico,
// y evita hacer trigonometría por punto en cada lectura del GPS.

export interface TrazadoPreparado {
  /** Coordenadas ya convertidas a metros: [x (este), y (norte)] */
  xy: [number, number][]
  /** Distancia acumulada desde el punto 0 hasta cada punto, en metros */
  acum: number[]
  /** Largo total del circuito, en metros (cierra el anillo) */
  largo: number
  /** Factor lng→m a la latitud del circuito */
  kx: number
  ky: number
  lat0: number
  lng0: number
}

export interface PosicionTrazado {
  /** Segmento donde cayó la proyección */
  idx: number
  /** Metros recorridos desde el punto 0 del trazado */
  distancia: number
  /** Distancia perpendicular al eje de pista, en metros */
  desvio: number
}

const M_POR_GRADO = 111320

/** Precalcula lo que no cambia entre lecturas. Llamar una vez por trazado. */
export function prepararTrazado(puntos: Coordenada[]): TrazadoPreparado | null {
  if (!puntos || puntos.length < 8) return null

  const lat0 = puntos[0].lat
  const lng0 = puntos[0].lng
  const ky = M_POR_GRADO
  const kx = M_POR_GRADO * Math.cos((lat0 * Math.PI) / 180)

  const xy = puntos.map((p) => [(p.lng - lng0) * kx, (p.lat - lat0) * ky] as [number, number])

  // acum[i] = metros desde el punto 0 hasta el punto i, siguiendo el trazado
  const acum: number[] = [0]
  for (let i = 1; i < xy.length; i++) {
    const dx = xy[i][0] - xy[i - 1][0]
    const dy = xy[i][1] - xy[i - 1][1]
    acum.push(acum[i - 1] + Math.hypot(dx, dy))
  }
  // El circuito es cerrado: el último segmento vuelve al punto 0
  const dxc = xy[0][0] - xy[xy.length - 1][0]
  const dyc = xy[0][1] - xy[xy.length - 1][1]
  const largo = acum[acum.length - 1] + Math.hypot(dxc, dyc)

  return { xy, acum, largo, kx, ky, lat0, lng0 }
}

/** Proyecta una posición GPS sobre el trazado. */
export function proyectar(lat: number, lng: number, tz: TrazadoPreparado): PosicionTrazado {
  const px = (lng - tz.lng0) * tz.kx
  const py = (lat - tz.lat0) * tz.ky

  const n = tz.xy.length
  let mejorD2 = Infinity, mejorIdx = 0, mejorT = 0

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n            // el último segmento cierra el anillo
    const [ax, ay] = tz.xy[i]
    const [bx, by] = tz.xy[j]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    // t = dónde cae la proyección dentro del segmento, recortada a [0,1] para
    // que un punto pasado el final del segmento no se salga del tramo
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
    const cx = ax + t * dx, cy = ay + t * dy
    const d2 = (px - cx) ** 2 + (py - cy) ** 2
    if (d2 < mejorD2) { mejorD2 = d2; mejorIdx = i; mejorT = t }
  }

  const j = (mejorIdx + 1) % n
  const largoSeg = j === 0
    ? tz.largo - tz.acum[mejorIdx]
    : tz.acum[j] - tz.acum[mejorIdx]

  return {
    idx: mejorIdx,
    distancia: tz.acum[mejorIdx] + mejorT * largoSeg,
    desvio: Math.sqrt(mejorD2),
  }
}

/** Distancia sobre el trazado del punto de meta (índice de punto → metros). */
export function distanciaDeMeta(metaIdx: number, tz: TrazadoPreparado): number {
  return tz.acum[Math.max(0, Math.min(metaIdx, tz.acum.length - 1))] ?? 0
}

/** Progreso 0..1 de la vuelta, con la meta como origen. Continuo. */
export function progresoDesdeMeta(distancia: number, metaDist: number, largo: number): number {
  if (!largo) return 0
  return (((distancia - metaDist) % largo) + largo) % largo / largo
}

// ── Sentido de giro ───────────────────────────────────────────
//
// La app no guarda hacia dónde corren los autos: lo deduce del ORDEN de los
// puntos del trazado. Se asume que los autos recorren el punto 0, después el 1,
// el 2... y de ahí sale todo lo demás: el detector de cruces cuenta una vuelta
// cuando el progreso salta de ~1 a ~0, los sectores se numeran en ese orden y
// las diferencias entre autos miden quién va adelante sobre ese recorrido.
//
// Si el KML se dibujó al revés, el auto avanza "hacia atrás" sobre el trazado:
// el progreso salta de ~0 a ~1 al pasar por meta y LA VUELTA NO SE CUENTA.
// Por eso el sentido no es un dato aparte que cada pantalla tenga que
// interpretar: para cambiarlo se invierte el orden de los puntos guardados
// (ver invertirSentidoCircuito en lib/gps.ts) y todo lo demás sigue igual.

export type SentidoGiro = 'horario' | 'antihorario'

/**
 * Sentido en que se recorre el trazado, visto en un mapa con el norte arriba.
 * Fórmula del área con signo (shoelace) en metros locales: área positiva =
 * los puntos giran contra el reloj.
 */
export function sentidoDeGiro(puntos: Coordenada[]): SentidoGiro | null {
  if (!puntos || puntos.length < 3) return null
  const kx = Math.cos((puntos[0].lat * Math.PI) / 180)
  let area2 = 0
  for (let i = 0; i < puntos.length; i++) {
    const a = puntos[i]
    const b = puntos[(i + 1) % puntos.length]
    area2 += a.lng * kx * b.lat - b.lng * kx * a.lat
  }
  if (area2 === 0) return null
  return area2 > 0 ? 'antihorario' : 'horario'
}

/** El mismo punto físico, contado en el trazado invertido. */
export function indiceInvertido(idx: number, total: number): number {
  return total - 1 - idx
}

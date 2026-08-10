import { supabase } from './supabase'

// ── Transporte de posiciones en vivo (Realtime broadcast) ─────
//
// Hasta ahora la única fuente de posiciones era la tabla `ubicaciones_piloto`,
// que el teléfono escribe cada 3 s. Para el semáforo de "en pista / boxes" eso
// alcanza, pero para calcular la diferencia de tiempo contra el auto de
// adelante no: 3 segundos de atraso son ~110 metros a velocidad de carrera.
//
// Broadcast resuelve las dos cosas a la vez:
//  - Es efímero: no escribe una fila por mensaje, así que se puede mandar a
//    1 Hz sin llenar la base ni gastar escrituras.
//  - Va directo por el socket ya abierto, sin pasar por Postgres.
//
// La escritura cada 3 s se mantiene aparte: es el registro histórico y el
// respaldo si un teléfono no logra abrir el canal.
//
// Quién habla con quién:
//   piloto  --(pos, 1 Hz)-->  canal de la fecha  -->  panel
// El panel es el único que conoce la clasificación completa, así que es quien
// puede resolver quién va adelante y quién atrás. El camino de vuelta (gaps y
// bandera azul hacia cada piloto) se agrega en el paso siguiente.

/** Lo que cada teléfono manda de sí mismo, 1 vez por segundo. */
export interface PosicionViva {
  pid: string      // piloto
  t: number        // instante en hora de SERVIDOR (ms), ya corregido el desfase
  lat: number
  lng: number
  /** Metros recorridos sobre el trazado desde su punto 0 (proyección continua) */
  d: number | null
  /** Progreso 0..1 de la vuelta con la meta como origen */
  p: number | null
  /** Velocidad en m/s, para poder extrapolar mientras no llega el próximo dato */
  v: number | null
  /** Vueltas de carrera completadas */
  vu: number
  /** true = dentro de la geocerca de pista */
  pista: boolean | null
}

const canalFecha = (fechaId: string) => `pos-${fechaId}`

/**
 * Abre el canal para PUBLICAR la posición propia.
 * Devuelve la función de envío y la de cierre.
 */
export function abrirEmisorPosiciones(fechaId: string) {
  const canal = supabase.channel(canalFecha(fechaId), {
    config: { broadcast: { self: false, ack: false } },
  })
  let listo = false
  canal.subscribe((estado) => { listo = estado === 'SUBSCRIBED' })

  return {
    enviar(pos: PosicionViva) {
      if (!listo) return
      // Fire and forget: si el canal se cayó, la escritura cada 3 s sigue
      // siendo el respaldo. Nunca debe romper el GPS del piloto.
      canal.send({ type: 'broadcast', event: 'pos', payload: pos }).catch(() => {})
    },
    cerrar() { supabase.removeChannel(canal) },
  }
}

/** Se suscribe a las posiciones de todos los pilotos de la fecha. */
export function suscribirPosiciones(fechaId: string, alRecibir: (pos: PosicionViva) => void) {
  const canal = supabase
    .channel(canalFecha(fechaId), { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'pos' }, ({ payload }) => {
      const p = payload as PosicionViva
      if (p && typeof p.pid === 'string') alRecibir(p)
    })
    .subscribe()

  return () => { supabase.removeChannel(canal) }
}

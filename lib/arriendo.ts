import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// ── Arriendo del cálculo: un solo panel por fecha ─────────────
//
// Cada panel admin abierto corría su propio ciclo de 1 Hz y emitía su versión
// de la carrera por el canal `estado-<fecha>`. El teléfono del piloto aplica el
// último mensaje que llega, así que con dos paneles veía dos verdades
// alternadas; y como un panel recién abierto todavía no tiene historia de todos
// los autos, emite un estado PARCIAL y al piloto que falta en ese mensaje se le
// borra la pantalla.
//
// Esto reparte un arriendo: el panel que lo tiene calcula y emite, los demás
// son vista. No es un "panel principal" configurado a mano — si ese equipo se
// queda sin batería a mitad de carrera, nadie calcularía hasta que un humano lo
// reconfigure. Se toma solo, se renueva solo y se suelta solo.
//
// Los botones NO dependen de esto: cualquier panel sigue poniendo banderas,
// dando la largada y abriendo o cerrando tandas. Lo único que se reparte es
// quién hace la cuenta.

/** Cuánto dura el arriendo si deja de renovarse. */
const SEGUNDOS = 6
/** Cada cuánto se renueva. Bastante más seguido que el plazo, porque los
 *  navegadores frenan los relojes de las pestañas en segundo plano. */
const RENUEVA_MS = 2_000

export interface Arriendo {
  /** true = este panel es el que calcula y emite el estado a los pilotos. */
  soyDueno: boolean
  /** Texto legible de quién está calculando ("PC", "Teléfono"), para mostrarlo. */
  etiquetaDueno: string | null
  /** false hasta la primera respuesta de la base. */
  conocido: boolean
}

function etiquetaDeEsteAparato(): string {
  if (typeof navigator === 'undefined') return 'Panel'
  const ua = navigator.userAgent
  if (/iPhone|iPod|Android.*Mobile/i.test(ua)) return 'Teléfono'
  if (/iPad|Tablet|Android/i.test(ua)) return 'Tablet'
  return 'PC'
}

function idAlAzar(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const SIN_ARRIENDO: Arriendo = { soyDueno: false, etiquetaDueno: null, conocido: false }

/**
 * Mantiene el arriendo del cálculo para esta fecha mientras el panel esté
 * abierto. Devuelve si este panel es el que calcula.
 */
export function useArriendoPanel(fechaId: string | null): Arriendo {
  // `de` ata lo que sabemos a la fecha de la que lo sabemos: al cambiar de
  // evento el dato viejo deja de valer sin necesidad de limpiarlo a mano
  const [estado, setEstado] = useState<Arriendo & { de: string | null }>(
    { de: null, ...SIN_ARRIENDO })
  // Identifica a ESTA pestaña, no al equipo: cambia en cada carga
  const [yo] = useState(idAlAzar)

  useEffect(() => {
    if (!fechaId) return
    const etiqueta = etiquetaDeEsteAparato()
    let vivo = true
    // Última vez que la base CONFIRMÓ que el arriendo es nuestro
    let ultimaConfirmacion = 0

    const latir = async () => {
      const { data, error } = await supabase.rpc('tomar_arriendo_panel', {
        p_fecha: fechaId, p_dueno: yo, p_etiqueta: etiqueta, p_segundos: SEGUNDOS,
      })
      if (!vivo) return

      const fila = (data as { dueno: string; etiqueta: string | null; soy_yo: boolean }[] | null)?.[0]
      if (error || !fila) {
        // Sin respuesta no se sabe nada. Pero si no podemos confirmar el
        // arriendo dentro del plazo, hay que SOLTAR el cálculo: en la base ya
        // venció y otro panel lo va a tomar. Seguir emitiendo sería volver a
        // tener dos versiones de la carrera, que es lo que esto arregla.
        if (Date.now() - ultimaConfirmacion > SEGUNDOS * 1_000) {
          setEstado(prev => (prev.soyDueno ? { ...prev, soyDueno: false } : prev))
        }
        return
      }

      if (fila.soy_yo) ultimaConfirmacion = Date.now()
      setEstado(prev =>
        prev.de === fechaId && prev.soyDueno === fila.soy_yo &&
        prev.etiquetaDueno === (fila.etiqueta ?? null) && prev.conocido
          ? prev
          : { de: fechaId, soyDueno: fila.soy_yo, etiquetaDueno: fila.etiqueta ?? null, conocido: true })
    }

    latir()
    const id = setInterval(latir, RENUEVA_MS)
    return () => {
      vivo = false
      clearInterval(id)
      // Soltarlo al cerrar hace que el relevo sea inmediato en vez de esperar
      // los 6 s. Si no alcanza a salir, vence solo.
      supabase.rpc('soltar_arriendo_panel', { p_fecha: fechaId, p_dueno: yo }).then(
        () => {}, () => {})
    }
  }, [fechaId, yo])

  // Lo que sabemos vale solo para la fecha que estamos mirando
  return estado.de === fechaId && fechaId ? estado : SIN_ARRIENDO
}

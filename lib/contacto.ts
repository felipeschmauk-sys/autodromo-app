import { useCallback, useEffect, useRef, useState } from 'react'

// ── ¿Este teléfono está viendo el estado vigente? ─────────────
//
// La función principal de la app es avisarle al piloto. La regla que manda
// (docs/PLAN_ADVERTENCIAS.md):
//
//   Todo piloto en pista ve el estado vigente de las advertencias, o ve que no
//   lo está viendo, dentro de N segundos. Siempre.
//
// Hasta ahora la pizarra era función de `bandera` a secas: mostraba la última
// bandera recibida, sin saber de cuándo era. Los dos canales se suscribían sin
// callback de estado y no había consulta de respaldo, así que si el canal moría
// el teléfono seguía mostrando esa bandera para siempre. Una pantalla verde
// significaba "pista libre" y "no tengo contacto" a la vez, y el piloto no
// podía distinguirlas.
//
// Esto convierte la pizarra en función de (bandera, hace cuánto lo confirmé).

/** Cada cuánto se vuelve a leer el estado, como respaldo del tiempo real. */
const RELECTURA_MS = 20_000
/**
 * Azar que se le suma a cada teléfono. No es un detalle: una ráfaga
 * sincronizada de consultas de doce teléfonos es justo lo que tumbó la prueba
 * del 4-10-2026. Cada aparato pregunta en su propio momento.
 */
const RELECTURA_AZAR_MS = 10_000
/**
 * Sin confirmar por ninguna de las dos vías, se declara la falta de contacto.
 * Son dos relecturas perdidas en el peor caso (30 s cada una) más margen.
 * El camino rápido —el estado del canal— corta al instante, así que este plazo
 * solo cubre el caso en que el socket se cree vivo y no lo está.
 */
const SIN_CONTACTO_MS = 65_000
/**
 * Al entrar al evento todavía no hay nada confirmado, y el canal tarda un
 * instante en suscribirse. Sin esta gracia la pantalla gritaría "sin contacto"
 * cada vez que el piloto abre la app, que es la forma más rápida de enseñarle a
 * ignorar el aviso. Si al cabo de este plazo sigue sin confirmar, el aviso es
 * verdadero y sale.
 */
const GRACIA_MS = 10_000

export interface Contacto {
  /** false = este teléfono NO puede asegurar que su pantalla esté al día. */
  hay: boolean
  /** Hace cuánto se confirmó por última vez, en ms. null = nunca. */
  haceMs: number | null
}

export function useContactoPista(opciones: {
  /** Solo corre con el piloto dentro de un evento. */
  activo: boolean
  /** Relee las banderas. Devuelve true solo si lo logró. */
  releer: () => Promise<boolean>
}) {
  const { activo } = opciones
  // El padre define `releer` en cada render; por ref para no reiniciar el reloj
  const releerRef = useRef(opciones.releer)
  useEffect(() => { releerRef.current = opciones.releer }, [opciones.releer])

  // El instante de la última confirmación vive en un ref y la cuenta la lleva
  // el reloj de abajo: así el render nunca mira la hora, que lo haría impuro
  const confirmadoRef = useRef<number | null>(null)
  const [haceMs, setHaceMs] = useState<number | null>(null)
  const [canales, setCanales] = useState<Record<string, boolean>>({})
  // Recién entrando: todavía no se sabe nada y no corresponde alarmar
  const [enGracia, setEnGracia] = useState(true)

  const marcar = useCallback(() => {
    confirmadoRef.current = Date.now()
    setHaceMs(0)
  }, [])

  /** Llega un dato por tiempo real: eso ES contacto. */
  const confirmar = marcar

  /** Señal 1: el canal está suscrito, o se cayó. Es inmediata y gratis. */
  const reportarCanal = useCallback((nombre: string, ok: boolean) => {
    setCanales(prev => (prev[nombre] === ok ? prev : { ...prev, [nombre]: ok }))
    if (ok) marcar()
  }, [marcar])

  // Señal 2: relectura de respaldo, desfasada, más una al recuperar el foco.
  // Sirve para el caso en que el socket se cree vivo y no esté llegando nada.
  useEffect(() => {
    if (!activo) return
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const finGracia = setTimeout(() => { if (vivo) setEnGracia(false) }, GRACIA_MS)

    const unaVuelta = async () => {
      try {
        if (await releerRef.current()) {
          if (vivo) { confirmadoRef.current = Date.now(); setHaceMs(0) }
        }
      } catch { /* un fallo no confirma nada: se reintenta en la próxima */ }
      if (!vivo) return
      timer = setTimeout(unaVuelta, RELECTURA_MS + Math.random() * RELECTURA_AZAR_MS)
    }
    timer = setTimeout(unaVuelta, Math.random() * RELECTURA_AZAR_MS)

    const alVolver = () => { if (document.visibilityState === 'visible') unaVuelta() }
    document.addEventListener('visibilitychange', alVolver)

    // La cuenta tiene que correr sola para que la pantalla pueda avisar sin
    // esperar a que llegue —o deje de llegar— un dato
    const reloj = setInterval(() => {
      setHaceMs(confirmadoRef.current == null ? null : Date.now() - confirmadoRef.current)
    }, 1_000)

    return () => {
      vivo = false
      clearTimeout(finGracia)
      setEnGracia(true)
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', alVolver)
      clearInterval(reloj)
    }
  }, [activo])

  const algunCanalCaido = Object.values(canales).some(ok => !ok)
  const confirmadoReciente = haceMs != null && haceMs < SIN_CONTACTO_MS
  const hay = activo
    ? !algunCanalCaido && (confirmadoReciente || (haceMs == null && enGracia))
    : true   // fuera de un evento no hay nada que asegurar

  return { contacto: { hay, haceMs } as Contacto, reportarCanal, confirmar }
}

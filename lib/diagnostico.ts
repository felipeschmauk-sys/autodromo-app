import { supabase } from './supabase'

// ── Por qué se apagó este teléfono ────────────────────────────
//
// El 4 de octubre y otra vez en Interlomas, varios teléfonos apagaron el GPS en
// el mismo segundo. La huella quedó en `traza_gps`, pero el MOTIVO no quedó en
// ninguna parte, y los dos análisis terminaron en hipótesis. Ver
// docs/INCIDENTE_2026-10-18.md.
//
// Tres decisiones de diseño, todas por la misma razón —esto tiene que servir
// justo cuando todo lo demás está fallando—:
//
//  1. **Se anota al instante, se escribe cuando se puede.** El evento entra en
//     una cola en memoria con la hora del teléfono. Si la base no responde —que
//     es exactamente lo que pasa en una caída— se reintenta, y al llegar se ve
//     la diferencia entre cuándo ocurrió y cuándo se pudo escribir.
//  2. **Nunca estorba.** Ningún `await`, ningún error que suba. Un registro de
//     diagnóstico no puede ser la causa de la próxima falla.
//  3. **La cola es acotada.** Si nunca se logra escribir, se pierden los más
//     viejos y no la memoria del teléfono.

export type TipoEvento = 'gps_detenido' | 'gps_iniciado' | 'consulta_fallida' | 'contacto'

interface Evento {
  fecha_id: string | null
  piloto_id: string | null
  sesion_id: string | null
  tipo: TipoEvento
  motivo: string | null
  detalle: Record<string, unknown> | null
  t_dispositivo: string
}

/** Cuántos eventos se guardan si la base no responde. */
const MAX_COLA = 100
/** Cada cuánto se intenta vaciar. */
const VACIADO_MS = 4_000

const cola: Evento[] = []
let contexto: { fechaId: string | null; pilotoId: string | null } = { fechaId: null, pilotoId: null }
let timer: ReturnType<typeof setTimeout> | null = null
let migracionFaltante = false

/** El piloto y la fecha a los que pertenece lo que se registre de acá en más. */
export function fijarContextoDiagnostico(fechaId: string | null, pilotoId: string | null) {
  contexto = { fechaId, pilotoId }
}

/**
 * Deja constancia de algo que le pasó a ESTE teléfono. No espera a nadie.
 *
 * `motivo` es el campo que importa: en un apagón de GPS es la diferencia entre
 * diagnosticar y volver a suponer.
 */
export function registrarEventoCliente(
  tipo: TipoEvento,
  motivo: string,
  detalle?: Record<string, unknown>,
  sesionId?: string | null,
) {
  if (migracionFaltante) return
  cola.push({
    fecha_id: contexto.fechaId,
    piloto_id: contexto.pilotoId,
    sesion_id: sesionId ?? null,
    tipo,
    motivo,
    detalle: detalle ?? null,
    t_dispositivo: new Date().toISOString(),
  })
  // Si no se logra escribir, se pierden los más viejos y no la memoria
  if (cola.length > MAX_COLA) cola.splice(0, cola.length - MAX_COLA)
  programarVaciado()
}

function programarVaciado() {
  if (timer) return
  timer = setTimeout(() => { timer = null; vaciar() }, VACIADO_MS)
}

async function vaciar() {
  if (!cola.length) return
  // Se sacan de la cola para escribir, pero si falla vuelven adelante: lo que
  // se quiere conservar es justamente lo de la ventana en que la base no daba
  const lote = cola.splice(0, cola.length)
  try {
    const { error } = await supabase.from('eventos_cliente').insert(lote)
    if (error) {
      // Tabla sin migrar: no tiene sentido seguir intentando toda la jornada
      if (/relation|does not exist|schema cache|eventos_cliente/i.test(error.message)) {
        migracionFaltante = true
        return
      }
      throw error
    }
  } catch {
    cola.unshift(...lote)
    if (cola.length > MAX_COLA) cola.splice(0, cola.length - MAX_COLA)
    programarVaciado()
  }
}

/** Para el cierre de la app: intenta vaciar sin esperar. */
export function vaciarDiagnostico() {
  if (timer) { clearTimeout(timer); timer = null }
  vaciar().catch(() => {})
}

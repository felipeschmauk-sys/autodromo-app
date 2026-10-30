import { supabase } from './supabase'
import type { GapsPiloto } from './posiciones'

// ── La llegada, fuera del navegador ───────────────────────────
//
// Quién ya cruzó su meta final, con cuántas vueltas y cuándo, y con qué
// diferencia quedó congelado. Vivía solo en refs de React
// (`congeladosRef`, `llegadasRef`, `alTerminarRef` en Cronometraje) y se perdía
// con la pestaña: bastaba recargar el panel en la última vuelta para que el
// líder "volviera a terminar".
//
// Con el arriendo del cálculo esto pasa de ser una molestia a ser un requisito:
// si el cálculo cambia de panel a mitad de carrera, el panel nuevo tiene que
// saber quién ya llegó o el resultado sale revuelto.
//
// Se escribe entero y se lee entero. No es un dato de cada tick: cambia cuando
// alguien cruza su meta final, unas pocas veces por carrera.

export interface Llegada {
  vueltas: number
  /** Instante del cruce en hora de SERVIDOR: tiene que poder compararse entre
   *  llegadas anotadas por paneles distintos, con relojes distintos. */
  t: number
}

export interface EstadoLlegadas {
  /** El líder ya cruzó su meta: para los demás, su meta es el cruce siguiente. */
  liderTermino: boolean
  /** Vueltas que llevaba cada uno cuando cruzó el líder. */
  alTerminar: Record<string, number>
  /** Cómo llegó cada uno de los que ya terminaron. */
  llegadas: Record<string, Llegada>
  /** El dato congelado de cada uno al cruzar: la diferencia con la que terminó. */
  congelados: Record<string, GapsPiloto>
}

export async function leerEstadoLlegadas(tandaId: string): Promise<EstadoLlegadas | null> {
  const { data, error } = await supabase
    .from('estado_carrera').select('datos').eq('tanda_id', tandaId).maybeSingle()
  // Un fallo no es "nadie ha llegado": devolver {} haría que el panel nuevo
  // creyera que la carrera recién empieza y descongelara a los que ya cruzaron.
  if (error) throw error
  const datos = (data as { datos?: Partial<EstadoLlegadas> } | null)?.datos
  if (!datos) return null
  return {
    liderTermino: datos.liderTermino ?? false,
    alTerminar:   datos.alTerminar   ?? {},
    llegadas:     datos.llegadas     ?? {},
    congelados:   datos.congelados   ?? {},
  }
}

export async function guardarEstadoLlegadas(tandaId: string, datos: EstadoLlegadas) {
  const { error } = await supabase
    .from('estado_carrera')
    .upsert({ tanda_id: tandaId, datos, actualizado_at: new Date().toISOString() })
  if (error) throw error
}

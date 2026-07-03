import { supabase } from './supabase'

// ── LOG DE ACCIONES DE PISTA ──────────────────────────────────
// Registro persistente de todo lo que ocurre en la operación:
// banderas globales/por sector/personales, amarillas automáticas,
// ingresos por QR y retiros. Se muestra en vivo en Dirección y se
// puede descargar como CSV al final de la tanda.

export interface LogAccion {
  fecha_id?: string | null
  piloto_id?: string | null
  tipo: string        // 'bandera_global' | 'bandera_sector' | 'auto_yellow' | 'bandera_piloto' | 'ingreso' | 'retiro'
  descripcion: string
}

export async function registrarLog(entrada: LogAccion) {
  // Fire-and-forget: si la tabla aún no está migrada, la operación
  // de pista NO debe fallar por no poder registrar el log
  try {
    await supabase.from('log_acciones').insert(entrada)
  } catch {
    /* noop */
  }
}

export const NOMBRE_BANDERA: Record<string, string> = {
  verde:         'Verde',
  amarilla:      'Amarilla',
  amarilla_doble:'Doble amarilla',
  roja:          'Roja',
  safety_car:    'Safety Car',
  cuadros:       'Cuadros',
  rayas:         'Rayas',
  azul:          'Azul',
  negra:         'Negra',
  negra_blanco:  'Advertencia (negra/blanca)',
  taller:        'A taller',
}

import { supabase } from '@/lib/supabase'
import { distanciaRecorridaKm } from '@/lib/gps'

export async function registrarPiloto({
  email, password, nombre, rut, telefono
}: {
  email: string
  password: string
  nombre: string
  rut: string
  telefono: string
}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nombre, rut, telefono }
    }
  })
  if (error) return { error: error.message }

  if (data.user) {
    // Esperamos brevemente para que el trigger de Supabase tenga tiempo de crear
    // el registro en pilotos antes de nuestro upsert.
    await new Promise(resolve => setTimeout(resolve, 800))

    // Upsert: si el trigger ya creó el registro, actualiza los datos.
    // Si por alguna razón no lo creó todavía, lo crea directamente.
    const { error: upsertError } = await supabase
      .from('pilotos')
      .upsert(
        { id: data.user.id, nombre, rut, telefono },
        { onConflict: 'id' }
      )

    if (upsertError) {
      // Si upsert falla por RLS, intentar solo el UPDATE
      await supabase
        .from('pilotos')
        .update({ nombre, rut, telefono })
        .eq('id', data.user.id)
    }
  }
  return { ok: true }
}

export async function loginPiloto(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: error.message }
  return { ok: true, user: data.user }
}

export async function cerrarSesion() {
  await supabase.auth.signOut()
}

export async function getPiloto() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('pilotos')
    .select('*, vehiculos(*)')
    .eq('id', user.id)
    .single()

  return data
}

export async function agregarVehiculo(piloto_id: string, marca: string, modelo: string) {
  const { error } = await supabase
    .from('vehiculos')
    .insert({ piloto_id, marca, modelo })
  return { error: error?.message }
}

export async function aprobarPrueba(piloto_id: string) {
  const hoy = new Date().toISOString().split('T')[0]
  const { error } = await supabase
    .from('pilotos')
    .update({ prueba_aprobada: true, prueba_fecha: hoy })
    .eq('id', piloto_id)
  return { error: error?.message }
}

export async function pruebaVigenteHoy(piloto_id: string) {
  const hoy = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('pilotos')
    .select('prueba_aprobada, prueba_fecha')
    .eq('id', piloto_id)
    .single()
  if (!data) return false
  return data.prueba_aprobada && data.prueba_fecha === hoy
}

// ── QR REAL ──

export async function generarQRToken(piloto_id?: string): Promise<string> {
  let uid = piloto_id
  if (!uid) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) throw new Error('No hay sesión activa')
    uid = user.id
  }

  // Verificar que el piloto existe en la tabla pilotos.
  // Si no existe (trigger aún no ejecutado), crearlo como fallback.
  const { data: pilotoExiste } = await supabase
    .from('pilotos')
    .select('id')
    .eq('id', uid)
    .single()

  if (!pilotoExiste) {
    // Fallback: obtener metadata del usuario y crear el registro
    const { data: { user } } = await supabase.auth.getUser()
    const meta = user?.user_metadata || {}
    await supabase
      .from('pilotos')
      .upsert({
        id: uid,
        nombre: meta.nombre || 'Piloto',
        rut: meta.rut || '',
        telefono: meta.telefono || '',
      }, { onConflict: 'id' })
  }

  // Invalida QR anteriores no usados de este piloto
  await supabase
    .from('qr_tokens')
    .update({ usado: true, usado_at: new Date().toISOString() })
    .eq('piloto_id', uid)
    .eq('usado', false)

  // Genera token único
  const token = `QR-${uid}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  const { error } = await supabase
    .from('qr_tokens')
    .insert({ piloto_id: uid, token, usado: false })

  if (error) throw new Error(error.message)
  return token
}

export interface ValidacionResult {
  valido: boolean
  motivo: string
  piloto?: {
    id: string
    nombre: string
    rut: string
    telefono?: string
    saldo_minutos: number
    bloqueado: boolean
    prueba_aprobada: boolean
  }
  qr_id?: string
  token?: string
}

export async function validarQRToken(
  token: string,
  maxPilotos: number = 20,
  _minSaldo: number = 0  // ignorado durante fase de pruebas
): Promise<ValidacionResult> {
  // 1. Buscar el token
  const { data: qr, error: qrError } = await supabase
    .from('qr_tokens')
    .select('id, piloto_id, usado, created_at')
    .eq('token', token)
    .eq('usado', false)
    .single()

  if (qrError || !qr) {
    return { valido: false, motivo: 'QR inválido o ya utilizado' }
  }

  // 2. Verificar expiración (15 minutos)
  const createdAt = new Date(qr.created_at).getTime()
  if (Date.now() - createdAt > 15 * 60 * 1000) {
    return { valido: false, motivo: 'QR expirado (máximo 15 minutos)' }
  }

  // 3. Obtener datos del piloto
  const { data: piloto, error: pilotoError } = await supabase
    .from('pilotos')
    .select('id, nombre, rut, telefono, saldo_minutos, bloqueado, prueba_aprobada')
    .eq('id', qr.piloto_id)
    .single()

  if (pilotoError || !piloto) {
    return { valido: false, motivo: 'Piloto no encontrado en el sistema' }
  }

  // 4. Verificar bloqueo explícito por el administrador
  if (piloto.bloqueado) {
    return { valido: false, motivo: 'Piloto bloqueado por el administrador', piloto }
  }

  // 5. Verificar capacidad de pista
  const { count } = await supabase
    .from('sesiones')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'activa')

  if ((count || 0) >= maxPilotos) {
    return {
      valido: false,
      motivo: `Pista al máximo de capacidad (${count}/${maxPilotos} autos)`,
      piloto
    }
  }

  // NOTA: No se verifica saldo_minutos durante fase de pruebas.
  // Cualquier piloto no bloqueado con QR válido puede ingresar.

  return {
    valido: true,
    motivo: 'Acceso autorizado',
    piloto,
    qr_id: qr.id,
    token,
  }
}

export async function cerrarSesionAdmin(piloto_id: string) {
  // Antes de cerrar, cosechar el historial permanente de la sesión:
  // minutos en pista, km recorridos (GPS) y velocidad máxima. Se asignan
  // al vehículo activo del piloto (o solo al piloto si no tiene ninguno).
  // Tolerante a fallos: si historial_pista no está migrada, cierra igual.
  try {
    const { data: ses } = await supabase
      .from('sesiones')
      .select('id, inicio')
      .eq('piloto_id', piloto_id)
      .eq('estado', 'activa')
      .maybeSingle()

    if (ses?.id) {
      const { data: ubic } = await supabase
        .from('ubicaciones_piloto')
        .select('lat, lng, velocidad')
        .eq('sesion_id', ses.id)
        .order('timestamp', { ascending: true })
        .limit(5000)

      const puntos  = (ubic || []).map(u => ({ lat: u.lat, lng: u.lng }))
      const velMax  = (ubic || []).reduce((m, u) => Math.max(m, u.velocidad || 0), 0)
      const minutos = Math.max(0, Math.round((Date.now() - new Date(ses.inicio).getTime()) / 60000))

      const { data: pil } = await supabase
        .from('pilotos')
        .select('vehiculo_activo_id')
        .eq('id', piloto_id)
        .maybeSingle()

      // sesion_id es UNIQUE: un doble cierre no duplica el historial
      await supabase.from('historial_pista').insert({
        piloto_id,
        sesion_id:   ses.id,
        vehiculo_id: (pil as any)?.vehiculo_activo_id ?? null,
        minutos,
        km:          distanciaRecorridaKm(puntos),
        vel_max:     velMax,
      })
    }
  } catch { /* noop */ }

  const { error } = await supabase
    .from('sesiones')
    .update({ estado: 'inactiva', fin: new Date().toISOString() })
    .eq('piloto_id', piloto_id)
    .eq('estado', 'activa')
  return { error: error?.message }
}

export async function confirmarIngreso(qr_id: string, piloto_id: string) {
  await supabase
    .from('qr_tokens')
    .update({ usado: true, usado_at: new Date().toISOString() })
    .eq('id', qr_id)

  const { data, error } = await supabase
    .from('sesiones')
    .insert({
      piloto_id,
      estado: 'activa',
      inicio: new Date().toISOString()
    })
    .select()
    .single()

  return { ok: !error, sesion: data, error: error?.message }
}

export async function getPilotosEnSesion() {
  const { data } = await supabase
    .from('sesiones')
    .select('*, pilotos(nombre, rut, saldo_minutos, bloqueado, prueba_aprobada, vehiculos(marca, modelo))')
    .eq('estado', 'activa')
    .order('inicio', { ascending: false })

  // Supabase devuelve el join bajo la clave "pilotos" (nombre de tabla).
  // Lo remapeamos a "piloto" para que coincida con la interfaz del admin.
  return (data || []).map((s: any) => ({ ...s, piloto: s.pilotos }))
}

export async function getTodosLosPilotos() {
  const { data } = await supabase
    .from('pilotos')
    .select('*, vehiculos(*)')
    .order('created_at', { ascending: false })
  return data || []
}

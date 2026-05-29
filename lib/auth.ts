import { supabase } from '@/lib/supabase'

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
    // El perfil en pilotos se crea automáticamente via trigger en Supabase.
    // Solo actualizamos los datos que el trigger recibe del metadata.
    await supabase
      .from('pilotos')
      .update({ nombre, rut, telefono })
      .eq('id', data.user.id)
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
  maxPilotos: number = 6,
  minSaldo: number = 0
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

  // 4. Verificar bloqueo
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

  return {
    valido: true,
    motivo: 'Acceso autorizado',
    piloto,
    qr_id: qr.id,
    token,
  }
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
    .select('*, pilotos(nombre, rut, saldo_minutos, vehiculos(marca, modelo))')
    .eq('estado', 'activa')
    .order('inicio', { ascending: false })

  return data || []
}

export async function getTodosLosPilotos() {
  const { data } = await supabase
    .from('pilotos')
    .select('*, vehiculos(*)')
    .order('created_at', { ascending: false })
  return data || []
}

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
    const { error: perfilError } = await supabase
      .from('pilotos')
      .insert({
        id: data.user.id,
        nombre,
        rut,
        telefono,
        prueba_aprobada: false,
        saldo_minutos: 0,
      })
    if (perfilError) return { error: perfilError.message }
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

export async function generarQRToken(piloto_id: string): Promise<string> {
  // Invalida QR anteriores no usados
  await supabase
    .from('qr_tokens')
    .update({ usado: true })
    .eq('piloto_id', piloto_id)
    .eq('usado', false)

  // Genera token único
  const token = `QR-${piloto_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  const { error } = await supabase
    .from('qr_tokens')
    .insert({ piloto_id, token, usado: false })

  if (error) throw new Error(error.message)
  return token
}

export async function validarQRToken(token: string, maxPilotos: number = 6, minSaldo: number = 5) {
  // Busca el token
  const { data: qr, error: qrError } = await supabase
    .from('qr_tokens')
    .select('*, pilotos(*, vehiculos(*))')
    .eq('token', token)
    .eq('usado', false)
    .single()

  if (qrError || !qr) {
    return { autorizado: false, motivo: 'QR inválido o ya utilizado' }
  }

  const piloto = qr.pilotos as any

  // Verifica bloqueo
  if (piloto.bloqueado) {
    return { autorizado: false, motivo: 'Piloto bloqueado por el administrador', piloto }
  }

  // Verifica saldo mínimo
  if (piloto.saldo_minutos < minSaldo) {
    return { autorizado: false, motivo: `Saldo insuficiente (${piloto.saldo_minutos} min disponibles, mínimo ${minSaldo} min)`, piloto }
  }

  // Verifica prueba aprobada hoy
  const hoy = new Date().toISOString().split('T')[0]
  if (!piloto.prueba_aprobada || piloto.prueba_fecha !== hoy) {
    return { autorizado: false, motivo: 'Prueba de conocimientos no aprobada para esta jornada', piloto }
  }

  // Verifica capacidad de pista
  const { count } = await supabase
    .from('sesiones')
    .select('*', { count: 'exact', head: true })
    .eq('estado', 'activa')

  if ((count || 0) >= maxPilotos) {
    return { autorizado: false, motivo: `Pista al máximo de capacidad (${count}/${maxPilotos} autos)`, piloto }
  }

  return {
    autorizado: true,
    piloto,
    qr_id: qr.id,
    token
  }
}

export async function confirmarIngreso(qr_id: string, piloto_id: string) {
  // Marca QR como usado
  await supabase
    .from('qr_tokens')
    .update({ usado: true, usado_at: new Date().toISOString() })
    .eq('id', qr_id)

  // Crea sesión activa
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
  const { data, error } = await supabase
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
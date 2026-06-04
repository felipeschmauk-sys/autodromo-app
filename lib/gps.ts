import { supabase } from '@/lib/supabase'

export interface Coordenada {
  lat: number
  lng: number
}

export interface UbicacionPiloto {
  piloto_id: string
  sesion_id: string
  lat: number
  lng: number
  velocidad: number
  precision_metros: number
  dentro_geocerca: boolean
}

// ── GEOCERCA ──────────────────────────────────────────────────

export async function getGeocercaActiva(): Promise<Coordenada[] | null> {
  const { data } = await supabase
    .from('geocerca')
    .select('coordenadas')
    .eq('activa', true)
    .single()

  return data?.coordenadas ?? null
}

export async function guardarGeocerca(
  coordenadas: Coordenada[],
  nombre: string = 'Pista Principal'
) {
  // Desactivar geocercas anteriores
  await supabase
    .from('geocerca')
    .update({ activa: false })
    .eq('activa', true)

  const { error } = await supabase
    .from('geocerca')
    .insert({ nombre, coordenadas, activa: true })

  return { error: error?.message }
}

// Algoritmo ray-casting para verificar si un punto está dentro de un polígono
export function puntoEnGeocerca(
  punto: Coordenada,
  poligono: Coordenada[]
): boolean {
  if (poligono.length < 3) return true // Sin geocerca definida, considerar dentro

  let dentro = false
  const n = poligono.length

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poligono[i].lng, yi = poligono[i].lat
    const xj = poligono[j].lng, yj = poligono[j].lat

    const intersecta =
      yi > punto.lat !== yj > punto.lat &&
      punto.lng < ((xj - xi) * (punto.lat - yi)) / (yj - yi) + xi

    if (intersecta) dentro = !dentro
  }

  return dentro
}

// ── GPS / UBICACIONES ─────────────────────────────────────────

export async function registrarUbicacion(ubicacion: UbicacionPiloto) {
  const { error } = await supabase
    .from('ubicaciones_piloto')
    .insert(ubicacion)

  return { error: error?.message }
}

export async function getUltimasUbicaciones() {
  // Obtiene la última ubicación de cada piloto con sesión activa
  const { data } = await supabase
    .from('ubicaciones_piloto')
    .select(`
      piloto_id,
      lat,
      lng,
      velocidad,
      dentro_geocerca,
      timestamp,
      pilotos(nombre)
    `)
    .order('timestamp', { ascending: false })
    .limit(50)

  if (!data) return []

  // Deduplicar: solo la última ubicación por piloto
  const porPiloto = new Map<string, typeof data[0]>()
  for (const u of data) {
    if (!porPiloto.has(u.piloto_id)) {
      porPiloto.set(u.piloto_id, u)
    }
  }

  return Array.from(porPiloto.values())
}

// ── HOOK REACT: useGPS ────────────────────────────────────────
// Uso: const { posicion, velocidad, dentroGeocerca, error } = useGPS(sesionId)
// Pegar este hook en el componente del piloto.

export type EstadoGPS = {
  posicion: Coordenada | null
  velocidad: number
  dentroGeocerca: boolean | null
  precision: number
  error: string | null
  activo: boolean
}

// Esta función devuelve una función de cleanup para usar en useEffect
export function iniciarGPS(
  pilotoId: string,
  sesionId: string,
  geocerca: Coordenada[],
  onActualizar: (estado: EstadoGPS) => void,
  intervaloMs: number = 4000
): () => void {
  let watchId: number | null = null
  let intervalo: ReturnType<typeof setInterval> | null = null
  let ultimaPosicion: GeolocationPosition | null = null

  const estado: EstadoGPS = {
    posicion: null,
    velocidad: 0,
    dentroGeocerca: null,
    precision: 0,
    error: null,
    activo: false,
  }

  if (!navigator.geolocation) {
    onActualizar({ ...estado, error: 'GPS no disponible en este dispositivo' })
    return () => {}
  }

  // Observar posición continuamente
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      ultimaPosicion = pos
      const coordenada: Coordenada = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      }
      const dentroGeocerca =
        geocerca.length >= 3
          ? puntoEnGeocerca(coordenada, geocerca)
          : null

      const nuevoEstado: EstadoGPS = {
        posicion: coordenada,
        velocidad: pos.coords.speed != null
          ? Math.round(pos.coords.speed * 3.6) // m/s → km/h
          : 0,
        dentroGeocerca,
        precision: Math.round(pos.coords.accuracy),
        error: null,
        activo: true,
      }

      Object.assign(estado, nuevoEstado)
      onActualizar({ ...estado })
    },
    (err) => {
      onActualizar({ ...estado, error: `Error GPS: ${err.message}`, activo: false })
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 2000,
    }
  )

  // Enviar a Supabase cada N segundos
  intervalo = setInterval(async () => {
    if (!ultimaPosicion) return

    const coordenada: Coordenada = {
      lat: ultimaPosicion.coords.latitude,
      lng: ultimaPosicion.coords.longitude,
    }

    await registrarUbicacion({
      piloto_id: pilotoId,
      sesion_id: sesionId,
      lat: coordenada.lat,
      lng: coordenada.lng,
      velocidad: ultimaPosicion.coords.speed != null
        ? Math.round(ultimaPosicion.coords.speed * 3.6)
        : 0,
      precision_metros: Math.round(ultimaPosicion.coords.accuracy),
      dentro_geocerca:
        geocerca.length >= 3
          ? puntoEnGeocerca(coordenada, geocerca)
          : true,
    })
  }, intervaloMs)

  // Cleanup
  return () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId)
    if (intervalo !== null) clearInterval(intervalo)
  }
}

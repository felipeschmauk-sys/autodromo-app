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
  // Geocerca del recinto (null = recinto sin configurar)
  dentro_recinto?: boolean | null
}

// ── SECTORES ──────────────────────────────────────────────────
// Un sector con punto_inicio > punto_fin "cruza la línea de meta":
// va desde inicio hasta el final del trazado y sigue desde 0 hasta fin.
// Usar SIEMPRE estos helpers al trabajar con rangos de sector.

export function sectorContienePunto(idx: number, inicio: number, fin: number): boolean {
  return inicio <= fin
    ? idx >= inicio && idx <= fin
    : idx >= inicio || idx <= fin
}

export function sectorSlice<T>(trazado: T[], inicio: number, fin: number): T[] {
  return inicio <= fin
    ? trazado.slice(inicio, fin + 1)
    : [...trazado.slice(inicio), ...trazado.slice(0, fin + 1)]
}

// Largo del sector en cantidad de puntos (circular)
export function sectorLargo(inicio: number, fin: number, total: number): number {
  return inicio <= fin ? fin - inicio : (total - inicio) + fin
}

// Distancia recorrida en km sobre puntos GPS consecutivos (Haversine).
// Filtra saltos > 300 m entre lecturas (jitter o pérdida de señal).
export function distanciaRecorridaKm(puntos: Coordenada[]): number {
  let total = 0
  for (let i = 1; i < puntos.length; i++) {
    const R  = 6371
    const d1 = (puntos[i].lat - puntos[i - 1].lat) * Math.PI / 180
    const d2 = (puntos[i].lng - puntos[i - 1].lng) * Math.PI / 180
    const a  = Math.sin(d1 / 2) ** 2
             + Math.cos(puntos[i - 1].lat * Math.PI / 180)
             * Math.cos(puntos[i].lat     * Math.PI / 180)
             * Math.sin(d2 / 2) ** 2
    const d  = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (d < 0.3) total += d
  }
  return Math.round(total * 100) / 100
}

// ── TRAZADO DE PISTA ──────────────────────────────────────────

export async function getTrazadoActivo(): Promise<Coordenada[] | null> {
  const { data } = await supabase
    .from('trazado_pista')
    .select('coordenadas')
    .eq('activo', true)
    .single()
  return data?.coordenadas ?? null
}

export async function guardarTrazado(
  coordenadas: Coordenada[],
  nombre: string = 'Circuito principal'
) {
  // Actualizar fila activa existente (evita INSERT bloqueado por RLS)
  const { data: activo } = await supabase
    .from('trazado_pista')
    .select('id')
    .eq('activo', true)
    .maybeSingle()

  if (activo?.id) {
    const { error } = await supabase
      .from('trazado_pista')
      .update({ nombre, coordenadas })
      .eq('id', activo.id)
    return { error: error?.message }
  }

  // Sin fila activa → tomar cualquier fila y activarla
  const { data: cualquiera } = await supabase
    .from('trazado_pista')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (cualquiera?.id) {
    const { error } = await supabase
      .from('trazado_pista')
      .update({ nombre, coordenadas, activo: true })
      .eq('id', cualquiera.id)
    return { error: error?.message }
  }

  // Tabla vacía → insertar (setup inicial, requiere RLS permisivo)
  const { error } = await supabase
    .from('trazado_pista')
    .insert({ nombre, coordenadas, activo: true })
  return { error: error?.message }
}

// ── GEOCERCA ──────────────────────────────────────────────────

export async function getGeocercaActiva(
  tipo: 'pista' | 'recinto' = 'pista'
): Promise<GeocercaCoords | null> {
  const { data } = await supabase
    .from('geocerca')
    .select('coordenadas')
    .eq('activa', true)
    .eq('tipo', tipo)
    .maybeSingle()

  return data?.coordenadas ?? null
}

export async function guardarGeocerca(
  coordenadas: GeocercaCoords,
  tipo: 'pista' | 'recinto' = 'pista',
  nombre?: string
) {
  const nombreDefault = tipo === 'recinto' ? 'Recinto' : 'Pista Principal'

  // Actualizar fila activa existente del mismo tipo (evita INSERT bloqueado por RLS)
  const { data: activa } = await supabase
    .from('geocerca')
    .select('id')
    .eq('activa', true)
    .eq('tipo', tipo)
    .maybeSingle()

  if (activa?.id) {
    const { error } = await supabase
      .from('geocerca')
      .update({ nombre: nombre ?? nombreDefault, coordenadas })
      .eq('id', activa.id)
    return { error: error?.message }
  }

  // Sin fila activa del tipo → tomar cualquier fila del mismo tipo
  const { data: cualquiera } = await supabase
    .from('geocerca')
    .select('id')
    .eq('tipo', tipo)
    .limit(1)
    .maybeSingle()

  if (cualquiera?.id) {
    const { error } = await supabase
      .from('geocerca')
      .update({ nombre: nombre ?? nombreDefault, coordenadas, activa: true })
      .eq('id', cualquiera.id)
    return { error: error?.message }
  }

  // Sin ninguna fila del tipo → insertar (setup inicial)
  const { error } = await supabase
    .from('geocerca')
    .insert({ nombre: nombre ?? nombreDefault, coordenadas, activa: true, tipo })

  return { error: error?.message }
}

// ── Geocercas de varios anillos: islas y agujeros ─────────────
//
// La geocerca de pista es un ANILLO: una banda alrededor del circuito. Un
// anillo no se puede dibujar con un solo polígono sin hacerle un corte que
// una el borde exterior con el interior. Ese corte estaba puesto en la meta, y
// los autos que pasaban justo por ahí quedaban clasificados "fuera de pista" —
// lo que hacía perder cruces de meta (carrera del 9 ago 2026: 3 vueltas).
//
// Con varios anillos no hace falta cortar nada.
export type GeocercaCoords = Coordenada[] | Coordenada[][]

/** Normaliza a lista de anillos. Acepta el formato antiguo de un solo polígono. */
export function anillosGeocerca(g: GeocercaCoords | null | undefined): Coordenada[][] {
  if (!g || g.length === 0) return []
  return Array.isArray((g as Coordenada[][])[0])
    ? (g as Coordenada[][]).filter((a) => Array.isArray(a))
    : [g as Coordenada[]]
}

/** ¿Hay al menos un anillo utilizable? Reemplaza a los viejos `.length >= 3`. */
export function geocercaDefinida(g: GeocercaCoords | null | undefined): boolean {
  return anillosGeocerca(g).some((a) => a.length >= 3)
}

// Ray-casting con regla PAR-IMPAR aplicada a todos los anillos de una vez.
// De ahí sale gratis lo que se necesita: dos anillos separados se comportan
// como islas (unión) y un anillo dentro de otro como agujero, sin una sola
// línea de lógica extra.
export function puntoEnGeocerca(
  punto: Coordenada,
  geocerca: GeocercaCoords
): boolean {
  const anillos = anillosGeocerca(geocerca).filter((a) => a.length >= 3)
  if (anillos.length === 0) return true // Sin geocerca definida, considerar dentro

  let dentro = false

  for (const poligono of anillos) {
    const n = poligono.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poligono[i].lng, yi = poligono[i].lat
      const xj = poligono[j].lng, yj = poligono[j].lat

      const intersecta =
        yi > punto.lat !== yj > punto.lat &&
        punto.lng < ((xj - xi) * (punto.lat - yi)) / (yj - yi) + xi

      if (intersecta) dentro = !dentro
    }
  }

  return dentro
}

// ── GPS / UBICACIONES ─────────────────────────────────────────

export async function registrarUbicacion(ubicacion: UbicacionPiloto) {
  const { error } = await supabase
    .from('ubicaciones_piloto')
    .insert(ubicacion)

  // Compatibilidad: si la migración task-gps-recinto aún no se corrió,
  // reintentar sin la columna dentro_recinto para no perder la ubicación
  if (error && ubicacion.dentro_recinto !== undefined && /dentro_recinto/i.test(error.message)) {
    const { dentro_recinto: _omitido, ...sinRecinto } = ubicacion
    const { error: error2 } = await supabase
      .from('ubicaciones_piloto')
      .insert(sinRecinto)
    return { error: error2?.message }
  }

  return { error: error?.message }
}

// ── TRAZA GPS CRUDA (diagnóstico de cronometraje) ─────────────
// Una fila por lectura del GPS (~1 Hz), con lo que el detector de cruces
// calculó en ese mismo instante. Permite reprocesar una tanda entera en el
// escritorio —probando otros umbrales, buscando vueltas salteadas— sin volver
// a pista. Se manda en lotes: una request por segundo por piloto sería
// desperdiciar la conexión justo cuando más se necesita.

export interface FilaTrazaGps {
  piloto_id: string
  sesion_id: string
  tanda_id: string | null
  t_dispositivo: string
  offset_ms: number | null
  lat: number
  lng: number
  precision_m: number | null
  velocidad_ms: number | null
  rumbo: number | null
  idx_trazado: number | null
  progreso: number | null
  armado: boolean | null
  dentro_geocerca: boolean | null
}

export async function registrarTrazaGps(filas: FilaTrazaGps[]) {
  if (filas.length === 0) return { error: undefined }
  try {
    const { error } = await supabase.from('traza_gps').insert(filas)
    return { error: error?.message }
  } catch {
    // Sin señal en pista: se avisa como error de red para que el lote
    // vuelva al buffer y se reintente, en vez de perderse
    return { error: 'red' }
  }
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
  geocerca: GeocercaCoords,
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
        geocercaDefinida(geocerca)
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
        geocercaDefinida(geocerca)
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

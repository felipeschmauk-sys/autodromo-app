"use client";

/**
 * GpsPiloto.tsx — COLOCAR en: components/GpsPiloto.tsx
 *
 * Panel GPS para la app del piloto.
 * - Si tiene sesión activa → monitorea GPS y envía posición a Supabase
 * - Si no tiene sesión → modo observador (ve flags, no genera alertas)
 *
 * USO en app/page.tsx (en la sección de la tab "pista" o dentro del app):
 *   import GpsPiloto from '@/components/GpsPiloto'
 *   <GpsPiloto pilotoId={pilotoData?.id} />
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getGeocercaActiva,
  puntoEnGeocerca,
  registrarUbicacion,
  type Coordenada,
} from "@/lib/gps";

interface Props {
  pilotoId?: string;
}

interface SesionActiva {
  id: string;
  piloto_id: string;
  inicio: string;
  estado: string;
}

interface EstadoPista {
  bandera: "verde" | "amarilla" | "amarilla_doble" | "roja" | "blanca" | "negra";
  sector?: string;
  mensaje?: string;
}

const BANDERAS: Record<string, { color: string; bg: string; label: string; emoji: string }> = {
  verde:         { color: "text-green-400",  bg: "bg-green-950 border-green-800",   label: "Pista despejada",    emoji: "🟢" },
  amarilla:      { color: "text-yellow-400", bg: "bg-yellow-950 border-yellow-800", label: "Precaución",         emoji: "🟡" },
  amarilla_doble:{ color: "text-yellow-300", bg: "bg-yellow-950 border-yellow-700", label: "Peligro — no adelantar", emoji: "🟡🟡" },
  roja:          { color: "text-red-400",    bg: "bg-red-950 border-red-800",       label: "DETENCIÓN TOTAL",    emoji: "🔴" },
  blanca:        { color: "text-gray-300",   bg: "bg-gray-900 border-gray-700",     label: "Vehículo lento",     emoji: "⬜" },
  negra:         { color: "text-gray-100",   bg: "bg-gray-950 border-gray-600",     label: "Entre a boxes",      emoji: "⬛" },
};

export default function GpsPiloto({ pilotoId }: Props) {
  const [sesion, setSesion] = useState<SesionActiva | null>(null);
  const [geocerca, setGeocerca] = useState<Coordenada[]>([]);
  const [velocidad, setVelocidad] = useState<number>(0);
  const [dentroGeocerca, setDentroGeocerca] = useState<boolean | null>(null);
  const [gpsActivo, setGpsActivo] = useState(false);
  const [precision, setPrecision] = useState<number>(0);
  const [estadoPista, setEstadoPista] = useState<EstadoPista>({ bandera: "verde" });
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [tiempoSesion, setTiempoSesion] = useState<string>("00:00");

  const watchIdRef = useRef<number | null>(null);
  const intervaloGpsRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const intervaloTiempoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ultimaPosRef = useRef<GeolocationPosition | null>(null);

  // Cargar sesión activa y geocerca al montar
  useEffect(() => {
    if (!pilotoId) return;

    // Buscar sesión activa del piloto
    supabase
      .from("sesiones")
      .select("*")
      .eq("piloto_id", pilotoId)
      .eq("estado", "activa")
      .single()
      .then(({ data }) => {
        if (data) setSesion(data);
      });

    // Cargar geocerca
    getGeocercaActiva().then((coords) => {
      if (coords) setGeocerca(coords);
    });
  }, [pilotoId]);

  // Iniciar GPS cuando hay sesión activa
  useEffect(() => {
    if (!sesion || !pilotoId) return;
    if (!navigator.geolocation) {
      setErrorGps("GPS no disponible en este dispositivo");
      return;
    }

    setGpsActivo(true);
    setErrorGps(null);

    // Observar posición
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        ultimaPosRef.current = pos;
        const vel = pos.coords.speed != null
          ? Math.round(pos.coords.speed * 3.6)
          : 0;
        setVelocidad(vel);
        setPrecision(Math.round(pos.coords.accuracy));

        const coord: Coordenada = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (geocerca.length >= 3) {
          setDentroGeocerca(puntoEnGeocerca(coord, geocerca));
        }
      },
      (err) => {
        setErrorGps(`GPS: ${err.message}`);
        setGpsActivo(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );

    // Enviar posición a Supabase cada 4 segundos
    intervaloGpsRef.current = setInterval(async () => {
      const pos = ultimaPosRef.current;
      if (!pos || !pilotoId || !sesion?.id) return;

      const coord: Coordenada = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dentro = geocerca.length >= 3 ? puntoEnGeocerca(coord, geocerca) : true;

      await registrarUbicacion({
        piloto_id: pilotoId,
        sesion_id: sesion.id,
        lat: coord.lat,
        lng: coord.lng,
        velocidad: pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : 0,
        precision_metros: Math.round(pos.coords.accuracy),
        dentro_geocerca: dentro,
      });
    }, 4000);

    // Contador de tiempo en sesión
    const inicio = new Date(sesion.inicio).getTime();
    intervaloTiempoRef.current = setInterval(() => {
      const diff = Math.floor((Date.now() - inicio) / 1000);
      const m = Math.floor(diff / 60).toString().padStart(2, "0");
      const s = (diff % 60).toString().padStart(2, "0");
      setTiempoSesion(`${m}:${s}`);
    }, 1000);

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (intervaloGpsRef.current) clearInterval(intervaloGpsRef.current);
      if (intervaloTiempoRef.current) clearInterval(intervaloTiempoRef.current);
    };
  }, [sesion, pilotoId, geocerca]);

  // Suscripción Realtime al estado de pista (banderas)
  useEffect(() => {
    const channel = supabase
      .channel("estado-pista-piloto")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "estado_pista" },
        (payload) => {
          const nuevo = payload.new as any;
          if (nuevo) {
            setEstadoPista({
              bandera: nuevo.bandera || "verde",
              sector: nuevo.sector,
              mensaje: nuevo.mensaje,
            });
          }
        }
      )
      .subscribe();

    // Cargar estado actual de pista
    supabase
      .from("estado_pista")
      .select("*")
      .eq("activo", true)
      .single()
      .then(({ data }) => {
        if (data) setEstadoPista({ bandera: data.bandera, sector: data.sector, mensaje: data.mensaje });
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  const bandera = BANDERAS[estadoPista.bandera] || BANDERAS.verde;
  const esBanderaRoja = estadoPista.bandera === "roja";

  return (
    <div className="flex flex-col gap-3">

      {/* Estado de pista — siempre visible (modo observador) */}
      <div className={`rounded-2xl border p-4 ${bandera.bg} ${esBanderaRoja ? "animate-pulse" : ""}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Estado de pista</p>
            <p className={`text-lg font-bold ${bandera.color}`}>
              {bandera.emoji} {bandera.label}
            </p>
            {estadoPista.sector && (
              <p className="text-xs text-gray-400 mt-0.5">Sector: {estadoPista.sector}</p>
            )}
            {estadoPista.mensaje && (
              <p className="text-xs text-gray-400 mt-0.5">{estadoPista.mensaje}</p>
            )}
          </div>
          {esBanderaRoja && (
            <div className="text-4xl">🚩</div>
          )}
        </div>
      </div>

      {/* Panel GPS — solo si hay sesión activa */}
      {sesion ? (
        <>
          {/* Velocímetro */}
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-5">
            <div className="flex items-end justify-between mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Velocidad</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${gpsActivo ? "bg-green-400 animate-pulse" : "bg-red-500"}`} />
                <span className="text-xs text-gray-500">
                  {gpsActivo ? `GPS ±${precision}m` : "Sin GPS"}
                </span>
              </div>
            </div>

            <div className="flex items-baseline gap-2 justify-center py-2">
              <span className="text-6xl font-black tabular-nums text-white">
                {velocidad}
              </span>
              <span className="text-xl text-gray-500 font-medium">km/h</span>
            </div>

            {/* Estado geocerca */}
            <div className="mt-4 flex items-center justify-between">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
                dentroGeocerca === null
                  ? "bg-gray-800 text-gray-400"
                  : dentroGeocerca
                  ? "bg-green-950 border border-green-800 text-green-400"
                  : "bg-red-950 border border-red-800 text-red-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  dentroGeocerca === null ? "bg-gray-500" : dentroGeocerca ? "bg-green-400" : "bg-red-400"
                }`} />
                {dentroGeocerca === null
                  ? "Verificando posición..."
                  : dentroGeocerca
                  ? "En pista — cobro activo"
                  : "Fuera de pista"}
              </div>

              {/* Tiempo en sesión */}
              <div className="text-right">
                <p className="text-xs text-gray-600">Tiempo en pista</p>
                <p className="text-sm font-mono font-semibold text-gray-300">{tiempoSesion}</p>
              </div>
            </div>
          </div>

          {/* Error GPS */}
          {errorGps && (
            <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-xs text-red-400">
              ⚠️ {errorGps}
            </div>
          )}

          {/* Permiso GPS si no está activo */}
          {!gpsActivo && !errorGps && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-xs text-gray-400 text-center">
              Activando GPS... Asegúrese de permitir el acceso a la ubicación.
            </div>
          )}
        </>
      ) : (
        /* Sin sesión activa — modo observador */
        <div className="rounded-2xl border border-gray-800 bg-gray-950 p-5 text-center">
          <p className="text-gray-600 text-sm mb-1">Sin sesión activa</p>
          <p className="text-xs text-gray-700">
            El cobro y el monitoreo GPS se activan cuando el administrador confirma su ingreso a pista.
          </p>
        </div>
      )}
    </div>
  );
}

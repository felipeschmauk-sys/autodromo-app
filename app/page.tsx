"use client";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { getTrazadoActivo, getGeocercaActiva, puntoEnGeocerca, registrarUbicacion, type Coordenada } from "@/lib/gps";
import { supabase } from "@/lib/supabase";

const LeafletPilotMap = dynamic(() => import("@/components/LeafletPilotMap"), { ssr: false });
import {
  registrarPiloto,
  loginPiloto,
  cerrarSesion,
  getPiloto,
  agregarVehiculo,
  aprobarPrueba,
  generarQRToken,
} from "@/lib/auth";
import QRCode from "react-qr-code";

type Stage = "login" | "registro" | "prueba" | "eventos" | "app";
type SecView = "main" | "perfil" | "saldo" | "reglamento";

interface EventoActivo {
  inscripcionId: string;
  fechaId: string;
  campeonatoNombre: string;
  fechaNombre: string;
  tipo: "racing" | "track_day" | "entrenamiento";
  estadoInsc: string;
}
interface CampeonatoItem { id: string; nombre: string; temporada: number; descripcion: string | null; }
interface FechaItem {
  id: string; nombre: string; fecha_evento: string;
  autodromo: string | null; trazado: string | null;
  cupos_max: number; estado: string;
  tipo: "racing" | "track_day" | "entrenamiento";
  campeonato_id: string;
}
interface InscripcionItem {
  id: string; fecha_id: string; estado: string; pago_estado: string;
}
type EstadoPiloto = "deshabilitado" | "pendiente" | "habilitado";

interface Sector {
  id: string;
  nombre: string;
  orden: number;
  punto_inicio: number;
  punto_fin: number;
  bandera: string;
}

// ── Cuestionario ──────────────────────────────────────────────
// Preguntas basadas en el Reglamento Deportivo y Técnico TCC 2026
const PREGUNTAS = [
  {
    pregunta: "Según el Reglamento Deportivo TCC, ¿cuántos cambios de línea puede realizar un piloto para defender su posición?",
    opciones: ["Dos cambios de línea antes del frenado", "Un solo cambio de línea antes de la zona de frenado", "Los que necesite, siempre que evite contacto", "Ninguno, la defensa activa no está permitida"],
    correcta: 1,
  },
  {
    pregunta: "Al mostrarse la bandera roja en pista, ¿qué debe hacer todo piloto según el reglamento TCC?",
    opciones: ["Acelerar para salir rápido de la zona peligrosa", "Reducir velocidad, no adelantar y dirigirse a boxes", "Solo se detienen los vehículos cercanos al incidente", "Puede continuar si se encuentra en la recta principal"],
    correcta: 1,
  },
  {
    pregunta: "Bajo bandera amarilla en un sector de pista, ¿se permite adelantar a otro vehículo?",
    opciones: ["Sí, si se hace con precaución y reduciendo velocidad", "Sí, solo si el auto adelantado circula muy lento", "No está permitido adelantar a ningún auto mientras se esté en sector de bandera amarilla", "Solo si el safety car ya regresó a boxes"],
    correcta: 2,
  },
  {
    pregunta: "Durante el procedimiento de Safety Car, ¿qué conducta está estrictamente prohibida?",
    opciones: ["Mantener distancia prudente con el auto de adelante", "Adelantar a otro competidor", "Reducir la velocidad al mínimo seguro", "Obedecer las instrucciones de Dirección de Carrera"],
    correcta: 1,
  },
  {
    pregunta: "¿Cuál de los siguientes elementos de seguridad personal es OBLIGATORIO para todo piloto según el Reglamento Técnico TCC 2026?",
    opciones: ["Intercomunicador de radio con el equipo", "HANS o sistema equivalente de protección cervical", "Guantes de cuero sin certificación específica", "Casco de motociclismo con visera integrada"],
    correcta: 1,
  },
  {
    pregunta: "Según el Reglamento TCC, ¿qué obligación tiene el piloto respecto a la cámara de video a bordo?",
    opciones: ["Es recomendada pero no obligatoria", "Solo es obligatoria en carreras, no en entrenamientos", "Debe estar correctamente instalada, encendida y operativa durante clasificación y carreras", "Solo la exige el autódromo, no el reglamento TCC"],
    correcta: 2,
  },
  {
    pregunta: "Según el Reglamento Deportivo TCC, ¿cuál de las siguientes conductas es considerada FALTA GRAVE?",
    opciones: ["Retraso menor al formarse en la grilla de salida", "Sobrepaso bajo Safety Car o bajo bandera amarilla", "Exceder levemente los límites de pista sin obtener ventaja", "Primera infracción operativa menor sin consecuencias"],
    correcta: 1,
  },
  {
    pregunta: "Cuando un piloto se salta una chicana y obtiene ventaja deportiva, ¿qué establece el reglamento TCC como primera consecuencia?",
    opciones: ["Nada, si no hay reclamo formal no se actúa", "Devolver la posición o exponerse a penalidad de 10 segundos", "Solo se sanciona a partir de la segunda infracción", "El piloto debe reportarlo voluntariamente al terminar la carrera"],
    correcta: 1,
  },
  {
    pregunta: "¿Qué puede ocurrir si un piloto no asiste a la reunión obligatoria de pilotos antes de una fecha TCC?",
    opciones: ["Nada, la asistencia es solo recomendada", "Puede ser sancionado, largar desde el último lugar o quedar impedido de participar", "Solo pierde el punto extra de qualy", "Debe pagar una multa económica establecida en el reglamento"],
    correcta: 1,
  },
  {
    pregunta: "Si una carrera TCC es detenida definitivamente habiendo completado el 50% o más de su duración programada, ¿qué establece el reglamento?",
    opciones: ["No se asigna puntaje en ningún caso", "La organización puede asignar puntaje completo según el último orden oficial determinado", "La carrera se reprograma obligatoriamente en otra fecha", "Solo se asigna puntaje a los tres primeros clasificados"],
    correcta: 1,
  },
];

// Para la sección Reglamento
const BANDERAS_INFO = [
  { color: "bg-red-500",    nombre: "Bandera roja",            desc: "Detención inmediata de todos los vehículos en pista. El cobro se pausa. Ningún piloto puede ignorarla." },
  { color: "bg-yellow-400", nombre: "Bandera amarilla",        desc: "Peligro en la zona indicada. Reducir velocidad, no adelantar y estar preparado para detenerse." },
  { color: "bg-yellow-400", nombre: "Bandera amarilla doble",  desc: "Peligro grave o vehículo detenido en pista. Velocidad máxima reducida. Adelantar estrictamente prohibido." },
  { color: "bg-green-500",  nombre: "Bandera verde",           desc: "Pista despejada. Circulación normal habilitada." },
  { color: "bg-orange-500", nombre: "Safety Car",              desc: "Vehículo de seguridad en pista. Todos los pilotos deben seguirlo sin adelantar." },
  { color: "bg-white border border-gray-600", nombre: "Bandera blanca", desc: "Vehículo lento en pista (ambulancia, grúa, seguridad). Precaución máxima." },
  { color: "bg-gray-900 border border-gray-600",  nombre: "Bandera negra", desc: "El piloto señalado debe ingresar a boxes inmediatamente." },
];

// ── Secciones del reglamento TCC 2026 (para mostrar en la app) ──
const REGLAMENTO_TCC = [
  {
    titulo: "Espíritu de la categoría",
    icono: "🏎️",
    items: [
      "TCC es una categoría competitiva, amateur y formativa basada en el respeto, caballerosidad y seguridad.",
      "La competencia en pista NO autoriza maniobras temerarias, agresivas o antideportivas.",
      "Todo piloto debe mantener autocontrol, respeto por los demás y por las autoridades de carrera.",
    ],
  },
  {
    titulo: "Conducta en pista",
    icono: "⚠️",
    items: [
      "Defensa de posición: solo UN cambio de línea antes de la zona de frenado. No se permite zigzaguear.",
      "Derecho al espacio: si el auto atacante tiene superposición suficiente antes del frenado, ambos deben dejar espacio.",
      "Sobrepaso: respetar siempre el espacio del adversario. El atacante sin superposición debe levantar.",
      "Reincorporación: al volver a pista luego de una salida, hacerlo de forma segura sin interferir con los que vienen.",
      "Conductas prohibidas: contacto evitable, frenadas injustificadas, más de un cambio de línea para defender, sobrepasos bajo bandera amarilla o safety car.",
    ],
  },
  {
    titulo: "Protocolo de banderas",
    icono: "🚩",
    items: [
      "🔴 Bandera Roja: detención INMEDIATA. Reducir velocidad, no adelantar, dirigirse a boxes según instrucción.",
      "🟡 Bandera Amarilla: peligro en la zona. Reducir velocidad, NO adelantar (salvo auto detenido con falla).",
      "🟡🟡 Doble Amarilla: peligro grave. Velocidad máxima reducida. Adelantar estrictamente prohibido.",
      "🟢 Bandera Verde: pista libre, circulación normal habilitada.",
      "🚗 Safety Car: seguir al vehículo de seguridad, mantener orden, NO adelantar.",
      "⬜ Bandera Blanca: vehículo lento en pista (ambulancia, grúa). Máxima precaución.",
      "⬛ Bandera Negra: el piloto señalado debe ingresar a boxes inmediatamente.",
    ],
  },
  {
    titulo: "Seguridad del piloto — Obligatorio",
    icono: "🛡️",
    items: [
      "Casco apto para automovilismo deportivo, en buen estado, correctamente ajustado.",
      "HANS o sistema equivalente de protección cervical homologado. Su uso es OBLIGATORIO.",
      "Buzo ignífugo apto para automovilismo deportivo, sin roturas ni modificaciones.",
      "Balaclava ignífuga bajo el casco durante toda la actividad en pista.",
      "Guantes ignífugos aptos para automovilismo deportivo.",
      "Zapatos o botas ignífugas. No se permiten zapatillas ni calzado de calle.",
      "Todo el equipamiento debe usarse correctamente durante: entrenamientos, clasificación y carreras.",
    ],
  },
  {
    titulo: "Safety Car y neutralizaciones",
    icono: "🚨",
    items: [
      "Bajo Safety Car: mantener posición, velocidad controlada y fila ordenada. NO adelantar.",
      "El puntero es responsable de mantener velocidad pareja y constante durante el procedimiento.",
      "Relanzamiento: no adelantar hasta la señal oficial de reinicio dada por Dirección de Carrera.",
      "Si la carrera se suspende antes del 50%: posible medio puntaje o sin puntaje.",
      "Si la carrera se suspende con 50% o más completado: se puede asignar puntaje completo según el último orden oficial.",
    ],
  },
  {
    titulo: "Sanciones — Tabla base TCC",
    icono: "⚖️",
    items: [
      "Falta Leve: advertencia o penalidad de 0 a 10 seg. (ej: exceso menor de límites sin ventaja, retraso en grilla).",
      "Falta Media: 5 a 20 seg. o pérdida de grilla (ej: saltarse chicana, defensa irregular, exceso de velocidad en pits).",
      "Falta Grave: 20 seg., exclusión o suspensión (ej: sobrepaso bajo amarilla/safety car, desobedecer bandera roja, maniobra temeraria).",
      "Chicana: 1ª infracción → devolver posición o 10 seg. | 2ª → 20 seg. | 3ª → exclusión de carrera.",
      "Falsa largada: penalidad de tiempo, pérdida de posición o exclusión según gravedad.",
      "La organización puede agravar o reducir cualquier sanción según los antecedentes del caso.",
    ],
  },
  {
    titulo: "Reunión de pilotos",
    icono: "📋",
    items: [
      "La reunión de pilotos es OBLIGATORIA para todos los participantes de cada fecha.",
      "El piloto que no asista puede ser sancionado, largar desde el último lugar o quedar impedido de participar.",
      "En la reunión se informan: horarios, límites de pista, chicanas, banderas, largada, safety car, sanciones especiales.",
    ],
  },
];

// Config visual para la pizarra de banderas
const FLAG_CONFIG: Record<string, {
  bg: string; border: string; color: string; subColor: string;
  emoji: string; title: string; desc: string; pulse: boolean;
}> = {
  // Colores SÓLIDOS y llamativos (fondo = color real de la bandera, sin pulso)
  verde:          { bg: "bg-green-600",  border: "border-green-700",  color: "text-white",      subColor: "text-white/80",   emoji: "🟢",    title: "PISTA LIBRE",      desc: "Circulación normal habilitada",                       pulse: false },
  amarilla:       { bg: "bg-yellow-400", border: "border-yellow-500", color: "text-black",      subColor: "text-black/70",   emoji: "🟡",    title: "BANDERA AMARILLA", desc: "Reducir velocidad · Prohibido adelantar",              pulse: false },
  amarilla_doble: { bg: "bg-yellow-400", border: "border-yellow-500", color: "text-black",      subColor: "text-black/70",   emoji: "🟡🟡", title: "DOBLE AMARILLA",   desc: "Peligro grave · Velocidad reducida · No adelantar",    pulse: false },
  roja:           { bg: "bg-red-600",    border: "border-red-700",    color: "text-white",      subColor: "text-white/85",   emoji: "🔴",    title: "BANDERA ROJA",     desc: "Detención inmediata · Dirigirse a boxes",              pulse: false },
  safety_car:     { bg: "bg-yellow-400", border: "border-yellow-500", color: "text-black",      subColor: "text-black/70",   emoji: "🚗",    title: "SAFETY CAR",       desc: "Seguir al safety car · No adelantar",                 pulse: false },
  blanca:         { bg: "bg-gray-100",   border: "border-gray-300",   color: "text-gray-900",   subColor: "text-gray-600",   emoji: "⬜",    title: "VEHÍCULO LENTO",  desc: "Máxima precaución · No adelantar",                    pulse: false },
  negra:          { bg: "bg-black",      border: "border-gray-700",   color: "text-white",      subColor: "text-white/70",   emoji: "⬛",    title: "INGRESE A BOXES", desc: "El piloto señalado debe retirarse de pista",          pulse: false },
  // ── Task #58: banderas personales, de sector y cuadros ──
  negra_blanco:   { bg: "bg-gray-800",   border: "border-gray-600",   color: "text-white",      subColor: "text-white/70",   emoji: "⬛⬜", title: "ADVERTENCIA",      desc: "Conducta antideportiva · Última advertencia",         pulse: false },
  azul:           { bg: "bg-blue-600",   border: "border-blue-700",   color: "text-white",      subColor: "text-white/80",   emoji: "🔵",    title: "BANDERA AZUL",     desc: "Auto más rápido se aproxima · Facilite el paso",      pulse: false },
  taller:         { bg: "bg-violet-600", border: "border-violet-700", color: "text-white",      subColor: "text-white/80",   emoji: "🔧",    title: "INGRESE A TALLER", desc: "Dirigirse a boxes de inmediato",                      pulse: false },
  rayas:          { bg: "bg-yellow-400", border: "border-red-600",    color: "text-red-700",    subColor: "text-red-800/80", emoji: "⚠️",    title: "PISTA RESBALADIZA", desc: "Aceite o escombros en el sector · Máxima precaución", pulse: false },
  cuadros:        { bg: "bg-black",      border: "border-gray-600",   color: "text-white",      subColor: "text-white/70",   emoji: "🏁",    title: "BANDERA DE CUADROS", desc: "Fin de la sesión · Ingrese a boxes",                pulse: false },
};

// ── Task #58: detección de sector por posición GPS ────────────
function findClosestIdx(lat: number, lng: number, trazado: Coordenada[]): number {
  let minD = Infinity, closest = 0;
  trazado.forEach((c, i) => {
    const d = (lat - c.lat) ** 2 + (lng - c.lng) ** 2;
    if (d < minD) { minD = d; closest = i; }
  });
  return closest;
}

// ── Componente: Speed Card (zona amarilla portrait) ──────────
function SpeedCard({
  geocercaCoords,
  recintoCoords = [],
  activo = true,
  onGPSChange,
  onGPSError,
}: {
  geocercaCoords: Coordenada[];
  recintoCoords?: Coordenada[];
  activo?: boolean;              // solo inicia watchPosition cuando el permiso ya está concedido
  onGPSChange?: (dentro: boolean | null, dentroRecinto: boolean | null, pos?: Coordenada) => void;
  onGPSError?: (code: number) => void;
}) {
  const [vel, setVel]             = useState(0);
  const [prec, setPrec]           = useState<number | null>(null);
  const [gpsOk, setGpsOk]         = useState(false);
  const [dentro, setDentro]       = useState<boolean | null>(null);
  const [dentroRecinto, setDentroRecinto] = useState<boolean | null>(null);
  const gpsHist             = useRef<[number, number][]>([]);

  // ── Refs para geocerca: evitan que el watchPosition se cancele
  //    y reinicie cada vez que llegan los datos de Supabase, lo que
  //    en iOS puede interrumpir el diálogo de permiso en nuevos dispositivos.
  const geocercaRef  = useRef<Coordenada[]>(geocercaCoords);
  const recintoRef   = useRef<Coordenada[]>(recintoCoords);
  const onGPSChangeRef = useRef(onGPSChange);
  const onGPSErrorRef  = useRef(onGPSError);
  useEffect(() => { geocercaRef.current  = geocercaCoords; }, [geocercaCoords]);
  useEffect(() => { recintoRef.current   = recintoCoords;  }, [recintoCoords]);
  useEffect(() => { onGPSChangeRef.current = onGPSChange;  }, [onGPSChange]);
  useEffect(() => { onGPSErrorRef.current  = onGPSError;   }, [onGPSError]);

  useEffect(() => {
    if (!activo) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let watchId: number | null = null;

    const startWatch = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsOk(true);
          setVel(pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : 0);
          setPrec(Math.round(pos.coords.accuracy));
          // Suavizado GPS: promedia las últimas 4 lecturas para reducir jitter
          gpsHist.current.push([pos.coords.latitude, pos.coords.longitude]);
          if (gpsHist.current.length > 4) gpsHist.current.shift();
          const lat = gpsHist.current.reduce((s, p) => s + p[0], 0) / gpsHist.current.length;
          const lng = gpsHist.current.reduce((s, p) => s + p[1], 0) / gpsHist.current.length;
          const pos2d = { lat, lng };
          const gc = geocercaRef.current;
          const rc = recintoRef.current;
          const nuevoDentro = gc.length >= 3 ? puntoEnGeocerca(pos2d, gc) : null;
          const nuevoDentroRecinto = rc.length >= 3 ? puntoEnGeocerca(pos2d, rc) : null;
          if (gc.length >= 3) setDentro(nuevoDentro);
          if (rc.length >= 3)  setDentroRecinto(nuevoDentroRecinto);
          onGPSChangeRef.current?.(
            gc.length >= 3 ? nuevoDentro : null,
            rc.length  >= 3 ? nuevoDentroRecinto : null,
            pos2d
          );
        },
        (err) => {
          setGpsOk(false);
          // code 1 = permiso denegado (el padre muestra el overlay de recuperación)
          onGPSErrorRef.current?.(err.code);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
      );
    };

    startWatch();

    // Reiniciar GPS cuando el usuario vuelve a la app desde Ajustes
    const onVisibility = () => {
      if (document.visibilityState === "visible") startWatch();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Reiniciar GPS si el usuario cambia el permiso de ubicación
    let permStatus: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "geolocation" as PermissionName }).then((ps) => {
      permStatus = ps;
      ps.addEventListener("change", () => {
        if (ps.state === "granted") startWatch();
      });
    }).catch(() => {});

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", onVisibility);
      permStatus?.removeEventListener("change", () => {});
    };
  }, [activo]); // ← Solo re-inicia cuando se concede el permiso; el resto va por refs

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-5 pt-4 pb-5">
        <p className="text-xs text-gray-400 uppercase tracking-widest mb-3 font-medium">Velocidad</p>
        <div className="flex items-end justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-7xl font-black text-gray-900 tabular-nums leading-none">{vel}</span>
            <span className="text-xl text-gray-400 font-medium pb-1">km/h</span>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${gpsOk ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
              <span className="text-xs text-gray-500">
                {prec != null ? `GPS ±${prec}m` : "Sin GPS"}
              </span>
            </div>
            {(() => {
              // 3 niveles: dentro pista > dentro recinto > fuera
              const enPista   = dentro === true;
              const enRecinto = !enPista && dentroRecinto === true;
              const fuera     = dentro === false && (recintoRef.current.length < 3 || dentroRecinto === false);
              const verificando = dentro === null && dentroRecinto === null;

              return (
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                  verificando ? "bg-gray-100 text-gray-500"
                  : enPista   ? "bg-green-100 text-green-700"
                  : enRecinto ? "bg-indigo-100 text-indigo-700"
                  : "bg-red-100 text-red-600"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    verificando ? "bg-gray-400"
                    : enPista   ? "bg-green-500"
                    : enRecinto ? "bg-indigo-500"
                    : "bg-red-500"
                  }`} />
                  {verificando ? "Verificando..."
                   : enPista   ? "En pista"
                   : enRecinto ? "En recinto"
                   : "Fuera del recinto"}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Componente: Trazado SVG ───────────────────────────────────
function TrackSVG({
  trazado,
  bandera,
  sectores = [],
  height = 160,
  onTap,
}: {
  trazado: Coordenada[];
  bandera: string;
  sectores?: Sector[];
  height?: number;
  onTap?: () => void;
}) {
  const strokeColor: Record<string, string> = {
    roja: "#ef4444", amarilla: "#eab308", amarilla_doble: "#f59e0b",
    verde: "#22c55e", blanca: "#9ca3af", negra: "#6b7280",
    safety_car: "#f97316",
  };
  const glowColor: Record<string, string> = {
    roja: "rgba(239,68,68,0.3)", amarilla: "rgba(234,179,8,0.3)", amarilla_doble: "rgba(245,158,11,0.3)",
    verde: "rgba(34,197,94,0.2)", blanca: "rgba(156,163,175,0.15)", negra: "rgba(107,114,128,0.15)",
    safety_car: "rgba(249,115,22,0.3)",
  };
  const stroke = strokeColor[bandera] || strokeColor.verde;
  const glow   = glowColor[bandera]   || glowColor.verde;

  // Flag global tiene prioridad sobre sectores
  const globalOverride = bandera === "roja" || bandera === "amarilla" || bandera === "amarilla_doble" || bandera === "safety_car";
  const usarSectores   = sectores.length > 0 && !globalOverride;

  if (!trazado.length) {
    return (
      <button
        onClick={onTap}
        className="w-full rounded-2xl bg-gray-900 border border-gray-800 flex flex-col items-center justify-center gap-2 active:opacity-70 transition-opacity"
        style={{ height }}
      >
        <span className="text-4xl">🏁</span>
        <p className="text-gray-600 text-xs">Trazado no cargado</p>
        <p className="text-gray-700 text-xs">Importar KML desde panel admin</p>
      </button>
    );
  }

  const W = 340, H = height, PAD = 20;
  const lats = trazado.map(c => c.lat);
  const lngs = trazado.map(c => c.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const dLat = maxLat - minLat || 0.0001;
  const dLng = maxLng - minLng || 0.0001;
  const scaleX = (W - PAD * 2) / dLng;
  const scaleY = (H - PAD * 2) / dLat;
  const scale  = Math.min(scaleX, scaleY);
  const offX   = (W - dLng * scale) / 2;
  const offY   = (H - dLat * scale) / 2;

  const toX = (lng: number) => offX + (lng - minLng) * scale;
  const toY = (lat: number) => H - offY - (lat - minLat) * scale;

  const fullPath = trazado
    .map((c, i) => `${i === 0 ? "M" : "L"} ${toX(c.lng).toFixed(1)} ${toY(c.lat).toFixed(1)}`)
    .join(" ");

  const sectorPath = (inicio: number, fin: number) =>
    trazado.slice(inicio, fin + 1)
      .map((c, i) => `${i === 0 ? "M" : "L"} ${toX(c.lng).toFixed(1)} ${toY(c.lat).toFixed(1)}`)
      .join(" ");

  const sx = toX(trazado[0].lng);
  const sy = toY(trazado[0].lat);

  return (
    <button
      onClick={onTap}
      className="w-full rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden active:opacity-80 transition-opacity text-left"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs text-gray-600 uppercase tracking-widest font-medium">Circuito</span>
        {onTap && <span className="text-xs text-gray-700">Toca para ampliar →</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {/* Fondo oscuro del trazado */}
        <path d={fullPath} fill="none" stroke="#1f2937" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />

        {usarSectores ? (
          /* Sectores coloreados individualmente */
          sectores.map(s => {
            const sc = strokeColor[s.bandera] || strokeColor.verde;
            const gc = glowColor[s.bandera]   || glowColor.verde;
            const sp = sectorPath(s.punto_inicio, s.punto_fin);
            return (
              <g key={s.id}>
                <path d={sp} fill="none" stroke={gc} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
                <path d={sp} fill="none" stroke={sc} strokeWidth="3"  strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })
        ) : (
          /* Trazado completo con color global */
          <>
            <path d={fullPath} fill="none" stroke={glow}   strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
            <path d={fullPath} fill="none" stroke={stroke} strokeWidth="3"  strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

        {/* Meta */}
        <circle cx={sx.toFixed(1)} cy={sy.toFixed(1)} r="5" fill={stroke} />
        <circle cx={sx.toFixed(1)} cy={sy.toFixed(1)} r="9" fill="none" stroke={stroke} strokeWidth="1.5" opacity="0.4" />
      </svg>
    </button>
  );
}

// ── Componente: Generador QR ──────────────────────────────────
function QRGenerator({ pilotoId }: { pilotoId?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generar = async () => {
    setGenerando(true); setError(null); setToken(null);
    try {
      const t = await generarQRToken(pilotoId);
      setToken(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar QR");
    } finally {
      setGenerando(false);
    }
  };

  useEffect(() => { generar(); }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-400 text-center w-full">
          {error}
        </div>
      )}
      {token ? (
        <>
          <div className="bg-white p-4 rounded-2xl shadow-lg">
            <QRCode value={token} size={200} />
          </div>
          <button
            onClick={generar}
            disabled={generando}
            className="border border-gray-700 text-gray-400 text-sm px-4 py-2 rounded-xl hover:bg-gray-900 transition disabled:opacity-50"
          >
            {generando ? "Generando..." : "🔄 Nuevo QR"}
          </button>
        </>
      ) : (
        <button
          onClick={generar}
          disabled={generando}
          className="bg-white text-black px-6 py-3 rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
        >
          {generando ? "Generando..." : "📱 Generar QR de acceso"}
        </button>
      )}
    </div>
  );
}

// ── Icono QR SVG ──────────────────────────────────────────────
function QRIcon({ size = 26, color = "black" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="2"  y="2"  width="9" height="9" rx="1.5" />
      <rect x="4"  y="4"  width="5" height="5" rx="0.5" fill="white" />
      <rect x="13" y="2"  width="9" height="9" rx="1.5" />
      <rect x="15" y="4"  width="5" height="5" rx="0.5" fill="white" />
      <rect x="2"  y="13" width="9" height="9" rx="1.5" />
      <rect x="4"  y="15" width="5" height="5" rx="0.5" fill="white" />
      <rect x="13" y="13" width="4" height="4" rx="0.5" />
      <rect x="19" y="13" width="3" height="3" rx="0.5" />
      <rect x="13" y="19" width="3" height="3" rx="0.5" />
      <rect x="18" y="18" width="4" height="4" rx="0.5" />
    </svg>
  );
}

// ── Tipos de mensajes del director ───────────────────────────
interface MensajePiloto {
  id: string;
  tipo: "info" | "warning" | "danger";
  texto: string;
  created_at: string;
}

// ── Componente principal ──────────────────────────────────────
export default function Home() {

  // ── Estados existentes (sin cambios) ──
  const [stage, setStage]             = useState<Stage>("login");
  const [subTab, setSubTab]           = useState<"prueba" | "reglamento">("prueba");
  const [regPaso, setRegPaso]         = useState(1);
  const [autos, setAutos]             = useState([{ id: 1, marca: "", modelo: "" }]);
  const [respuestas, setRespuestas]   = useState<(number | null)[]>(new Array(PREGUNTAS.length).fill(null));
  const [evaluado, setEvaluado]       = useState(false);
  const [aprobado, setAprobado]       = useState(false);
  const [estadoPiloto, setEstadoPiloto] = useState<EstadoPiloto>("deshabilitado");
  const [checks, setChecks]           = useState([false, false, false]);
  const [pilotoData, setPilotoData]   = useState<any>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [loginEmail, setLoginEmail]   = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regNombre, setRegNombre]     = useState("");
  const [regRut, setRegRut]           = useState("");
  const [regEmail, setRegEmail]       = useState("");
  const [regTelefono, setRegTelefono] = useState("");
  const [regPassword, setRegPassword] = useState("");

  // ── Estados nuevos para vista app rediseñada ──
  const [secView, setSecView]         = useState<SecView>("main");
  const [showQRModal, setShowQRModal] = useState(false);
  const [showFullTrack, setShowFullTrack] = useState(false);
  const [estadoPista, setEstadoPista] = useState<{ bandera: string; sector?: string; mensaje?: string }>({ bandera: "verde" });
  const [trazado, setTrazado]         = useState<Coordenada[]>([]);
  const [geocerca, setGeocerca]       = useState<Coordenada[]>([]);    // pista
  const [geocercaRecinto, setGeocercaRecinto] = useState<Coordenada[]>([]); // recinto
  const [sectores, setSectores]       = useState<Sector[]>([]);
  const [isLandscape, setIsLandscape] = useState(false);
  const [viewportH, setViewportH]     = useState(600);

  // ── Evento activo ──────────────────────────────────────────────
  const [eventoActivo, setEventoActivo]       = useState<EventoActivo | null>(null);
  const [campeonatosDisp, setCampeonatosDisp] = useState<CampeonatoItem[]>([]);
  const [fechasDisp, setFechasDisp]           = useState<FechaItem[]>([]);
  const [misInscripciones, setMisInscripciones] = useState<InscripcionItem[]>([]);
  const [selectedCampId, setSelectedCampId]   = useState<string | null>(null);
  const [eventView, setEventView]             = useState<"campeonatos" | "fechas">("campeonatos");
  const [inscribiendo, setInscribiendo]       = useState<string | null>(null); // fechaId en proceso
  const [modalPago, setModalPago]             = useState<{ fechaNombre: string } | null>(null);

  // GPS levantado desde SpeedCard para usarlo en el semáforo del header
  const [gpsEnPista,    setGpsEnPista]    = useState<boolean | null>(null);
  const [gpsEnRecinto,  setGpsEnRecinto]  = useState<boolean | null>(null);

  // ── Permiso de ubicación ──────────────────────────────────────
  // "checking": consultando estado inicial
  // "prompt":   falta pedirlo → overlay con botón (el diálogo de iOS
  //             disparado por un toque del usuario es lo confiable)
  // "granted":  concedido → SpeedCard y envío a Supabase pueden partir
  // "denied":   denegado → overlay con instrucciones de recuperación
  const [gpsPermiso, setGpsPermiso]   = useState<"checking" | "prompt" | "granted" | "denied">("checking");
  const [gpsPidiendo, setGpsPidiendo] = useState(false);

  useEffect(() => {
    if (stage !== "app") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let status: PermissionStatus | null = null;
    let cancelado = false;
    const aplicar = (state: string) => {
      if (cancelado) return;
      setGpsPermiso(state === "granted" ? "granted" : state === "denied" ? "denied" : "prompt");
    };
    // Safari sin Permissions API: si este dispositivo ya concedió antes
    // (flag local), watchPosition parte sin diálogo; si falla con code 1
    // el onGPSError lo baja a "denied".
    const fallback = () => aplicar(localStorage.getItem("gps_permiso_ok") ? "granted" : "prompt");

    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((s) => { status = s; aplicar(s.state); s.onchange = () => aplicar(s.state); })
        .catch(fallback);
    } else {
      fallback();
    }
    return () => { cancelado = true; if (status) status.onchange = null; };
  }, [stage]);

  const solicitarGPS = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setGpsPidiendo(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem("gps_permiso_ok", "1");
        setGpsPidiendo(false);
        setGpsPermiso("granted");
      },
      (err) => {
        setGpsPidiendo(false);
        if (err.code === 1) {
          localStorage.removeItem("gps_permiso_ok");
          setGpsPermiso("denied");
        } else {
          // code 2/3 = permiso concedido pero aún sin señal:
          // dejar pasar, el watchPosition sigue intentando solo
          localStorage.setItem("gps_permiso_ok", "1");
          setGpsPermiso("granted");
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  // ── Task #58: jerarquía de banderas ──
  const [banderaPersonal, setBanderaPersonal] = useState<string | null>(null);
  const [posPiloto, setPosPiloto] = useState<{ lat: number; lng: number; dentro: boolean | null } | null>(null);

  // ── Estados de mensajes del director ──
  const [mensajeActivo, setMensajeActivo] = useState<MensajePiloto | null>(null);
  const mensajeDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cargar sesión al montar ──
  useEffect(() => {
    getPiloto().then((data) => {
      if (data) {
        setPilotoData(data);
        setEstadoPiloto(data.prueba_aprobada ? "habilitado" : "deshabilitado");
        // Si no aprobó la prueba va directo a prueba; si sí aprobó va a seleccionar evento
        if (!data.prueba_aprobada) { setStage("prueba"); }
        else { setStage("eventos"); cargarCampeonatos(); cargarMisInscripciones(data.id); }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Realtime: actualizar inscripciones cuando el admin cambia el estado ──
  useEffect(() => {
    if (stage !== "eventos" || !pilotoData?.id) return;
    const pilotoId = pilotoData.id;
    // Polling cada 6s como backup al Realtime
    const poll = setInterval(() => cargarMisInscripciones(pilotoId), 6000);
    const ch = supabase.channel("piloto-inscripciones-watch")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "inscripciones",
        filter: `piloto_id=eq.${pilotoId}`,
      }, () => { cargarMisInscripciones(pilotoId); })
      .subscribe();
    return () => { clearInterval(poll); supabase.removeChannel(ch); };
  }, [stage, pilotoData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Carga campeonatos y inscripciones del piloto ───────────────
  const cargarCampeonatos = async () => {
    const { data } = await supabase
      .from("campeonatos").select("id, nombre, temporada, descripcion")
      .eq("activo", true).order("temporada", { ascending: false });
    setCampeonatosDisp(data || []);
  };

  const cargarFechas = async (campId: string) => {
    const { data } = await supabase
      .from("fechas_evento")
      .select("id, nombre, fecha_evento, autodromo, trazado, cupos_max, estado, tipo, campeonato_id")
      .eq("campeonato_id", campId)
      .in("estado", ["borrador", "abierto"])
      .order("fecha_evento");
    setFechasDisp((data || []) as FechaItem[]);
  };

  const cargarMisInscripciones = async (pilotoId: string) => {
    const { data } = await supabase
      .from("inscripciones")
      .select("id, fecha_id, estado, pago_estado")
      .eq("piloto_id", pilotoId);
    setMisInscripciones(data || []);
  };

  const inscribirseEnFecha = async (fecha: FechaItem, campNombre: string) => {
    if (!pilotoData?.id) return;
    setInscribiendo(fecha.id);
    const { data, error } = await supabase.from("inscripciones").insert({
      piloto_id:    pilotoData.id,
      fecha_id:     fecha.id,
      campeonato_id: fecha.campeonato_id,
      estado:       "solicitado",
      pago_estado:  "pendiente",
    }).select().single();
    if (!error && data) {
      setMisInscripciones(prev => [...prev, { id: data.id, fecha_id: fecha.id, estado: "solicitado", pago_estado: "pendiente" }]);
    }
    setInscribiendo(null);
  };

  const entrarAlEvento = (insc: InscripcionItem, fecha: FechaItem, campNombre: string) => {
    setEventoActivo({
      inscripcionId:    insc.id,
      fechaId:          fecha.id,
      campeonatoNombre: campNombre,
      fechaNombre:      fecha.nombre,
      tipo:             fecha.tipo,
      estadoInsc:       insc.estado,
    });
    setStage("app");
  };

  // ── Cargar trazado y estado de pista al entrar a la app ──
  useEffect(() => {
    if (stage !== "app") return;

    getTrazadoActivo().then((coords) => { if (coords) setTrazado(coords); });
    getGeocercaActiva('pista').then((coords) => { if (coords) setGeocerca(coords); });
    getGeocercaActiva('recinto').then((coords) => { if (coords) setGeocercaRecinto(coords); });

    supabase
      .from("estado_pista")
      .select("*")
      .eq("activo", true)
      .single()
      .then(({ data }) => {
        if (data) setEstadoPista({ bandera: data.bandera || "verde", sector: data.sector, mensaje: data.mensaje });
      });

    // Cargar sectores (solo actualizar estado si los datos realmente cambiaron,
    // para no redibujar el mapa y la pizarra sin necesidad)
    const aplicarSectores = (data: Sector[] | null) => {
      if (!data) return;
      setSectores(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);
    };
    supabase
      .from("sectores_pista")
      .select("*")
      .order("orden")
      .then(({ data }) => aplicarSectores(data as Sector[] | null));

    // Canales SEPARADOS para bandera global y sectores — si comparten canal,
    // los eventos pueden cruzarse y la bandera global "parpadea" con los
    // cambios de sector (ej: amarilla automática encendiéndose/apagándose).
    const chEstado = supabase
      .channel("flag-estado")
      .on("postgres_changes", { event: "*", schema: "public", table: "estado_pista" }, (payload) => {
        const n = payload.new as any;
        // Solo aceptar eventos que realmente sean de la fila activa de estado_pista
        // (las filas de sectores no tienen columna `activo`)
        if (n && n.activo === true && typeof n.bandera === "string") {
          setEstadoPista(prev =>
            prev.bandera === n.bandera && prev.sector === n.sector && prev.mensaje === n.mensaje
              ? prev
              : { bandera: n.bandera || "verde", sector: n.sector, mensaje: n.mensaje }
          );
        }
      })
      .subscribe();

    const chSectores = supabase
      .channel("flag-sectores")
      .on("postgres_changes", { event: "*", schema: "public", table: "sectores_pista" }, () => {
        supabase
          .from("sectores_pista")
          .select("*")
          .order("orden")
          .then(({ data }) => aplicarSectores(data as Sector[] | null));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(chEstado);
      supabase.removeChannel(chSectores);
    };
  }, [stage]);

  // ── Wake Lock — evita que la pantalla se apague mientras el piloto está en pista ──
  useEffect(() => {
    if (stage !== "app") return;
    let wakeLock: any = null;
    const request = async () => {
      if (!("wakeLock" in navigator)) return;
      try { wakeLock = await (navigator as any).wakeLock.request("screen"); }
      catch { /* no disponible en este navegador */ }
    };
    request();
    const onVisible = () => { if (document.visibilityState === "visible") request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release().catch(() => {});
    };
  }, [stage]);

  // ── Mensajes del director de carrera (Realtime) ──────────────
  useEffect(() => {
    if (stage !== "app" || !pilotoData?.id) return;

    const mostrarMensaje = (m: MensajePiloto) => {
      setMensajeActivo(m);
      // Vibrar: patrón diferente por tipo
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        if (m.tipo === "danger")       navigator.vibrate([300, 100, 300, 100, 300]);
        else if (m.tipo === "warning") navigator.vibrate([200, 80, 200]);
        else                           navigator.vibrate(150);
      }
      // Auto-dismiss según tipo
      if (mensajeDismissRef.current) clearTimeout(mensajeDismissRef.current);
      const delay = m.tipo === "danger" ? 12000 : m.tipo === "warning" ? 9000 : 7000;
      mensajeDismissRef.current = setTimeout(() => setMensajeActivo(null), delay);
    };

    const ch = supabase
      .channel("piloto-mensajes")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_piloto" },
        payload => {
          const m = payload.new as any;
          // Solo mostrar si es para este piloto o broadcast (null)
          if (m.piloto_id === null || m.piloto_id === pilotoData.id) {
            mostrarMensaje(m as MensajePiloto);
          }
        })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      if (mensajeDismissRef.current) clearTimeout(mensajeDismissRef.current);
    };
  }, [stage, pilotoData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ref para geocerca (acceso siempre actualizado dentro del intervalo) ──
  const geocercaGpsRef = useRef<Coordenada[]>([]);
  useEffect(() => { geocercaGpsRef.current = geocerca; }, [geocerca]);

  // ── Envío GPS a Supabase (background) ────────────────────────
  // Manda posición a ubicaciones_piloto cada 3s cuando hay sesión activa.
  // Se activa automáticamente al crear la sesión (suscripción Realtime).
  useEffect(() => {
    if (stage !== "app" || !pilotoData?.id || gpsPermiso !== "granted") return;

    const pilotoId = pilotoData.id;
    let sesionId: string | null = null;
    let watchId: number | null = null;
    let intervalo: ReturnType<typeof setInterval> | null = null;
    let ultimaPos: GeolocationPosition | null = null;

    const detenerGPS = () => {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
      if (intervalo)         { clearInterval(intervalo); intervalo = null; }
      sesionId = null;
    };

    const iniciarGPS = (sid: string) => {
      if (sesionId === sid) return; // ya corriendo con esta sesión
      detenerGPS();
      sesionId = sid;
      if (!navigator.geolocation) return;

      watchId = navigator.geolocation.watchPosition(
        pos => { ultimaPos = pos; },
        null,
        { enableHighAccuracy: true, maximumAge: 1000 }
      );

      intervalo = setInterval(async () => {
        if (!ultimaPos || !sesionId) return;
        const lat = ultimaPos.coords.latitude;
        const lng = ultimaPos.coords.longitude;
        const gc = geocercaGpsRef.current;
        const dentro = gc.length >= 3
          ? puntoEnGeocerca({ lat, lng }, gc)
          : true;

        // Task #58: posición para detectar el sector del piloto
        // (funciona también en landscape, donde SpeedCard no está montado)
        setPosPiloto({ lat, lng, dentro: gc.length >= 3 ? dentro : null });

        await registrarUbicacion({
          piloto_id:        pilotoId,
          sesion_id:        sesionId!,
          lat,
          lng,
          velocidad:        ultimaPos.coords.speed != null
                              ? Math.round(ultimaPos.coords.speed * 3.6)
                              : 0,
          precision_metros: Math.round(ultimaPos.coords.accuracy),
          dentro_geocerca:  dentro,
        });
      }, 3000);
    };

    // ── Función central: consultar sesión activa ──────────────
    const checkSession = async () => {
      const { data } = await supabase
        .from("sesiones")
        .select("id, estado, bandera_piloto")
        .eq("piloto_id", pilotoId)
        .eq("estado", "activa")
        .maybeSingle();
      if (data?.id) {
        iniciarGPS(data.id);
        // Task #58: bandera personal asignada por el director
        setBanderaPersonal(data.bandera_piloto ?? null);
      } else if (!data) {
        // sesión cerrada remotamente
        if (sesionId) detenerGPS();
        setBanderaPersonal(null);
      }
    };

    // 1. Verificar sesión activa al montar (inmediato)
    checkSession();

    // 2. Polling cada 8s como backup — garantiza arranque aunque
    //    Realtime falle o sesiones no esté en la publicación.
    const pollInterval = setInterval(checkSession, 8000);

    // 3. Suscripción Realtime (arranque instantáneo cuando sesiones
    //    está habilitado en supabase_realtime).
    const ch = supabase
      .channel("piloto-sesion-watch")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "sesiones" },
        payload => {
          const s = payload.new as any;
          if (s.piloto_id === pilotoId && s.estado === "activa") {
            iniciarGPS(s.id);
          }
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "sesiones" },
        payload => {
          const s = payload.new as any;
          if (s.piloto_id === pilotoId) {
            if (s.estado === "activa") {
              iniciarGPS(s.id);
              // Task #58: bandera personal en tiempo real
              setBanderaPersonal(s.bandera_piloto ?? null);
            }
            if (s.estado === "inactiva") {
              detenerGPS();
              setBanderaPersonal(null);
            }
          }
        })
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      detenerGPS();
      supabase.removeChannel(ch);
    };
  }, [stage, pilotoData?.id, gpsPermiso]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Detección de orientación ──
  useEffect(() => {
    const update = () => {
      // Solo activar landscape en dispositivos móviles/táctiles reales.
      // En PC el ancho siempre supera al alto, pero no queremos el modo cockpit ahí.
      const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      const landscape = isMobile && window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
      setViewportH(window.innerHeight);
      if (landscape) setSecView("main");
    };
    update();
    window.addEventListener("resize", update);
    const onOrient = () => setTimeout(update, 100);
    window.addEventListener("orientationchange", onOrient);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", onOrient);
    };
  }, []);

  // ── Handlers existentes (sin cambios) ──
  const agregarAuto = () => setAutos([...autos, { id: Date.now(), marca: "", modelo: "" }]);
  const eliminarAuto = (id: number) => setAutos(autos.filter(a => a.id !== id));
  const updateAuto = (id: number, campo: "marca" | "modelo", valor: string) =>
    setAutos(autos.map(a => a.id === id ? { ...a, [campo]: valor } : a));

  const selRespuesta = (qi: number, oi: number) => {
    if (evaluado) return;
    const r = [...respuestas]; r[qi] = oi; setRespuestas(r); setEstadoPiloto("pendiente");
  };
  const evaluar = async () => {
    setEvaluado(true);
    const ok = PREGUNTAS.every((p, i) => respuestas[i] === p.correcta);
    setAprobado(ok);
    if (ok) {
      setEstadoPiloto("habilitado");
      const piloto = await getPiloto();
      if (piloto) { await aprobarPrueba(piloto.id); setPilotoData({ ...piloto, prueba_aprobada: true }); }
      setTimeout(() => { cargarCampeonatos(); if (piloto) cargarMisInscripciones(piloto.id); setStage("eventos"); }, 1800);
    }
  };
  const reintentar = () => {
    setRespuestas(new Array(PREGUNTAS.length).fill(null));
    setEvaluado(false); setAprobado(false); setEstadoPiloto("pendiente");
  };
  const toggleCheck = (i: number) => { const c = [...checks]; c[i] = !c[i]; setChecks(c); };

  const handleLogin = async () => {
    setError(""); setLoading(true);
    const result = await loginPiloto(loginEmail, loginPassword);
    if (result.error) { setError(result.error); setLoading(false); return; }
    const data = await getPiloto();
    setPilotoData(data);
    setEstadoPiloto(data?.prueba_aprobada ? "habilitado" : "deshabilitado");
    if (!data?.prueba_aprobada) { setStage("prueba"); }
    else { cargarCampeonatos(); if (data?.id) cargarMisInscripciones(data.id); setStage("eventos"); }
    setLoading(false);
  };
  const handleRegistro = async () => {
    if (!todosChecks) return;
    setError(""); setLoading(true);
    const result = await registrarPiloto({ email: regEmail, password: regPassword, nombre: regNombre, rut: regRut, telefono: regTelefono });
    if (result.error) { setError(result.error); setLoading(false); return; }
    const piloto = await getPiloto();
    if (piloto) {
      setPilotoData(piloto);
      for (const auto of autos) { if (auto.marca && auto.modelo) await agregarVehiculo(piloto.id, auto.marca, auto.modelo); }
    }
    setEstadoPiloto("deshabilitado"); setStage("prueba"); setSubTab("prueba"); setLoading(false);
  };
  const handleCerrarSesion = async () => {
    await cerrarSesion(); setPilotoData(null); setStage("login");
    setLoginEmail(""); setLoginPassword(""); setEstadoPiloto("deshabilitado");
    setEventoActivo(null); setCampeonatosDisp([]); setFechasDisp([]);
  };

  const volverAEventos = () => {
    setEventoActivo(null);
    setEventView("campeonatos");
    setSelectedCampId(null);
    setFechasDisp([]);
    cargarCampeonatos();
    if (pilotoData?.id) cargarMisInscripciones(pilotoData.id);
    setStage("eventos");
  };

  // ── Valores derivados ──
  const incorrectas  = evaluado ? PREGUNTAS.filter((p, i) => respuestas[i] !== p.correcta).length : 0;
  const todosChecks  = checks.every(Boolean);
  const nombreMostrar = pilotoData?.nombre || "Piloto";
  const iniciales    = nombreMostrar.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
  const vehiculoMostrar = pilotoData?.vehiculos?.[0]
    ? `${pilotoData.vehiculos[0].marca} ${pilotoData.vehiculos[0].modelo}`
    : "Sin vehículo registrado";

  const semaforo = {
    deshabilitado: { label: "No habilitado", bg: "bg-red-600",    text: "text-white", dot: "🔴" },
    pendiente:     { label: "Pendiente",      bg: "bg-amber-500",  text: "text-white", dot: "🟠" },
    habilitado:    { label: "Habilitado",     bg: "bg-green-600",  text: "text-white", dot: "🟢" },
  }[estadoPiloto];

  // Semáforo GPS — indica posición relativa a geocercas (usa estados levantados desde SpeedCard)
  const semaforoGPS =
    gpsEnPista === true
      ? { label: "En pista",     bg: "bg-green-600",  text: "text-white",    dot: "🟢" }
      : gpsEnRecinto === true
      ? { label: "En recinto",   bg: "bg-orange-500", text: "text-white",    dot: "🟠" }
      : (gpsEnPista === false || gpsEnRecinto === false)
      ? { label: "Fuera",        bg: "bg-red-600",    text: "text-white",    dot: "🔴" }
      : { label: "GPS…",         bg: "bg-gray-700",   text: "text-gray-300", dot: "⚪" };

  // ── Task #58: jerarquía de banderas ──────────────────────────
  // Prioridad: cuadros > roja > bandera personal > bandera del sector > bandera global
  const sectorActual = (() => {
    if (!posPiloto || posPiloto.dentro !== true) return null;     // solo si está dentro de pista
    if (trazado.length < 2 || sectores.length === 0) return null;
    const idx = findClosestIdx(posPiloto.lat, posPiloto.lng, trazado);
    return sectores.find(s => idx >= s.punto_inicio && idx <= s.punto_fin) || null;
  })();
  const banderaSector = sectorActual && sectorActual.bandera !== "verde" ? sectorActual.bandera : null;

  const banderaEfectiva =
    estadoPista.bandera === "cuadros" ? "cuadros"
    : estadoPista.bandera === "roja"  ? "roja"
    : banderaPersonal                 ? banderaPersonal
    : banderaSector                   ? banderaSector
    : estadoPista.bandera;

  const flagEsPersonal = !!banderaPersonal && banderaEfectiva === banderaPersonal;
  const flag = FLAG_CONFIG[banderaEfectiva] || FLAG_CONFIG.verde;
  const habilitado = estadoPiloto === "habilitado";

  // ─────────────────────────────────────────────────────────────
  return (
    <div>

      {/* ══════════════════════════════════════════════════════
          STAGES: LOGIN / REGISTRO / PRUEBA  (diseño original)
      ══════════════════════════════════════════════════════ */}
      {(stage === "login" || stage === "registro" || stage === "prueba") && (
        <div className="min-h-screen bg-gray-100 flex items-start justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow overflow-hidden">

            {/* Header */}
            <div className="bg-indigo-700 text-white px-5 py-4 flex items-center gap-3">
              <span className="text-2xl">🏎</span>
              <div>
                <div className="font-semibold text-sm">Autódromo Las Vizcachas</div>
                <div className="text-xs opacity-75">
                  {stage === "login"    && "Acceso"}
                  {stage === "registro" && `Registro — Paso ${regPaso} de 2`}
                  {stage === "prueba"   && "Prueba de conocimientos"}
                </div>
              </div>
            </div>

            {/* Barra de progreso */}
            {(stage === "registro" || stage === "prueba") && (
              <div className="h-1 bg-gray-200">
                <div className="h-1 bg-indigo-600 transition-all" style={{ width: stage === "registro" ? (regPaso === 1 ? "33%" : "66%") : "100%" }} />
              </div>
            )}

            <div className="p-5">

              {/* ─ LOGIN ─ */}
              {stage === "login" && (
                <div className="space-y-5">
                  <div className="text-center space-y-1">
                    <div className="text-lg font-semibold">Bienvenido</div>
                    <div className="text-sm text-gray-500">Ingresa con tu cuenta de piloto</div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Correo electrónico</label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="email" placeholder="tu@correo.cl" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 font-medium">Contraseña</label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="password" placeholder="••••••••" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
                    </div>
                    {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
                    <button onClick={handleLogin} disabled={loading} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 transition disabled:opacity-60">
                      {loading ? "Ingresando..." : "Ingresar"}
                    </button>
                  </div>
                  <div className="text-center text-sm text-gray-500">
                    ¿Sin cuenta?{" "}
                    <button onClick={() => { setStage("registro"); setRegPaso(1); setError(""); }} className="text-indigo-600 font-semibold hover:underline">
                      Regístrate aquí
                    </button>
                  </div>
                </div>
              )}

              {/* ─ REGISTRO PASO 1 ─ */}
              {stage === "registro" && regPaso === 1 && (
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-gray-700">Datos personales</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Nombre completo <span className="text-red-500">*</span></label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="text" placeholder="Felipe Schmauk" value={regNombre} onChange={e => setRegNombre(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">RUT <span className="text-red-500">*</span></label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="text" placeholder="12.345.678-9" value={regRut} onChange={e => setRegRut(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Correo <span className="text-red-500">*</span></label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="email" placeholder="tu@correo.cl" value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Teléfono <span className="text-red-500">*</span></label>
                      <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="text" placeholder="+56 9 1234 5678" value={regTelefono} onChange={e => setRegTelefono(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Contraseña <span className="text-red-500">*</span></label>
                    <input className="mt-1 w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" type="password" placeholder="Mínimo 8 caracteres" value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-gray-700">Vehículos <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-1">opcional</span></div>
                      <button onClick={agregarAuto} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg font-medium hover:bg-indigo-100 transition">+ Agregar vehículo</button>
                    </div>
                    <div className="space-y-3">
                      {autos.map((auto, idx) => (
                        <div key={auto.id} className="bg-gray-50 rounded-xl p-3 border">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-500">Vehículo {idx + 1}</span>
                            {autos.length > 1 && <button onClick={() => eliminarAuto(auto.id)} className="text-xs text-red-500 hover:text-red-700">✕ Eliminar</button>}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Marca" value={auto.marca} onChange={e => updateAuto(auto.id, "marca", e.target.value)} />
                            <input className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Modelo" value={auto.modelo} onChange={e => updateAuto(auto.id, "modelo", e.target.value)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { setStage("login"); setError(""); }} className="border rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Volver</button>
                    <button onClick={() => setRegPaso(2)} className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-indigo-700 transition">Continuar →</button>
                  </div>
                </div>
              )}

              {/* ─ REGISTRO PASO 2 ─ */}
              {stage === "registro" && regPaso === 2 && (
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-gray-700">Términos y condiciones</div>
                  <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-600 leading-relaxed border">
                    Al registrarte confirmas que has leído el reglamento del autódromo y aceptas las normas de seguridad, el protocolo de banderas, la política de cobro por minuto y las condiciones de acceso a pista.
                  </div>
                  <div className="space-y-3">
                    {[
                      "Acepto el reglamento interno del autódromo y las condiciones del evento",
                      "He leído y entiendo el protocolo de seguridad y el sistema de banderas",
                      "Entiendo que el cobro por minuto es automático y solo puede pausarlo el director de pista",
                    ].map((txt, i) => (
                      <label key={i} className="flex items-start gap-3 cursor-pointer text-sm text-gray-700">
                        <input type="checkbox" checked={checks[i]} onChange={() => toggleCheck(i)} className="mt-0.5 accent-indigo-600" />
                        {txt}
                      </label>
                    ))}
                  </div>
                  {!todosChecks && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                      ⚠ Debes aceptar todas las condiciones para continuar.
                    </div>
                  )}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
                    📋 Al inscribirte en un campeonato deberás completar una prueba de conocimientos del reglamento del evento.
                  </div>
                  {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setRegPaso(1)} className="border rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition">← Volver</button>
                    <button onClick={handleRegistro} disabled={!todosChecks || loading} className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${todosChecks && !loading ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>
                      {loading ? "Creando cuenta..." : "Crear cuenta ✓"}
                    </button>
                  </div>
                </div>
              )}

              {/* ─ PRUEBA ─ */}
              {stage === "prueba" && (
                <div className="space-y-4">
                  <div className="flex border-b -mx-5 px-5">
                    {(["prueba", "reglamento"] as const).map(t => (
                      <button key={t} onClick={() => setSubTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${subTab === t ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                        {t === "prueba" ? "📋 Prueba" : "📄 Reglamento"}
                      </button>
                    ))}
                  </div>

                  {subTab === "reglamento" && (
                    <div className="space-y-4">
                      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm text-indigo-700 font-medium">
                        📖 Lee el reglamento TCC 2026 antes de rendir la prueba.
                      </div>

                      {/* Secciones del reglamento TCC */}
                      {REGLAMENTO_TCC.map((sec, si) => (
                        <div key={si} className="border border-gray-200 rounded-xl overflow-hidden">
                          <div className="bg-gray-50 px-4 py-2.5 flex items-center gap-2">
                            <span className="text-base">{sec.icono}</span>
                            <span className="text-sm font-semibold text-gray-800">{sec.titulo}</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {sec.items.map((item, ii) => (
                              <div key={ii} className="px-4 py-2.5 text-xs text-gray-600 leading-relaxed">
                                {item}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}

                      <button onClick={() => setSubTab("prueba")} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                        Ir a la prueba →
                      </button>
                    </div>
                  )}

                  {subTab === "prueba" && (
                    <div className="space-y-4">

                      {/* ── Banner: prueba en construcción ── */}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 text-center space-y-1">
                        <div className="text-2xl">🚧</div>
                        <p className="text-sm font-semibold text-amber-800">Prueba de conocimientos en desarrollo</p>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          Próximamente deberás completar esta evaluación al inscribirte en un campeonato.
                          Por ahora podés acceder directamente a la plataforma.
                        </p>
                      </div>

                      {/* Preguntas visibles pero deshabilitadas — preview de lo que vendrá */}
                      <div className="space-y-3 opacity-40 pointer-events-none select-none">
                        {PREGUNTAS.slice(0, 3).map((p, qi) => (
                          <div key={qi} className="border rounded-xl p-4 space-y-3">
                            <div className="text-xs text-gray-400">Pregunta {qi + 1} de {PREGUNTAS.length}</div>
                            <div className="text-sm font-medium text-gray-700">{p.pregunta}</div>
                            <div className="space-y-2">
                              {p.opciones.map((op, oi) => (
                                <div key={oi} className="w-full text-left border rounded-xl px-3 py-2.5 text-sm flex items-center gap-3 bg-white">
                                  <span className="w-5 h-5 rounded-full border flex items-center justify-center text-xs font-medium flex-shrink-0">
                                    {String.fromCharCode(65 + oi)}
                                  </span>
                                  {op}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <div className="border border-dashed rounded-xl px-4 py-3 text-center text-xs text-gray-400">
                          + {PREGUNTAS.length - 3} preguntas más
                        </div>
                      </div>

                      {/* Botón de acceso directo */}
                      <div className="border-t pt-4 space-y-2">
                        <button
                          onClick={async () => {
                            setLoading(true);
                            setEstadoPiloto("habilitado");
                            const piloto = await getPiloto();
                            if (piloto) {
                              await aprobarPrueba(piloto.id);
                              setPilotoData({ ...piloto, prueba_aprobada: true });
                            }
                            cargarCampeonatos();
                            if (piloto) cargarMisInscripciones(piloto.id);
                            setStage("eventos");
                            setLoading(false);
                          }}
                          disabled={loading}
                          className="w-full bg-indigo-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-60"
                        >
                          {loading ? "Accediendo..." : "Confirmar y acceder a la plataforma →"}
                        </button>
                        <p className="text-xs text-gray-400 text-center">
                          La prueba será obligatoria al momento de inscribirse en un campeonato.
                        </p>
                      </div>

                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          STAGE: EVENTOS — Selector de campeonato y fecha
      ══════════════════════════════════════════════════════ */}
      {stage === "eventos" && (() => {
        const TIPO_LABEL = { racing: "Racing", track_day: "Track Day", entrenamiento: "Entreno" };
        const TIPO_COLOR = {
          racing:        "bg-red-600 text-white",
          track_day:     "bg-blue-600 text-white",
          entrenamiento: "bg-emerald-600 text-white",
        };
        const INSC_BADGE: Record<string, { label: string; cls: string }> = {
          solicitado:    { label: "Pendiente de aprobación", cls: "bg-amber-100 text-amber-700 border-amber-200" },
          inscrito:      { label: "Aprobado · pago pendiente", cls: "bg-blue-100 text-blue-700 border-blue-200" },
          confirmado:    { label: "✓ Confirmado",             cls: "bg-green-100 text-green-700 border-green-200" },
          en_pista:      { label: "En pista",                 cls: "bg-green-200 text-green-800 border-green-300" },
          rechazado:     { label: "Solicitud rechazada",      cls: "bg-red-100 text-red-600 border-red-200" },
        };

        const campSeleccionado = campeonatosDisp.find(c => c.id === selectedCampId);

        return (
          <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ maxWidth: 480, margin: "0 auto" }}>

            {/* Header */}
            <div className="bg-gray-900 border-b border-gray-800 px-5 flex items-center justify-between"
              style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingBottom: "1rem" }}>
              <div className="flex items-center gap-3">
                {eventView === "fechas" ? (
                  <button onClick={() => { setEventView("campeonatos"); setSelectedCampId(null); setFechasDisp([]); }}
                    className="text-gray-400 hover:text-white text-lg transition">←</button>
                ) : (
                  <span className="text-xl">🏁</span>
                )}
                <div>
                  <p className="font-bold text-sm leading-none">
                    {eventView === "campeonatos" ? "Eventos disponibles" : campSeleccionado?.nombre}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-none">
                    {eventView === "campeonatos"
                      ? `Hola, ${pilotoData?.nombre?.split(" ")[0] || "Piloto"}`
                      : `Temporada ${campSeleccionado?.temporada}`}
                  </p>
                </div>
              </div>
              <button onClick={handleCerrarSesion} className="text-xs text-gray-500 hover:text-gray-300 transition">Salir</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">

              {/* ── Vista campeonatos ── */}
              {eventView === "campeonatos" && (
                <>
                  {campeonatosDisp.length === 0 ? (
                    <div className="text-center py-16 text-gray-600 text-sm">
                      <p className="text-3xl mb-3">🏎</p>
                      <p>No hay campeonatos disponibles</p>
                    </div>
                  ) : campeonatosDisp.map(camp => (
                    <button key={camp.id}
                      onClick={() => { setSelectedCampId(camp.id); cargarFechas(camp.id); setEventView("fechas"); }}
                      className="w-full text-left bg-gray-900 border border-gray-800 rounded-2xl p-4 hover:border-gray-600 transition-colors active:scale-[0.98]">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm">{camp.nombre}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Temporada {camp.temporada}</p>
                          {camp.descripcion && <p className="text-xs text-gray-500 mt-1">{camp.descripcion}</p>}
                        </div>
                        <span className="text-gray-600 text-lg">›</span>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* ── Vista fechas ── */}
              {eventView === "fechas" && (
                <>
                  {fechasDisp.length === 0 ? (
                    <div className="text-center py-16 text-gray-600 text-sm">
                      <p className="text-3xl mb-3">📅</p>
                      <p>No hay fechas disponibles en este campeonato</p>
                    </div>
                  ) : fechasDisp.map(fecha => {
                    const esBorrador = fecha.estado === "borrador";
                    const insc = misInscripciones.find(i => i.fecha_id === fecha.id);
                    const puedeEntrar = insc && ["confirmado","en_pista"].includes(insc.estado);
                    const badge = insc ? INSC_BADGE[insc.estado] : null;
                    const tipo = fecha.tipo as keyof typeof TIPO_LABEL;

                    return (
                      <div key={fecha.id} className={`border rounded-2xl p-4 space-y-3 ${
                        esBorrador
                          ? "bg-gray-900/50 border-gray-800/60 opacity-75"
                          : "bg-gray-900 border-gray-800"
                      }`}>
                        {/* Info fecha */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-sm">{fecha.nombre}</p>
                              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIPO_COLOR[tipo]}`}>
                                {TIPO_LABEL[tipo]}
                              </span>
                              {esBorrador && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
                                  Próximamente
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                              📅 {new Date(fecha.fecha_evento + "T12:00:00").toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
                            </p>
                            {fecha.autodromo && <p className="text-xs text-gray-500">📍 {fecha.autodromo}{fecha.trazado ? ` · ${fecha.trazado}` : ""}</p>}
                            <p className="text-xs text-gray-600 mt-0.5">👥 {fecha.cupos_max} cupos máx.</p>
                          </div>
                        </div>

                        {/* Si es borrador: solo info, sin acciones */}
                        {!esBorrador && (
                          <>
                            {/* Estado de inscripción */}
                            {badge && insc?.estado !== "inscrito" && (
                              <div className={`border rounded-xl px-3 py-2 text-xs font-medium ${badge.cls}`}>
                                {badge.label}
                              </div>
                            )}

                            {/* Estado inscrito: botón de pago */}
                            {insc?.estado === "inscrito" && (
                              <button
                                onClick={() => setModalPago({ fechaNombre: fecha.nombre })}
                                className="w-full border border-blue-500 bg-blue-950 text-blue-300 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between hover:bg-blue-900 active:scale-[0.98] transition">
                                <span>✓ Aprobado · Pago pendiente</span>
                                <span className="text-blue-400 text-xs font-bold">Pagar →</span>
                              </button>
                            )}

                            <div className="flex gap-2">
                              {puedeEntrar && (
                                <button
                                  onClick={() => entrarAlEvento(insc!, fecha, campSeleccionado?.nombre || "")}
                                  className="flex-1 bg-white text-gray-900 font-bold py-3 rounded-xl text-sm hover:bg-gray-100 active:scale-[0.98] transition">
                                  Entrar al evento →
                                </button>
                              )}
                              {!insc && (
                                <button
                                  onClick={() => inscribirseEnFecha(fecha, campSeleccionado?.nombre || "")}
                                  disabled={inscribiendo === fecha.id}
                                  className="flex-1 border border-gray-600 text-white font-semibold py-3 rounded-xl text-sm hover:border-gray-400 disabled:opacity-50 active:scale-[0.98] transition">
                                  {inscribiendo === fecha.id ? "Enviando…" : "Inscribirme"}
                                </button>
                              )}
                              {insc && insc.estado === "rechazado" && (
                                <p className="text-xs text-gray-600 py-2">Contactá al organizador para más información.</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════
          MODAL: PAGO (próximamente)
      ══════════════════════════════════════════════════════ */}
      {modalPago && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.75)" }}>
          <div className="w-full max-w-lg bg-gray-950 rounded-t-3xl overflow-hidden">

            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>

            {/* Header */}
            <div className="px-5 pt-3 pb-4 flex items-center justify-between border-b border-gray-800">
              <div>
                <p className="text-white font-bold text-base">Pago de inscripción</p>
                <p className="text-gray-400 text-xs mt-0.5">{modalPago.fechaNombre}</p>
              </div>
              <button onClick={() => setModalPago(null)} className="text-gray-500 hover:text-white text-xl transition">✕</button>
            </div>

            <div className="p-5 space-y-4 relative">

              {/* Formulario de tarjeta — deshabilitado */}
              <div className="space-y-3 opacity-40 pointer-events-none select-none">
                <div>
                  <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Número de tarjeta</label>
                  <div className="mt-1.5 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-white text-sm font-mono tracking-widest">
                    •••• •••• •••• ••••
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Vencimiento</label>
                    <div className="mt-1.5 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-white text-sm font-mono">
                      MM / AA
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">CVV</label>
                    <div className="mt-1.5 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-white text-sm font-mono">
                      •••
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Nombre en la tarjeta</label>
                  <div className="mt-1.5 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-gray-500 text-sm">
                    {pilotoData?.nombre || "Nombre Apellido"}
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="w-5 h-5 rounded bg-gray-800 border border-gray-700" />
                  <span className="text-xs text-gray-500">Recordar tarjeta para futuros pagos</span>
                </div>
                <button className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl text-sm">
                  Pagar inscripción
                </button>
              </div>

              {/* Overlay Próximamente */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
                <div className="bg-gray-900 border border-gray-700 rounded-2xl px-6 py-5 text-center shadow-2xl">
                  <p className="text-3xl mb-2">🔒</p>
                  <p className="text-white font-bold text-base">Próximamente</p>
                  <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
                    El pago online estará disponible en breve.<br />
                    Por ahora coordiná el pago con el organizador.
                  </p>
                </div>
              </div>

            </div>

            {/* Seguridad footer */}
            <div className="px-5 pb-6 pt-1 flex items-center justify-center gap-1.5 text-gray-700 text-xs">
              <span>🔐</span>
              <span>Pago seguro con encriptación SSL</span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          STAGE: APP — Vista piloto
      ══════════════════════════════════════════════════════ */}
      {stage === "app" && (
        <div className="min-h-screen bg-gray-100 text-gray-900 flex flex-col" style={{ maxWidth: 480, margin: "0 auto" }}>

          {/* Animaciones globales para notificaciones */}
          <style>{`
            @keyframes slideDownFade {
              from { transform: translateY(-100%); opacity: 0; }
              to   { transform: translateY(0);     opacity: 1; }
            }
          `}</style>

          {/* ══ NOTIFICACIÓN DEL DIRECTOR ══ */}
          {mensajeActivo && (() => {
            const BANNER_CFG = {
              info:    { bg: "bg-blue-600",   border: "border-blue-400",   emoji: "💬", label: "Dirección de Carrera" },
              warning: { bg: "bg-yellow-500", border: "border-yellow-300", emoji: "⚠️", label: "Aviso de pista" },
              danger:  { bg: "bg-red-600",    border: "border-red-400",    emoji: "🚨", label: "URGENTE" },
            };
            const bc = BANNER_CFG[mensajeActivo.tipo] || BANNER_CFG.info;
            return (
              <div
                className={`fixed top-0 left-0 right-0 ${bc.bg} border-b-2 ${bc.border} px-4 py-3 flex items-start gap-3 shadow-2xl`}
                style={{ zIndex: 3000, maxWidth: 480, margin: "0 auto", animation: "slideDownFade 0.35s ease" }}
                onClick={() => setMensajeActivo(null)}
              >
                <span className="text-2xl leading-none flex-shrink-0 mt-0.5">{bc.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white/70 uppercase tracking-wider">{bc.label}</p>
                  <p className="text-sm font-bold text-white leading-snug mt-0.5">{mensajeActivo.texto}</p>
                </div>
                <button
                  className="text-white/60 hover:text-white text-lg leading-none flex-shrink-0 mt-0.5"
                  onClick={e => { e.stopPropagation(); setMensajeActivo(null); }}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>
            );
          })()}

          {/* ══ OVERLAY PERMISO DE UBICACIÓN ══ */}
          {(gpsPermiso === "prompt" || gpsPermiso === "denied") && (
            <div
              className="fixed inset-0 flex items-center justify-center px-6"
              style={{ zIndex: 2500, background: "rgba(3,7,18,0.88)", maxWidth: 480, margin: "0 auto" }}
            >
              <div className="bg-white rounded-2xl px-6 py-7 w-full text-center shadow-2xl">
                <span className="text-5xl leading-none">📍</span>
                {gpsPermiso === "prompt" ? (
                  <>
                    <p className="text-gray-900 text-xl font-black mt-4">Activa tu ubicación</p>
                    <p className="text-gray-500 text-sm mt-2 leading-snug">
                      La app necesita tu GPS para mostrar tu velocidad, avisarte las banderas
                      de tu sector y que Dirección de Carrera te vea en pista.
                    </p>
                    <button
                      onClick={solicitarGPS}
                      disabled={gpsPidiendo}
                      className="mt-5 w-full bg-indigo-700 text-white font-bold py-3.5 rounded-xl active:scale-95 transition disabled:opacity-60"
                    >
                      {gpsPidiendo ? "Esperando GPS…" : "Compartir ubicación"}
                    </button>
                    <p className="text-gray-400 text-xs mt-3 leading-snug">
                      Cuando el teléfono pregunte, elige <b>&ldquo;Permitir&rdquo;</b>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-gray-900 text-xl font-black mt-4">Ubicación bloqueada</p>
                    <p className="text-gray-500 text-sm mt-2 leading-snug">
                      Este navegador tiene la ubicación denegada para la app. Actívala y vuelve a intentar:
                    </p>
                    <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 mt-4 text-left space-y-2">
                      <p className="text-gray-700 text-xs leading-snug">
                        <b>iPhone (Safari):</b> toca el botón <b>AA</b> en la barra de dirección
                        → Ajustes del sitio web → Ubicación → <b>Permitir</b>.
                      </p>
                      <p className="text-gray-700 text-xs leading-snug">
                        <b>Android (Chrome):</b> toca el candado junto a la dirección
                        → Permisos → Ubicación → <b>Permitir</b>.
                      </p>
                      <p className="text-gray-700 text-xs leading-snug">
                        Revisa también que la <b>Ubicación del teléfono</b> esté encendida
                        (Ajustes → Privacidad → Localización).
                      </p>
                    </div>
                    <button
                      onClick={solicitarGPS}
                      disabled={gpsPidiendo}
                      className="mt-4 w-full bg-indigo-700 text-white font-bold py-3.5 rounded-xl active:scale-95 transition disabled:opacity-60"
                    >
                      {gpsPidiendo ? "Verificando…" : "Ya la activé — Reintentar"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ══ LANDSCAPE — MODO CONDUCCIÓN ══ */}
          {isLandscape && (
            <div className="fixed inset-0 bg-gray-950 flex" style={{ maxWidth: "none", zIndex: 2000 }}>

              {/* Circuito — 70% */}
              <div className="flex items-center justify-center bg-gray-950" style={{ width: "70%" }}>
                <LeafletPilotMap
                  trazado={trazado}
                  bandera={estadoPista.bandera}
                  sectores={sectores}
                  height={viewportH - 32}
                />
              </div>

              {/* Panel bandera — 30% (color sólido, sin pulso, sin badge GPS) */}
              <div
                className={`flex flex-col items-center justify-center p-6 border-l ${flag.bg} ${flag.border}`}
                style={{ width: "30%" }}
              >
                <span className="text-6xl mb-5 leading-none">{flag.emoji}</span>
                <p className={`text-2xl font-black tracking-widest text-center leading-tight ${flag.color}`}>
                  {flag.title}
                </p>
                <p className={`text-sm mt-3 text-center leading-snug font-semibold ${flag.subColor}`}>
                  {flag.desc}
                </p>
                {flagEsPersonal && (
                  <span className={`mt-3 text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full bg-black/20 ${flag.color}`}>
                    DIRIGIDA A TI
                  </span>
                )}
              </div>

            </div>
          )}

          {/* ── HEADER ── */}
          <div className="bg-indigo-700 text-white px-4 flex items-center justify-between"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "0.75rem" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-sm text-white flex-shrink-0">
                {iniciales}
              </div>
              <div>
                <p className="text-xs text-indigo-200 leading-none">{nombreMostrar}</p>
                {eventoActivo ? (
                  <p className="text-xs text-indigo-100 leading-none mt-0.5 truncate max-w-[180px]">
                    🏁 {eventoActivo.fechaNombre}
                  </p>
                ) : (
                  <p className="text-xs text-indigo-100 leading-none mt-0.5">{vehiculoMostrar}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {eventoActivo && (
                <button onClick={volverAEventos}
                  className="text-xs text-indigo-200 hover:text-white transition px-2 py-1 rounded-lg hover:bg-indigo-600">
                  Cambiar
                </button>
              )}
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${semaforoGPS.bg} ${semaforoGPS.text}`}>
                {semaforoGPS.dot} {semaforoGPS.label}
              </span>
            </div>
          </div>

          {/* ── CONTENIDO PRINCIPAL ── */}
          <div className="flex-1 overflow-y-auto">

            {/* ── VISTA PRINCIPAL: PISTA ── */}
            {secView === "main" && (
              <div className="px-4 py-4 space-y-3">

                {/* Aviso si no está habilitado */}
                {!habilitado && (
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <span className="text-xl flex-shrink-0">🔒</span>
                    <div>
                      <p className="text-amber-700 text-xs font-semibold">Cuenta no habilitada para pista</p>
                      <button onClick={() => setStage("prueba")} className="text-amber-600 text-xs underline mt-0.5">
                        Completar prueba de conocimientos →
                      </button>
                    </div>
                  </div>
                )}

                {/* TRAZADO — Mapa Leaflet (solo en portrait) */}
                {!isLandscape && (
                  <LeafletPilotMap
                    trazado={trazado}
                    bandera={estadoPista.bandera}
                    sectores={sectores}
                    height={230}
                    onTap={() => setShowFullTrack(true)}
                  />
                )}

                {/* PIZARRA DE BANDERA — panel único grande */}
                <div className={`rounded-2xl border px-5 py-5 ${flag.bg} ${flag.border} ${flag.pulse ? "animate-pulse" : ""}`}>
                  <div className="flex items-center gap-4">
                    <span className="text-5xl flex-shrink-0">{flag.emoji}</span>
                    <div>
                      <p className={`text-2xl font-black tracking-widest leading-none ${flag.color}`}>{flag.title}</p>
                      <p className={`text-sm mt-1.5 leading-snug ${flag.subColor}`}>{flag.desc}</p>
                      {flagEsPersonal && (
                        <span className={`mt-1.5 inline-block text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full bg-white/10 ${flag.color}`}>
                          DIRIGIDA A TI
                        </span>
                      )}
                      {estadoPista.sector  && <p className="text-xs text-gray-500 mt-1">Sector: {estadoPista.sector}</p>}
                      {estadoPista.mensaje && <p className="text-xs text-gray-500 mt-0.5">{estadoPista.mensaje}</p>}
                    </div>
                  </div>
                </div>

                {/* SPEED CARD — Zona Amarilla */}
                <SpeedCard
                  geocercaCoords={geocerca}
                  recintoCoords={geocercaRecinto}
                  activo={gpsPermiso === "granted"}
                  onGPSChange={(d, r, pos) => {
                    setGpsEnPista(d); setGpsEnRecinto(r);
                    if (pos) setPosPiloto({ lat: pos.lat, lng: pos.lng, dentro: d }); // Task #58
                  }}
                  onGPSError={(code) => {
                    // permiso revocado en caliente → reaparece el overlay
                    if (code === 1) { localStorage.removeItem("gps_permiso_ok"); setGpsPermiso("denied"); }
                  }}
                />

              </div>
            )}

            {/* ── VISTA PERFIL ── */}
            {secView === "perfil" && (
              <div className="px-4 py-4 space-y-4">
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center text-xl font-bold">{iniciales}</div>
                  <div>
                    <p className="text-white font-bold text-lg leading-none">{nombreMostrar}</p>
                    <p className="text-gray-500 text-sm mt-0.5">{vehiculoMostrar}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-block mt-1.5 font-medium border ${
                      habilitado
                        ? "bg-green-950 text-green-400 border-green-800"
                        : estadoPiloto === "pendiente"
                        ? "bg-amber-950 text-amber-400 border-amber-800"
                        : "bg-red-950 text-red-400 border-red-800"
                    }`}>
                      {habilitado ? "🟢 Habilitado para pista" : estadoPiloto === "pendiente" ? "🟠 Prueba pendiente" : "🔴 No habilitado"}
                    </span>
                  </div>
                </div>


                <div className="bg-gray-900 border border-gray-800 rounded-2xl divide-y divide-gray-800">
                  {[
                    ["RUT",    pilotoData?.rut       || "—"],
                    ["Correo", pilotoData?.email      || "—"],
                    ["Teléfono", pilotoData?.telefono || "—"],
                    ["Prueba", habilitado ? "✓ Aprobada" : "⏳ Pendiente"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between px-4 py-3">
                      <span className="text-gray-500 text-sm">{k}</span>
                      <span className="text-gray-300 text-sm font-medium">{v}</span>
                    </div>
                  ))}
                </div>

                {!habilitado && (
                  <button onClick={() => setStage("prueba")} className="w-full bg-indigo-600 text-white py-3 rounded-2xl font-semibold hover:bg-indigo-700 transition">
                    Ir a la prueba de conocimientos →
                  </button>
                )}

                <button onClick={handleCerrarSesion} className="w-full border border-red-900 text-red-500 py-3 rounded-2xl text-sm font-medium hover:bg-red-950 transition">
                  Cerrar sesión
                </button>
              </div>
            )}

            {/* ── VISTA SALDO ── */}

            {/* ── VISTA REGLAMENTO ── */}
            {secView === "reglamento" && (
              <div className="px-4 py-4 space-y-3 pb-8">
                {/* Header */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
                  <p className="text-white text-xs font-bold uppercase tracking-widest mb-0.5">Reglamento TCC 2026</p>
                  <p className="text-gray-500 text-xs">Turismo Carretera Chileno · Documento oficial de temporada</p>
                </div>

                {/* Protocolo de banderas — mantiene diseño original */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
                    <span className="text-sm">🚩</span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Protocolo de Banderas</span>
                  </div>
                  <div className="divide-y divide-gray-800">
                    {BANDERAS_INFO.map((b, i) => (
                      <div key={i} className="p-4 flex gap-3 items-start">
                        <div className={`${b.color} w-4 h-4 rounded-sm mt-0.5 flex-shrink-0`} />
                        <div>
                          <p className="text-white text-xs font-semibold">{b.nombre}</p>
                          <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{b.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Resto del reglamento TCC */}
                {REGLAMENTO_TCC.filter(s => s.titulo !== "Protocolo de banderas").map((sec, si) => (
                  <div key={si} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-gray-800 flex items-center gap-2">
                      <span className="text-sm">{sec.icono}</span>
                      <span className="text-xs font-bold text-white uppercase tracking-wider">{sec.titulo}</span>
                    </div>
                    <div className="divide-y divide-gray-800/60">
                      {sec.items.map((item, ii) => (
                        <div key={ii} className="px-4 py-2.5 text-xs text-gray-400 leading-relaxed">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-xs text-gray-600">
                  📋 Reglamento Deportivo y Técnico TCC 2026 · Documento final de trabajo
                </div>
              </div>
            )}

          </div>

          {/* ── BOTTOM NAVIGATION — oculto en landscape ── */}
          {!isLandscape && (
            <div className="border-t border-gray-200 bg-white flex items-center justify-around px-1 py-1.5">
              {([
                { id: "main",        emoji: "🏁", label: "Pista"    },
                { id: "perfil",      emoji: "👤", label: "Perfil"   },
                { id: "reglamento",  emoji: "📄", label: "Reglas"   },
              ] as { id: SecView; emoji: string; label: string }[]).map(item => (
                <button
                  key={item.id}
                  onClick={() => setSecView(item.id)}
                  className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all ${
                    secView === item.id ? "text-indigo-700" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  <span className="text-xl">{item.emoji}</span>
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── BOTÓN QR FLOTANTE — oculto en landscape ── */}
          {!isLandscape && (
            <button
              onClick={() => habilitado ? setShowQRModal(true) : setStage("prueba")}
              className="fixed bottom-20 right-4 w-16 h-16 rounded-2xl z-40 flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-transform"
              style={{
                background:  habilitado ? "white" : "#1f2937",
                boxShadow:   habilitado
                  ? "0 0 0 1px rgba(255,255,255,0.1), 0 0 24px rgba(255,255,255,0.2), 0 8px 32px rgba(0,0,0,0.6)"
                  : "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <QRIcon size={26} color={habilitado ? "black" : "#4b5563"} />
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: habilitado ? "black" : "#4b5563" }}>QR</span>
            </button>
          )}

          {/* ── MODAL QR ── */}
          {showQRModal && (
            <div
              className="fixed inset-0 z-50 flex items-end"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}
              onClick={() => setShowQRModal(false)}
            >
              <div
                className="w-full bg-gray-950 border-t border-gray-800 rounded-t-3xl px-5 pt-5 pb-10"
                style={{ maxWidth: 480, margin: "0 auto" }}
                onClick={e => e.stopPropagation()}
              >
                <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-white font-bold text-lg">Mi QR de acceso</h2>
                    <p className="text-gray-500 text-xs mt-0.5">{nombreMostrar} · {vehiculoMostrar}</p>
                  </div>
                  <button
                    onClick={() => setShowQRModal(false)}
                    className="w-8 h-8 rounded-full bg-gray-800 text-gray-400 flex items-center justify-center font-medium hover:bg-gray-700 transition"
                  >
                    ✕
                  </button>
                </div>
                <QRGenerator pilotoId={pilotoData?.id} />
                <p className="text-xs text-gray-700 text-center mt-5">
                  Muestra este código al director de pista para ingresar a la sesión
                </p>
              </div>
            </div>
          )}

          {/* ── MODAL TRAZADO COMPLETO ── */}
          {showFullTrack && (
            <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col" style={{ maxWidth: 480, margin: "0 auto" }}>
              <div className="px-4 py-4 border-b border-gray-800 flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold">Vista completa del circuito</h2>
                  <p className="text-gray-500 text-xs mt-0.5">Trazado KML · Estado en tiempo real</p>
                </div>
                <button
                  onClick={() => setShowFullTrack(false)}
                  className="w-8 h-8 rounded-full bg-gray-800 text-gray-400 flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center p-4">
                <LeafletPilotMap trazado={trazado} bandera={estadoPista.bandera} sectores={sectores} height={300} />
              </div>
              <div className={`mx-4 mb-6 rounded-2xl border p-5 ${flag.bg} ${flag.border} ${flag.pulse ? "animate-pulse" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{flag.emoji}</span>
                  <div>
                    <p className={`font-black text-xl tracking-widest ${flag.color}`}>{flag.title}</p>
                    <p className={`text-sm mt-0.5 ${flag.subColor}`}>{flag.desc}</p>
                    {flagEsPersonal && (
                      <span className={`mt-1.5 inline-block text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full bg-white/10 ${flag.color}`}>
                        DIRIGIDA A TI
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}

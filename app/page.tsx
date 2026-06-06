"use client";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import GpsPiloto from "@/components/GpsPiloto";
import { getTrazadoActivo, getGeocercaActiva, puntoEnGeocerca, type Coordenada } from "@/lib/gps";
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

type Stage = "login" | "registro" | "prueba" | "app";
type SecView = "main" | "perfil" | "saldo" | "reglamento";
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
const PREGUNTAS = [
  { pregunta: "¿Por qué lado debes sobrepasar a otro vehículo en pista?", opciones: ["Por el lado izquierdo", "Por el lado derecho", "Por cualquier lado si hay espacio", "Solo en la recta principal"], correcta: 1 },
  { pregunta: "Si eres el vehículo adelantado, ¿qué debes hacer?", opciones: ["Acelerar para que no te pasen", "Cerrar la trayectoria para defenderte", "Mantener tu línea y facilitar el paso", "Frenarte bruscamente"], correcta: 2 },
  { pregunta: "¿Qué significa la bandera roja?", opciones: ["Acelera para salir de la zona", "Detención inmediata de todos los vehículos", "Solo se detienen los vehículos Sport", "El piloto puede continuar si está lejos"], correcta: 1 },
  { pregunta: "¿Qué indica la bandera amarilla?", opciones: ["Peligro, reducir velocidad y no adelantar", "Acelerar para salir rápido", "Puedes adelantar con precaución", "Fin de sesión, volver a boxes"], correcta: 0 },
  { pregunta: "¿Qué significa la bandera amarilla doble?", opciones: ["Adelantamiento permitido a baja velocidad", "Peligro grave. Velocidad máxima reducida. Adelantar prohibido.", "Dos zonas de peligro, puedes esquivarlas", "Advertencia menor, mantén el ritmo"], correcta: 1 },
  { pregunta: "¿Qué ocurre con el cobro si el vehículo se detiene dentro de pista?", opciones: ["El cobro se detiene automáticamente", "El cobro continúa mientras esté dentro de la geocerca", "El cobro se pausa tras 5 minutos detenido", "El piloto puede detenerlo desde la app"], correcta: 1 },
  { pregunta: "¿Quién puede pausar el cobro dentro de la pista?", opciones: ["El piloto desde su celular", "Solo el director de pista, con bandera roja o cerrando la sesión", "El cobro no puede pausarse", "Cualquier administrador"], correcta: 1 },
  { pregunta: "¿Qué ocurre al salir de la geocerca de pista?", opciones: ["El sistema cierra la tanda y detiene el cobro automáticamente", "Debes llamar al director para cerrar tu sesión", "Debes cerrar la sesión manualmente", "La tanda se cierra sola tras 10 minutos"], correcta: 0 },
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

// Config visual para la pizarra de banderas
const FLAG_CONFIG: Record<string, {
  bg: string; border: string; color: string; subColor: string;
  emoji: string; title: string; desc: string; pulse: boolean;
}> = {
  verde:          { bg: "bg-green-950",  border: "border-green-800",  color: "text-green-400",  subColor: "text-green-700",  emoji: "🟢",    title: "PISTA LIBRE",      desc: "Circulación normal habilitada",                       pulse: false },
  amarilla:       { bg: "bg-yellow-950", border: "border-yellow-800", color: "text-yellow-400", subColor: "text-yellow-700", emoji: "🟡",    title: "BANDERA AMARILLA", desc: "Reducir velocidad · Prohibido adelantar",              pulse: false },
  amarilla_doble: { bg: "bg-yellow-950", border: "border-yellow-700", color: "text-yellow-300", subColor: "text-yellow-600", emoji: "🟡🟡", title: "DOBLE AMARILLA",   desc: "Peligro grave · Velocidad reducida · No adelantar",    pulse: true  },
  roja:           { bg: "bg-red-950",    border: "border-red-700",    color: "text-red-400",    subColor: "text-red-700",    emoji: "🔴",    title: "BANDERA ROJA",     desc: "Detención inmediata · Dirigirse a boxes",              pulse: true  },
  safety_car:     { bg: "bg-orange-950", border: "border-orange-700", color: "text-orange-400", subColor: "text-orange-700", emoji: "🚗",    title: "SAFETY CAR",       desc: "Seguir al safety car · No adelantar",                 pulse: true  },
  blanca:         { bg: "bg-gray-900",   border: "border-gray-700",   color: "text-gray-200",   subColor: "text-gray-500",   emoji: "⬜",    title: "VEHÍCULO LENTO",  desc: "Máxima precaución · No adelantar",                    pulse: false },
  negra:          { bg: "bg-gray-950",   border: "border-gray-600",   color: "text-white",      subColor: "text-gray-400",   emoji: "⬛",    title: "INGRESE A BOXES", desc: "El piloto señalado debe retirarse de pista",          pulse: false },
};

// ── Componente: Speed Card (zona amarilla portrait) ──────────
function SpeedCard({ geocercaCoords }: { geocercaCoords: Coordenada[] }) {
  const [vel, setVel]       = useState(0);
  const [prec, setPrec]     = useState<number | null>(null);
  const [gpsOk, setGpsOk]   = useState(false);
  const [dentro, setDentro] = useState<boolean | null>(null);
  const gpsHist             = useRef<[number, number][]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsOk(true);
        setVel(pos.coords.speed != null ? Math.round(pos.coords.speed * 3.6) : 0);
        setPrec(Math.round(pos.coords.accuracy));
        // Suavizado GPS: promedia las últimas 4 lecturas para reducir jitter
        gpsHist.current.push([pos.coords.latitude, pos.coords.longitude]);
        if (gpsHist.current.length > 4) gpsHist.current.shift();
        const lat = gpsHist.current.reduce((s, p) => s + p[0], 0) / gpsHist.current.length;
        const lng = gpsHist.current.reduce((s, p) => s + p[1], 0) / gpsHist.current.length;
        if (geocercaCoords.length >= 3) {
          setDentro(puntoEnGeocerca({ lat, lng }, geocercaCoords));
        }
      },
      () => setGpsOk(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [geocercaCoords]);

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
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
              dentro === null
                ? "bg-gray-100 text-gray-500"
                : dentro
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-600"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                dentro === null ? "bg-gray-400" : dentro ? "bg-green-500" : "bg-red-500"
              }`} />
              {dentro === null ? "Verificando..." : dentro ? "En pista" : "Fuera de pista"}
            </div>
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
  const [geocerca, setGeocerca]       = useState<Coordenada[]>([]);
  const [sectores, setSectores]       = useState<Sector[]>([]);
  const [isLandscape, setIsLandscape] = useState(false);
  const [viewportH, setViewportH]     = useState(600);

  // ── Cargar sesión al montar ──
  useEffect(() => {
    getPiloto().then((data) => {
      if (data) {
        setPilotoData(data);
        setEstadoPiloto(data.prueba_aprobada ? "habilitado" : "deshabilitado");
        setStage("app");
      }
    });
  }, []);

  // ── Cargar trazado y estado de pista al entrar a la app ──
  useEffect(() => {
    if (stage !== "app") return;

    getTrazadoActivo().then((coords) => { if (coords) setTrazado(coords); });
    getGeocercaActiva().then((coords) => { if (coords) setGeocerca(coords); });

    supabase
      .from("estado_pista")
      .select("*")
      .eq("activo", true)
      .single()
      .then(({ data }) => {
        if (data) setEstadoPista({ bandera: data.bandera || "verde", sector: data.sector, mensaje: data.mensaje });
      });

    // Cargar sectores
    supabase
      .from("sectores_pista")
      .select("*")
      .order("orden")
      .then(({ data }) => { if (data) setSectores(data); });

    const channel = supabase
      .channel("flag-main")
      .on("postgres_changes", { event: "*", schema: "public", table: "estado_pista" }, (payload) => {
        const n = payload.new as any;
        if (n) setEstadoPista({ bandera: n.bandera || "verde", sector: n.sector, mensaje: n.mensaje });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sectores_pista" }, () => {
        supabase
          .from("sectores_pista")
          .select("*")
          .order("orden")
          .then(({ data }) => { if (data) setSectores(data); });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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

  // ── Detección de orientación ──
  useEffect(() => {
    const update = () => {
      const landscape = window.innerWidth > window.innerHeight;
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
      setTimeout(() => setStage("app"), 1800);
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
    setStage("app"); setLoading(false);
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

  const flag = FLAG_CONFIG[estadoPista.bandera] || FLAG_CONFIG.verde;
  const habilitado = estadoPiloto === "habilitado";

  // ─────────────────────────────────────────────────────────────
  return (
    <div>

      {/* ══════════════════════════════════════════════════════
          STAGES: LOGIN / REGISTRO / PRUEBA  (diseño original)
      ══════════════════════════════════════════════════════ */}
      {stage !== "app" && (
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
                    📋 Una vez creada tu cuenta deberás aprobar la prueba de conocimientos para quedar habilitado.
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
                      <div className="text-sm text-gray-500">Lee el reglamento antes de rendir la prueba. Necesitas 100% para habilitar tu cuenta.</div>
                      <div className="space-y-2">
                        {BANDERAS_INFO.map((b, i) => (
                          <div key={i} className="flex gap-3 items-start bg-gray-50 rounded-xl p-3 text-sm">
                            <div className={`${b.color} w-4 h-4 rounded-sm mt-0.5 flex-shrink-0`} />
                            <div><strong>{b.nombre}:</strong> {b.desc}</div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setSubTab("prueba")} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                        Ir a la prueba →
                      </button>
                    </div>
                  )}

                  {subTab === "prueba" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-500">Responde el 100% correctamente para habilitar tu cuenta.</div>
                        {evaluado && (
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${aprobado ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                            {aprobado ? "✓ Aprobada" : `${incorrectas} incorrecta${incorrectas > 1 ? "s" : ""}`}
                          </span>
                        )}
                      </div>
                      <div className="space-y-4">
                        {PREGUNTAS.map((p, qi) => (
                          <div key={qi} className="border rounded-xl p-4 space-y-3">
                            <div className="text-xs text-gray-400">Pregunta {qi + 1} de {PREGUNTAS.length}</div>
                            <div className="text-sm font-medium">{p.pregunta}</div>
                            <div className="space-y-2">
                              {p.opciones.map((op, oi) => {
                                let cls = "w-full text-left border rounded-xl px-3 py-2.5 text-sm transition flex items-center gap-3 ";
                                if (!evaluado) cls += respuestas[qi] === oi ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "hover:border-indigo-300 hover:bg-indigo-50";
                                else if (oi === p.correcta) cls += "border-green-500 bg-green-50 text-green-700";
                                else if (respuestas[qi] === oi) cls += "border-red-400 bg-red-50 text-red-600";
                                else cls += "opacity-40";
                                return (
                                  <button key={oi} onClick={() => selRespuesta(qi, oi)} className={cls} disabled={evaluado}>
                                    <span className="w-5 h-5 rounded-full border flex items-center justify-center text-xs font-medium flex-shrink-0">
                                      {evaluado && oi === p.correcta ? "✓" : evaluado && respuestas[qi] === oi ? "✗" : String.fromCharCode(65 + oi)}
                                    </span>
                                    {op}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                      {evaluado && aprobado && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-700">
                          <div className="font-semibold mb-1">🎉 ¡Prueba aprobada!</div>Accediendo a tu cuenta...
                        </div>
                      )}
                      {evaluado && !aprobado && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                          <div className="font-semibold mb-1">✗ {incorrectas} respuesta{incorrectas > 1 ? "s" : ""} incorrecta{incorrectas > 1 ? "s" : ""}</div>
                          Necesitas 100%. Las correctas están en verde.
                        </div>
                      )}
                      <div className="flex gap-2">
                        {!evaluado && (
                          <button onClick={evaluar} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
                            Enviar respuestas →
                          </button>
                        )}
                        {evaluado && !aprobado && (
                          <button onClick={reintentar} className="flex-1 border py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                            🔄 Reintentar
                          </button>
                        )}
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
          STAGE: APP — Vista piloto
      ══════════════════════════════════════════════════════ */}
      {stage === "app" && (
        <div className="min-h-screen bg-gray-100 text-gray-900 flex flex-col" style={{ maxWidth: 480, margin: "0 auto" }}>

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

              {/* Panel bandera — 30% */}
              <div
                className={`flex flex-col items-center justify-center p-6 border-l ${flag.bg} ${flag.border} ${flag.pulse ? "animate-pulse" : ""}`}
                style={{ width: "30%" }}
              >
                <span className="text-6xl mb-5 leading-none">{flag.emoji}</span>
                <p className={`text-xl font-black tracking-widest text-center leading-tight ${flag.color}`}>
                  {flag.title}
                </p>
                <p className={`text-xs mt-3 text-center leading-snug ${flag.subColor}`}>
                  {flag.desc}
                </p>
                {estadoPista.sector && (
                  <p className="text-xs text-gray-600 mt-4">Sector: {estadoPista.sector}</p>
                )}
                {estadoPista.mensaje && (
                  <p className="text-xs text-gray-600 mt-1">{estadoPista.mensaje}</p>
                )}
                {/* Mini indicador habilitado */}
                <div className={`mt-6 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${semaforo.bg} ${semaforo.text}`}>
                  {semaforo.dot} {semaforo.label}
                </div>
              </div>

            </div>
          )}

          {/* ── HEADER ── */}
          <div className="bg-indigo-700 text-white px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center font-bold text-sm text-white flex-shrink-0">
                {iniciales}
              </div>
              <div>
                <p className="text-xs text-indigo-200 leading-none">{nombreMostrar}</p>
                <p className="text-xs text-indigo-100 leading-none mt-0.5">{vehiculoMostrar}</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${semaforo.bg} ${semaforo.text}`}>
              {semaforo.dot} {semaforo.label}
            </span>
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
                      {estadoPista.sector  && <p className="text-xs text-gray-500 mt-1">Sector: {estadoPista.sector}</p>}
                      {estadoPista.mensaje && <p className="text-xs text-gray-500 mt-0.5">{estadoPista.mensaje}</p>}
                    </div>
                  </div>
                </div>

                {/* SPEED CARD — Zona Amarilla */}
                <SpeedCard geocercaCoords={geocerca} />

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

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <p className="text-xs text-gray-600 mb-1">Saldo</p>
                    <p className="text-3xl font-black text-white">{pilotoData?.saldo_minutos ?? 0}</p>
                    <p className="text-xs text-gray-600">minutos</p>
                  </div>
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <p className="text-xs text-gray-600 mb-1">Tandas</p>
                    <p className="text-3xl font-black text-white">—</p>
                    <p className="text-xs text-gray-600">este mes</p>
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
            {secView === "saldo" && (
              <div className="px-4 py-4 space-y-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <p className="text-xs text-gray-600 uppercase tracking-wider mb-2">Saldo disponible</p>
                  <p className="text-5xl font-black text-white">
                    {pilotoData?.saldo_minutos ?? 0}
                    <span className="text-xl text-gray-600 ml-2">min</span>
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[{ min: 30, precio: "$18.900" }, { min: 60, precio: "$34.900" }, { min: 120, precio: "$59.900" }].map((p, i) => (
                    <div key={i} className={`rounded-2xl p-3 text-center border-2 cursor-pointer transition ${i === 1 ? "border-green-700 bg-green-950" : "border-gray-800 bg-gray-900 hover:border-gray-600"}`}>
                      <p className="text-white font-bold text-xl">{p.min}</p>
                      <p className="text-gray-500 text-xs">min</p>
                      <p className="text-gray-400 text-xs mt-1">{p.precio}</p>
                      {i === 1 && <p className="text-green-500 text-xs mt-1">popular</p>}
                      {i === 2 && <p className="text-blue-400 text-xs mt-1">mejor valor</p>}
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {["Webpay (débito / crédito)", "MercadoPago"].map((m, i) => (
                    <label key={i} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-2xl p-4 cursor-pointer text-sm text-gray-300">
                      <input type="radio" name="pago" defaultChecked={i === 0} className="accent-green-500" />{m}
                    </label>
                  ))}
                </div>
                <button className="w-full bg-green-600 text-white py-3 rounded-2xl font-bold hover:bg-green-700 transition">
                  🔒 Pagar ahora
                </button>
              </div>
            )}

            {/* ── VISTA REGLAMENTO ── */}
            {secView === "reglamento" && (
              <div className="px-4 py-4 space-y-3">
                <p className="text-gray-500 text-sm">Consulta el protocolo de banderas y reglamento en cualquier momento.</p>
                {BANDERAS_INFO.map((b, i) => (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex gap-3">
                    <div className={`${b.color} w-4 h-4 rounded-sm mt-0.5 flex-shrink-0`} />
                    <div>
                      <p className="text-white text-sm font-semibold">{b.nombre}</p>
                      <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{b.desc}</p>
                    </div>
                  </div>
                ))}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-xs text-gray-500">
                  📋 La prueba de conocimientos se rinde una sola vez. Una vez aprobada quedas habilitado permanentemente.
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
                { id: "saldo",       emoji: "⏱",  label: "Saldo"    },
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

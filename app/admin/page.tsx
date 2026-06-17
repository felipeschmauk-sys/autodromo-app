"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  getTodosLosPilotos,
  getPilotosEnSesion,
  validarQRToken,
  confirmarIngreso,
  cerrarSesionAdmin,
} from "@/lib/auth";
import { supabase } from "@/lib/supabase";
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })
const QrScanner = dynamic(() => import("@/components/QrScanner"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-10 text-gray-400 text-sm">Iniciando cámara…</div>
  ),
});
const DireccionCarrera = dynamic(() => import('@/components/DireccionCarrera'), { ssr: false });
const SectoresEditor     = dynamic(() => import('@/components/SectoresEditor'),     { ssr: false });
const CircuitoManager    = dynamic(() => import('@/components/CircuitoManager'),    { ssr: false });
const AdminEventos     = dynamic(() => import('@/components/AdminEventos'),     { ssr: false });
// AdminMensajes desactivado temporalmente
// const AdminMensajes = dynamic(() => import('@/components/AdminMensajes'), { ssr: false });
// ─── Types ────────────────────────────────────────────────────────────────────
interface Sector {
  id: string;
  nombre: string;
  orden: number;
  punto_inicio: number;
  punto_fin: number;
  bandera: string;
}
interface Piloto {
  id: string;
  nombre: string;
  rut: string;
  telefono: string;
  prueba_aprobada: boolean;
  saldo_minutos: number;
  bloqueado: boolean;
}
interface SesionActiva {
  id: string;
  piloto_id: string;
  inicio: string;
  piloto?: Piloto;
}
interface ValidacionResult {
  valido: boolean;
  motivo?: string;
  piloto?: Piloto;
  qr_id?: string;
  advertencia?: string;
}
type PanelTab = "direccion" | "qr" | "pilotos" | "config" | "revision" | "eventos";
type TipoEvento = "racing" | "track_day" | "entrenamiento";
type QRStep = "idle" | "scanning" | "validating" | "result" | "confirmed";

interface Contexto {
  campeonatoId: string | null;
  campeonatoNombre: string;
  fechaId: string | null;
  fechaNombre: string;
  tipo: TipoEvento | null;
}

interface CampeonatoOpt { id: string; nombre: string; temporada: number; }
interface FechaOpt     { id: string; nombre: string; tipo: TipoEvento; estado: string; }

const TIPO_LABEL: Record<TipoEvento, string> = {
  racing:        "Racing",
  track_day:     "Track Day",
  entrenamiento: "Entrenamiento",
};
const TIPO_COLOR: Record<TipoEvento, string> = {
  racing:        "bg-red-600 text-white",
  track_day:     "bg-blue-600 text-white",
  entrenamiento: "bg-emerald-600 text-white",
};

// Tabs disponibles según tipo de evento
const TABS_POR_TIPO: Record<string, Array<{ id: PanelTab; label: string; emoji: string }>> = {
  racing: [
    { id: "direccion", label: "Dirección",    emoji: "🏎"  },
    { id: "qr",        label: "Acceso QR",    emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",      emoji: "👤"  },
    { id: "revision",  label: "Rev. Técnica", emoji: "🔧"  },
    { id: "config",    label: "Config",       emoji: "⚙️"  },
  ],
  track_day: [
    { id: "direccion", label: "Dirección",  emoji: "🏎"  },
    { id: "qr",        label: "Acceso QR",  emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",    emoji: "👤"  },
    { id: "config",    label: "Config",     emoji: "⚙️"  },
  ],
  entrenamiento: [
    { id: "direccion", label: "Dirección",  emoji: "🏎"  },
    { id: "qr",        label: "Acceso QR",  emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",    emoji: "👤"  },
    { id: "config",    label: "Config",     emoji: "⚙️"  },
  ],
  sin_contexto: [
    { id: "eventos",   label: "Eventos",    emoji: "📅"  },
  ],
};

const MAX_PILOTOS_DEFAULT = 10;
const MIN_SALDO_DEFAULT = 5;
const AUTODROMO_OPTIONS = [
  "Las Vizcachas — Puente Alto, RM",
  "Leyda — San Antonio, RM",
  "Codegua — O'Higgins",
  "Interlomas — Santiago",
  "Huachalalume — IV Región",
];
export default function AdminPage() {
  const [autenticado, setAutenticado] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<PanelTab>("direccion");
  const [pilotos, setPilotos] = useState<Piloto[]>([]);
  const [sesiones, setSesiones] = useState<SesionActiva[]>([]);
  const [loadingPilotos, setLoadingPilotos] = useState(false);
  const [maxPilotos, setMaxPilotos] = useState(MAX_PILOTOS_DEFAULT);
  const [minSaldo, setMinSaldo] = useState(MIN_SALDO_DEFAULT);
  const [bandera, setBandera]                 = useState("verde");
  const [cargandoBandera, setCargandoBandera] = useState(false);
  const [sectores, setSectores]               = useState<Sector[]>([]);
  const [autodromo, setAutodromo] = useState(AUTODROMO_OPTIONS[0]);
  const [busqueda, setBusqueda] = useState("");
  const [busquedaManual, setBusquedaManual] = useState("");
  const [ingresandoManualId, setIngresandoManualId] = useState<string | null>(null);
  const [ingresoManualOkId, setIngresoManualOkId] = useState<string | null>(null);
  const [accionandoInscId, setAccionandoInscId] = useState<string | null>(null);
  const [alertas, setAlertas] = useState<string[]>([]);
  // GPS state per pilot (para badge en "Pilotos en sesión")
  const [pilotoGpsState, setPilotoGpsState] = useState<Map<string, { dentro_geocerca: boolean | null; ts: number }>>(new Map());
  const [gpsTick, setGpsTick] = useState(0);
  // Circuito activo por evento — fuente de verdad para DireccionCarrera
  const [circuitoIdActivo, setCircuitoIdActivo] = useState<string | null>(null);
  const [realtimeConectado, setRealtimeConectado] = useState(false);
  const [qrStep, setQrStep] = useState<QRStep>("idle");
  const [validacion, setValidacion] = useState<ValidacionResult | null>(null);
  const [scanError, setScanError] = useState("");
  // ── Contexto activo ───────────────────────────────────────────────────────
  const [contexto, setContexto] = useState<Contexto>({
    campeonatoId: null, campeonatoNombre: "",
    fechaId: null,      fechaNombre: "",
    tipo: null,
  });
  const [campeonatosOpt, setCampeonatosOpt] = useState<CampeonatoOpt[]>([]);
  const [fechasOpt, setFechasOpt]           = useState<FechaOpt[]>([]);
  // ── Login ────────────────────────────────────────────────────────────────
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail === "admin@autodromo.cl" && loginPass === "admin123") {
      setAutenticado(true);
    } else {
      setLoginError("Credenciales incorrectas");
    }
  };
  // ── Data ─────────────────────────────────────────────────────────────────
  const cargarPilotos = useCallback(async () => {
    setLoadingPilotos(true);
    try {
      const data = await getTodosLosPilotos();
      setPilotos(data || []);
    } catch {
      setPilotos([]);
    } finally {
      setLoadingPilotos(false);
    }
  }, []);
  const cargarSesiones = useCallback(async () => {
    try {
      const data = await getPilotosEnSesion();
      setSesiones(data || []);
    } catch {
      setSesiones([]);
    }
  }, []);
  // ── Pilotos del evento (por inscripción) ─────────────────────────────────
  interface PilotoEvento {
    inscripcion_id: string;
    piloto_id: string;
    nombre: string;
    telefono: string;
    rut: string;
    bloqueado: boolean;
    estado_insc: string;
    pago_estado: string;
  }
  const [pilotosEvento, setPilotosEvento] = useState<PilotoEvento[]>([]);
  const [loadingPilotosEvento, setLoadingPilotosEvento] = useState(false);

  const cargarPilotosEvento = useCallback(async (fechaId: string) => {
    setLoadingPilotosEvento(true);
    const { data } = await supabase
      .from("inscripciones")
      .select("id, estado, pago_estado, piloto_id, pilotos(nombre, telefono, rut, bloqueado)")
      .eq("fecha_id", fechaId)
      .order("created_at");
    const mapped: PilotoEvento[] = (data || []).map((row: any) => ({
      inscripcion_id: row.id,
      piloto_id:      row.piloto_id,
      nombre:         row.pilotos?.nombre   || "—",
      telefono:       row.pilotos?.telefono || "",
      rut:            row.pilotos?.rut      || "",
      bloqueado:      row.pilotos?.bloqueado ?? false,
      estado_insc:    row.estado,
      pago_estado:    row.pago_estado,
    }));
    setPilotosEvento(mapped);
    setLoadingPilotosEvento(false);
  }, []);

  // ── Contexto: carga campeonatos y fechas ─────────────────────────────────
  const cargarCampeonatos = useCallback(async () => {
    const { data } = await supabase
      .from("campeonatos")
      .select("id, nombre, temporada")
      .eq("activo", true)
      .order("temporada", { ascending: false });
    setCampeonatosOpt(data || []);
  }, []);

  const cargarFechasDeContexto = useCallback(async (campeonatoId: string) => {
    const hoy = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
    const { data } = await supabase
      .from("fechas_evento")
      .select("id, nombre, tipo, estado, fecha_evento")
      .eq("campeonato_id", campeonatoId)
      .in("estado", ["borrador", "abierto"])   // solo fechas no finalizadas
      .gte("fecha_evento", hoy)                // solo hoy o futuras
      .order("fecha_evento");
    setFechasOpt((data || []) as FechaOpt[]);
  }, []);

  const seleccionarCampeonato = useCallback(async (campId: string) => {
    const camp = campeonatosOpt.find(c => c.id === campId);
    setContexto(prev => ({ ...prev, campeonatoId: campId, campeonatoNombre: camp?.nombre || "", fechaId: null, fechaNombre: "", tipo: null }));
    setFechasOpt([]);
    if (campId) await cargarFechasDeContexto(campId);
  }, [campeonatosOpt, cargarFechasDeContexto]);

  const seleccionarFecha = useCallback((fechaId: string) => {
    const fecha = fechasOpt.find(f => f.id === fechaId);
    if (!fecha) return;
    setContexto(prev => ({ ...prev, fechaId: fecha.id, fechaNombre: fecha.nombre, tipo: fecha.tipo }));
    cargarPilotosEvento(fecha.id);
    // Restaurar circuito asociado a este evento (si existe)
    const porFecha: Record<string, string> = JSON.parse(localStorage.getItem("circuitosByFecha") || "{}");
    setCircuitoIdActivo(porFecha[fecha.id] ?? null);
    // Si el tab actual no está disponible para este tipo, ir al primero disponible
    const tabsDisp = TABS_POR_TIPO[fecha.tipo] || TABS_POR_TIPO.sin_contexto;
    setTab(prev => (tabsDisp.some(t => t.id === prev) ? prev : tabsDisp[0].id) as PanelTab);
  }, [fechasOpt, cargarPilotosEvento]);

  // Callback: cuando CircuitoManager activa un circuito, vincularlo al evento activo
  const handleCircuitoActivado = useCallback((circuitoId: string) => {
    setCircuitoIdActivo(circuitoId);
    const fechaId = contexto.fechaId;
    if (fechaId) {
      const porFecha: Record<string, string> = JSON.parse(localStorage.getItem("circuitosByFecha") || "{}");
      porFecha[fechaId] = circuitoId;
      localStorage.setItem("circuitosByFecha", JSON.stringify(porFecha));
    }
  }, [contexto.fechaId]);

  // ── Banderas ─────────────────────────────────────────────────────────────
  const cargarBandera = useCallback(async () => {
    const { data } = await supabase
      .from("estado_pista")
      .select("bandera, max_pilotos")
      .eq("activo", true)
      .single();
    if (data?.bandera)     setBandera(data.bandera);
    if (data?.max_pilotos) setMaxPilotos(data.max_pilotos);
  }, []);

  const cargarSectores = useCallback(async () => {
    const { data } = await supabase
      .from("sectores_pista")
      .select("*")
      .order("orden");
    // Solo actualizar si cambió de verdad — evita re-renders innecesarios
    if (data) setSectores(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);
  }, []);

  const setSectorBandera = useCallback(async (id: string, nuevaBandera: string) => {
    // Optimistic update
    setSectores(prev => prev.map(s => s.id === id ? { ...s, bandera: nuevaBandera } : s));
    await supabase
      .from("sectores_pista")
      .update({ bandera: nuevaBandera })
      .eq("id", id);
  }, []);

  const aplicarBandera = useCallback(async (nuevaBandera: string) => {
    setCargandoBandera(true);
    setBandera(nuevaBandera); // optimistic
    try {
      const { error } = await supabase
        .from("estado_pista")
        .update({ bandera: nuevaBandera })
        .eq("activo", true);
      if (error) {
        console.error("Error actualizando bandera:", error);
        // Revertir si falla
        cargarBandera();
      }
    } finally {
      setCargandoBandera(false);
    }
  }, [cargarBandera]);

  useEffect(() => {
    if (!autenticado) return;
    cargarCampeonatos();
  }, [autenticado, cargarCampeonatos]);

  useEffect(() => {
    if (!autenticado) return;
    cargarPilotos();
    cargarSesiones();
    cargarBandera();
    cargarSectores();
    const channel = supabase
      .channel("admin-sesiones-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sesiones" },
          () => { cargarSesiones(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "pilotos" },
          () => { cargarPilotos(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "sectores_pista" },
          () => { cargarSectores(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ubicaciones_piloto" },
          (payload) => {
            const u = payload.new as any;
            setPilotoGpsState(prev => {
              const next = new Map(prev);
              next.set(u.piloto_id, { dentro_geocerca: u.dentro_geocerca, ts: Date.now() });
              return next;
            });
          })
      .subscribe((status) => { setRealtimeConectado(status === "SUBSCRIBED"); });

    // Ticker para re-calcular estado offline en el panel derecho cada 5 s
    const tickId = setInterval(() => setGpsTick(t => t + 1), 5_000);

    // Canal separado para la bandera global — si comparte canal con sectores,
    // los eventos pueden cruzarse y la bandera "parpadea" con cambios de sector.
    const chEstado = supabase
      .channel("admin-estado-pista")
      .on("postgres_changes", { event: "*", schema: "public", table: "estado_pista" },
          (payload) => {
            const n = payload.new as any;
            // Solo eventos de la fila activa de estado_pista (sectores no tienen `activo`)
            if (n?.activo !== true) return;
            if (typeof n.bandera === "string") setBandera(n.bandera);
            if (n.max_pilotos) setMaxPilotos(n.max_pilotos);
          })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(chEstado);
      clearInterval(tickId);
      setRealtimeConectado(false);
    };
  }, [autenticado, cargarPilotos, cargarSesiones, cargarBandera, cargarSectores]);
  // ── QR ───────────────────────────────────────────────────────────────────
  const iniciarScanner = useCallback(() => {
    setScanError("");
    setValidacion(null);
    setQrStep("scanning");
  }, []);
  const detenerScanner = useCallback(() => {
    setQrStep("idle");
    setValidacion(null);
    setScanError("");
  }, []);
  const handleScan = useCallback(async (decodedText: string) => {
    setQrStep("validating");
    try {
      const result = await validarQRToken(decodedText, maxPilotos, minSaldo);
      const normalized: ValidacionResult = {
        valido: (result as any).valido ?? (result as any).autorizado ?? false,
        motivo: (result as any).motivo,
        piloto: (result as any).piloto,
        qr_id: (result as any).qr_id,
      };
      setValidacion(normalized);
      setQrStep("result");
    } catch {
      setValidacion({ valido: false, motivo: "Error al validar el token QR" });
      setQrStep("result");
    }
  }, [maxPilotos, minSaldo]);
  const handleConfirmarIngreso = async () => {
    if (!validacion?.qr_id || !validacion?.piloto?.id) return;
    try {
      await confirmarIngreso(validacion.qr_id, validacion.piloto.id);
      setQrStep("confirmed");
      await cargarSesiones();
      setTimeout(() => { setQrStep("idle"); setValidacion(null); }, 3000);
    } catch {
      setScanError("Error al confirmar el ingreso.");
    }
  };
  const handleIngresoManual = async (pilotoId: string) => {
    if (sesiones.length >= maxPilotos) return;
    setIngresandoManualId(pilotoId);
    const { error } = await supabase
      .from("sesiones")
      .insert({ piloto_id: pilotoId, estado: "activa", inicio: new Date().toISOString() });
    if (!error) {
      setIngresoManualOkId(pilotoId);
      await cargarSesiones();
      if (contexto.fechaId) await cargarPilotosEvento(contexto.fechaId);
      setTimeout(() => setIngresoManualOkId(null), 3000);
    }
    setIngresandoManualId(null);
  };

  const cambiarEstadoInsc = async (inscripcionId: string, estado: string) => {
    setAccionandoInscId(inscripcionId);
    await supabase.from("inscripciones").update({ estado }).eq("id", inscripcionId);
    if (contexto.fechaId) await cargarPilotosEvento(contexto.fechaId);
    setAccionandoInscId(null);
  };

  const expulsarPiloto = async (pilotoId: string, inscripcionId: string) => {
    setAccionandoInscId(inscripcionId);
    // Cerrar sesión activa si tiene una
    await supabase
      .from("sesiones")
      .update({ estado: "cerrada", fin: new Date().toISOString() })
      .eq("piloto_id", pilotoId)
      .eq("estado", "activa");
    // Marcar inscripción como rechazada
    await supabase.from("inscripciones").update({ estado: "rechazado" }).eq("id", inscripcionId);
    if (contexto.fechaId) await cargarPilotosEvento(contexto.fechaId);
    await cargarSesiones();
    setAccionandoInscId(null);
  };

  const confirmarPagoAdmin = async (inscripcionId: string) => {
    setAccionandoInscId(inscripcionId);
    await supabase.from("inscripciones").update({
      pago_estado: "confirmado_admin",
      pago_confirmado_at: new Date().toISOString(),
    }).eq("id", inscripcionId);
    if (contexto.fechaId) await cargarPilotosEvento(contexto.fechaId);
    setAccionandoInscId(null);
  };

  useEffect(() => {
    if (tab !== "qr") detenerScanner();
  }, [tab, detenerScanner]);
  const pilotosFiltrados = pilotos.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.rut.includes(busqueda)
  );
  const nombreAutodromo = autodromo.split(" — ")[0];
  // ── Login screen ──────────────────────────────────────────────────────────
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-gray-900 text-white px-6 py-5 flex items-center gap-3">
            <span className="text-2xl">🏁</span>
            <div>
              <div className="font-bold text-sm tracking-wide">Panel Maestro</div>
              <div className="text-xs text-gray-400">Autódromo · Acceso restringido</div>
            </div>
          </div>
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={e => setLoginEmail(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="admin@autodromo.cl"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contraseña</label>
              <input
                type="password"
                value={loginPass}
                onChange={e => setLoginPass(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                placeholder="••••••••"
                required
              />
            </div>
            {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
            <button
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Ingresar
            </button>
          </form>
        </div>
      </div>
    );
  }
  // ── Main Panel ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-gray-900 text-white sticky top-0 z-50">
        {/* Fila 1: título + estado */}
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏁</span>
            <div>
              <div className="font-bold text-sm leading-none">Panel Maestro</div>
              <div className="text-xs text-gray-400 leading-none mt-0.5">Race Control</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {alertas.length > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                ⚠ {alertas.length}
              </div>
            )}
            <div className={`flex items-center gap-1.5 text-xs font-medium ${realtimeConectado ? "text-green-400" : "text-yellow-400"}`}>
              <span className={`w-2 h-2 rounded-full inline-block ${realtimeConectado ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`} />
              {realtimeConectado ? "En vivo" : "Conectando..."}
            </div>
            <button
              onClick={() => setAutenticado(false)}
              className="text-gray-400 hover:text-white text-xs transition-colors"
            >
              Salir
            </button>
          </div>
        </div>

        {/* Fila 2: selector de contexto */}
        <div className="px-4 pb-3 flex items-center gap-2">
          {/* Selector campeonato */}
          <select
            value={contexto.campeonatoId || ""}
            onChange={e => seleccionarCampeonato(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-500 truncate"
          >
            <option value="">— Campeonato —</option>
            {campeonatosOpt.map(c => (
              <option key={c.id} value={c.id}>{c.nombre} {c.temporada}</option>
            ))}
          </select>

          {/* Selector fecha */}
          <select
            value={contexto.fechaId || ""}
            onChange={e => seleccionarFecha(e.target.value)}
            disabled={!contexto.campeonatoId}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-gray-500 disabled:opacity-40 truncate"
          >
            <option value="">— Fecha —</option>
            {fechasOpt.map(f => (
              <option key={f.id} value={f.id}>{f.nombre}</option>
            ))}
          </select>

          {/* Pill tipo evento */}
          {contexto.tipo ? (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0 ${TIPO_COLOR[contexto.tipo]}`}>
              {TIPO_LABEL[contexto.tipo]}
            </span>
          ) : (
            <span className="text-xs text-gray-600 whitespace-nowrap flex-shrink-0">sin evento</span>
          )}
        </div>
      </header>

      <nav className="border-b border-gray-200 px-4 flex sticky top-[100px] z-40 overflow-x-auto" style={{ backgroundColor: "#ffffff", boxShadow: "0 1px 0 #e5e7eb, 0 -1px 0 #e5e7eb" }}>
        {(TABS_POR_TIPO[contexto.tipo || "sin_contexto"]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
              tab === t.id
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="text-base">{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className={`mx-auto p-4 space-y-4 ${tab === "direccion" ? "max-w-7xl" : tab === "config" ? "max-w-5xl" : "max-w-3xl"}`}>

        {/* ── BANNER: sin evento activo ──────────────────────────────── */}
        {!contexto.fechaId && tab !== "eventos" && tab !== "config" && (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl px-5 py-6 text-center space-y-3">
            <div className="text-3xl">📅</div>
            <p className="text-white font-semibold text-sm">Sin evento activo</p>
            <p className="text-gray-400 text-xs leading-relaxed">
              Seleccioná un campeonato y una fecha en el selector de arriba,<br />
              o creá uno nuevo desde la pestaña Eventos.
            </p>
            <button
              onClick={() => setTab("eventos")}
              className="mt-2 bg-white text-gray-900 text-xs font-bold px-5 py-2.5 rounded-xl hover:bg-gray-100 transition-colors"
            >
              Ir a Eventos →
            </button>
          </div>
        )}

        {/* ── DIRECCIÓN ──────────────────────────────────────────────── */}
        {tab === "direccion" && !contexto.fechaId && (
          <div className="rounded-2xl bg-gray-50 border border-gray-200 px-6 py-14 text-center">
            <p className="text-4xl mb-4">🏁</p>
            <p className="text-base font-bold text-gray-800">Sin fecha activa</p>
            <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
              Seleccioná un campeonato y una fecha en la parte superior para habilitar el control de pista.
            </p>
          </div>
        )}

        {tab === "direccion" && !!contexto.fechaId && (
          <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-5 lg:items-start space-y-4 lg:space-y-0">

          {/* ════ COLUMNA IZQUIERDA: MAPA (desktop) ════ */}
          <div className="lg:sticky lg:top-[116px] order-2 lg:order-1">
            <DireccionCarrera fechaId={contexto.fechaId} mapHeight={560} circuitoId={circuitoIdActivo} />
          </div>

          {/* ════ COLUMNA DERECHA: CONTROLES ════ */}
          <div className="space-y-4 order-1 lg:order-2">

            {/* ── Estado de pista + control de banderas ── */}
            <div className={`rounded-2xl border-2 px-5 py-4 space-y-4 transition-colors duration-500 ${
              bandera === "roja"             ? "bg-red-50    border-red-300"
              : bandera === "amarilla"       ? "bg-yellow-50 border-yellow-300"
              : bandera === "amarilla_doble" ? "bg-yellow-50 border-yellow-400"
              : bandera === "safety_car"     ? "bg-yellow-50 border-yellow-300"
              : bandera === "cuadros"        ? "bg-gray-100  border-gray-400"
              : "bg-green-50 border-green-300"
            }`}>
              {/* Estado actual */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                    bandera === "roja"               ? "bg-red-500 animate-pulse"
                    : bandera.startsWith("amarilla") ? "bg-yellow-500 animate-pulse"
                    : bandera === "safety_car"        ? "bg-yellow-500 animate-pulse"
                    : bandera === "cuadros"           ? "bg-gray-800"
                    : "bg-green-500 animate-pulse"
                  }`} />
                  <div>
                    <p className={`font-bold text-base leading-tight ${
                      bandera === "roja"               ? "text-red-700"
                      : bandera.startsWith("amarilla") ? "text-yellow-700"
                      : bandera === "safety_car"        ? "text-yellow-700"
                      : bandera === "cuadros"           ? "text-gray-800"
                      : "text-green-700"
                    }`}>
                      {bandera === "roja"             ? "🚩 BANDERA ROJA — Detención inmediata"
                       : bandera === "amarilla"       ? "🟡 BANDERA AMARILLA — Reducir velocidad"
                       : bandera === "amarilla_doble" ? "🟡🟡 DOBLE AMARILLA — Peligro grave"
                       : bandera === "safety_car"     ? "🚗 SAFETY CAR — Seguir al safety car"
                       : bandera === "cuadros"        ? "🏁 BANDERA DE CUADROS — Fin de sesión"
                       : "🟢 PISTA HABILITADA"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {sesiones.length} de {maxPilotos} cupos activos
                      {cargandoBandera && <span className="ml-2 text-xs text-gray-400">Enviando...</span>}
                    </p>
                  </div>
                </div>
              </div>

              {/* Botones de control */}
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => aplicarBandera("verde")}
                  disabled={bandera === "verde" || cargandoBandera}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all border-2 ${
                    bandera === "verde"
                      ? "bg-green-600 border-green-600 text-white shadow-lg shadow-green-200"
                      : "bg-white border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40"
                  }`}
                >
                  🟢 Verde
                </button>
                <button
                  onClick={() => aplicarBandera("roja")}
                  disabled={bandera === "roja" || cargandoBandera}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all border-2 ${
                    bandera === "roja"
                      ? "bg-red-600 border-red-600 text-white shadow-lg shadow-red-200 animate-pulse"
                      : "bg-white border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-40"
                  }`}
                >
                  🔴 Roja
                </button>
                <button
                  onClick={() => aplicarBandera("safety_car")}
                  disabled={bandera === "safety_car" || cargandoBandera}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all border-2 ${
                    bandera === "safety_car"
                      ? "bg-yellow-500 border-yellow-500 text-white shadow-lg shadow-yellow-200 animate-pulse"
                      : "bg-white border-yellow-300 text-yellow-700 hover:bg-yellow-50 disabled:opacity-40"
                  }`}
                >
                  🚗 Safety Car
                </button>
                <button
                  onClick={() => aplicarBandera("cuadros")}
                  disabled={bandera === "cuadros" || cargandoBandera}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-sm transition-all border-2 ${
                    bandera === "cuadros"
                      ? "bg-gray-900 border-gray-900 text-white shadow-lg shadow-gray-300"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-sm border border-gray-300 flex-shrink-0"
                    style={{ background: "repeating-conic-gradient(#111 0% 25%, #fff 0% 50%) 0 / 8px 8px" }}
                  />
                  Cuadros
                </button>
              </div>
            </div>
            {/* ── CONTROL DE SECTORES ── */}
            {sectores.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Control por sector</span>
                    {bandera === "roja" && (
                      <span className="text-xs text-red-500 font-medium">· Bandera roja activa</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{sectores.length} sectores</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {sectores.map((s, i) => {
                    const colors = ["bg-blue-400", "bg-amber-400", "bg-emerald-400", "bg-pink-400", "bg-violet-400", "bg-orange-400", "bg-cyan-400", "bg-lime-400"];
                    const dotColor = colors[i % colors.length];
                    const isGlobalOverride = bandera === "roja" || bandera === "amarilla" || bandera === "safety_car" || bandera === "cuadros";
                    const efectiva = isGlobalOverride ? bandera : s.bandera;
                    return (
                      <div key={s.id} className="px-5 py-3 flex items-center gap-4">
                        {/* Indicador de color de sector */}
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                        {/* Nombre */}
                        <span className="text-sm font-medium text-gray-800 flex-1">{s.nombre}</span>
                        {/* Estado efectivo */}
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          efectiva === "roja"           ? "bg-red-100 text-red-600"
                          : efectiva === "amarilla"     ? "bg-yellow-100 text-yellow-700"
                          : efectiva === "safety_car"   ? "bg-yellow-100 text-yellow-700"
                          : efectiva === "cuadros"      ? "bg-gray-200 text-gray-800"
                          : efectiva === "rayas"        ? "bg-yellow-100 text-red-700"
                          : "bg-green-100 text-green-700"
                        }`}>
                          {efectiva === "roja" ? "🔴 Roja"
                           : efectiva === "amarilla" ? "🟡 Amarilla"
                           : efectiva === "safety_car" ? "🚗 SC"
                           : efectiva === "cuadros" ? "🏁 Fin"
                           : efectiva === "rayas" ? "⚠️ Rayas"
                           : "🟢 Verde"}
                        </span>
                        {/* Botones solo si no hay override global */}
                        {!isGlobalOverride && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setSectorBandera(s.id, "verde")}
                              disabled={s.bandera === "verde"}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                s.bandera === "verde"
                                  ? "bg-green-600 border-green-600 text-white"
                                  : "bg-white border-gray-200 text-gray-500 hover:border-green-400 hover:text-green-600"
                              }`}
                            >
                              🟢
                            </button>
                            <button
                              onClick={() => setSectorBandera(s.id, "amarilla")}
                              disabled={s.bandera === "amarilla"}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                s.bandera === "amarilla"
                                  ? "bg-yellow-500 border-yellow-500 text-white animate-pulse"
                                  : "bg-white border-gray-200 text-gray-500 hover:border-yellow-400 hover:text-yellow-600"
                              }`}
                            >
                              🟡
                            </button>
                          </div>
                        )}
                        {isGlobalOverride && (
                          <span className="text-xs text-gray-400 italic">Override global</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── MENSAJES A PILOTOS — desactivado temporalmente ── */}

            <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Capacidad de pista</span>
                <span className="text-sm font-bold text-gray-900">{sesiones.length} / {maxPilotos}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    sesiones.length / maxPilotos >= 0.9 ? "bg-red-500"
                    : sesiones.length / maxPilotos >= 0.7 ? "bg-amber-400"
                    : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(100, (sesiones.length / maxPilotos) * 100)}%` }}
                />
              </div>
            </div>
            {alertas.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">⚠ Alertas activas</p>
                {alertas.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-sm text-amber-800">{a}</span>
                    <button
                      onClick={() => setAlertas(alertas.filter((_, j) => j !== i))}
                      className="text-amber-400 hover:text-amber-600 text-lg leading-none ml-4"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Pilotos en sesión</span>
                </div>
                <button onClick={cargarSesiones} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
              {sesiones.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">
                  Ningún piloto activo en este momento
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {sesiones.map(s => {
                    const nombre = s.piloto?.nombre || s.piloto_id.slice(0, 8);
                    const iniciales = nombre.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                    const colors = ["bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-pink-500", "bg-purple-500"];
                    const color = colors[nombre.charCodeAt(0) % colors.length];

                    // Calcular estado GPS del piloto
                    const gps = pilotoGpsState.get(s.piloto_id);
                    const OFFLINE_MS = 20_000;
                    const isOffline = !gps || (Date.now() - gps.ts) > OFFLINE_MS;
                    void gpsTick; // referencia para que React re-calcule cuando cambia el tick
                    const estadoBadge = isOffline
                      ? { label: "Sin señal", cls: "bg-red-100 text-red-600" }
                      : gps?.dentro_geocerca === true
                      ? { label: "En pista",  cls: "bg-green-100 text-green-700" }
                      : gps?.dentro_geocerca === false
                      ? { label: "En recinto", cls: "bg-yellow-100 text-yellow-700" }
                      : { label: "Sin GPS",   cls: "bg-gray-100 text-gray-500" };

                    return (
                      <div key={s.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-full ${color} text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                          {iniciales}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{nombre}</p>
                          <p className="text-xs text-gray-400">
                            {new Date(s.inicio).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoBadge.cls}`}>
                          {estadoBadge.label}
                        </span>
                        <button
                          onClick={async () => {
                            if (!confirm(`¿Retirar a ${nombre} de pista?`)) return;
                            await cerrarSesionAdmin(s.piloto_id);
                            cargarSesiones();
                          }}
                          className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition-colors"
                          title="Cerrar sesión del piloto"
                        >
                          ✕ Retirar
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Log de acciones</span>
              </div>
              <div className="divide-y divide-gray-50">
                {sesiones.slice(0, 5).map(s => (
                  <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-12 flex-shrink-0">
                      {new Date(s.inicio).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-sm text-gray-600">
                      {s.piloto?.nombre || `Piloto ${s.piloto_id.slice(0, 6)}`} — QR escaneado. Acceso autorizado.
                    </span>
                  </div>
                ))}
                {sesiones.length === 0 && (
                  <div className="px-5 py-6 text-center text-gray-400 text-sm">Sin registros aún</div>
                )}
              </div>
            </div>

          </div>

          </div>
        )}


        {/* ── ACCESO QR ──────────────────────────────────────────────── */}
        {tab === "qr" && (
          <>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Escanear QR de ingreso</p>
              </div>
              {qrStep === "idle" && (
                <div
                  onClick={sesiones.length < maxPilotos ? iniciarScanner : undefined}
                  className={`m-4 border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-3 transition-all ${
                    sesiones.length >= maxPilotos
                      ? "border-gray-200 opacity-50 cursor-not-allowed"
                      : "border-indigo-300 cursor-pointer hover:border-indigo-500 hover:bg-indigo-50"
                  }`}
                >
                  <span className="text-4xl">📷</span>
                  <p className="text-indigo-600 font-semibold text-sm">
                    {sesiones.length >= maxPilotos ? "Pista llena" : "Activar cámara para escanear QR"}
                  </p>
                  {scanError && <p className="text-red-500 text-xs text-center">{scanError}</p>}
                </div>
              )}
              {qrStep === "scanning" && (
                <div className="p-4">
                  <QrScanner onScan={handleScan} active={qrStep === "scanning"} />
                  <button
                    onClick={detenerScanner}
                    className="mt-3 w-full text-sm text-gray-500 border border-gray-200 rounded-xl py-2 hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {qrStep === "validating" && (
                <div className="py-12 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Validando…</p>
                </div>
              )}
              {qrStep === "result" && validacion && (
                <div className="p-4 space-y-3">
                  <div className={`rounded-xl p-4 border-2 flex items-center gap-3 ${
                    validacion.valido ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"
                  }`}>
                    <span className="text-2xl">{validacion.valido ? "✅" : "❌"}</span>
                    <div>
                      <p className={`font-bold text-sm ${validacion.valido ? "text-green-700" : "text-red-700"}`}>
                        {validacion.valido ? "QR Válido" : "QR Rechazado"}
                      </p>
                      {validacion.motivo && <p className="text-xs text-gray-500 mt-0.5">{validacion.motivo}</p>}
                    </div>
                  </div>
                  {validacion.piloto && (
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-2 text-sm">
                      <p className="font-bold text-gray-900">{validacion.piloto.nombre}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-gray-400 text-xs">RUT</span><p className="font-medium">{validacion.piloto.rut}</p></div>
                        <div><span className="text-gray-400 text-xs">Prueba</span><p className={validacion.piloto.prueba_aprobada ? "text-green-600 font-medium" : "text-amber-500 font-medium"}>{validacion.piloto.prueba_aprobada ? "✓ Aprobada" : "Pendiente"}</p></div>
                        <div><span className="text-gray-400 text-xs">Teléfono</span><p className="font-medium">{validacion.piloto.telefono || "—"}</p></div>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setQrStep("idle"); setValidacion(null); }}
                      className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    {validacion.valido ? (
                      <button
                        onClick={handleConfirmarIngreso}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
                      >
                        ✓ Confirmar ingreso
                      </button>
                    ) : (
                      <button
                        onClick={iniciarScanner}
                        className="flex-1 bg-gray-900 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
                      >
                        Escanear otro
                      </button>
                    )}
                  </div>
                </div>
              )}
              {qrStep === "confirmed" && (
                <div className="py-12 flex flex-col items-center gap-3">
                  <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center text-2xl">✓</div>
                  <p className="text-green-700 font-bold">¡Ingreso confirmado!</p>
                  <p className="text-sm text-gray-400">El piloto ha sido registrado en pista</p>
                </div>
              )}
            </div>
            {/* ── Ingreso manual: lista de inscritos confirmados ── */}
            {(() => {
              // Pilotos confirmados en el evento que aún no tienen sesión activa
              const pilotosElegibles = pilotosEvento.filter(p =>
                p.estado_insc === "confirmado" &&
                !sesiones.some(s => s.piloto_id === p.piloto_id)
              );
              const pilotosFiltrados = busquedaManual.trim()
                ? pilotosElegibles.filter(p =>
                    p.nombre.toLowerCase().includes(busquedaManual.toLowerCase()) ||
                    p.rut.includes(busquedaManual)
                  )
                : pilotosElegibles;

              return (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Ingreso manual
                    </p>
                    {pilotosElegibles.length > 0 && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                        {pilotosElegibles.length} pendiente{pilotosElegibles.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {!contexto.fechaId ? (
                    <p className="px-5 py-6 text-sm text-gray-400 text-center">
                      Seleccioná un evento para ver los pilotos disponibles.
                    </p>
                  ) : pilotosElegibles.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-gray-400 text-center">
                      Todos los pilotos confirmados ya están en carrera.
                    </p>
                  ) : (
                    <div className="p-4 space-y-3">
                      {/* Buscador */}
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
                        <input
                          type="text"
                          value={busquedaManual}
                          onChange={e => setBusquedaManual(e.target.value)}
                          placeholder="Buscar por nombre o RUT..."
                          className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                        />
                        {busquedaManual && (
                          <button
                            onClick={() => setBusquedaManual("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                          >×</button>
                        )}
                      </div>

                      {/* Lista de pilotos */}
                      <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                        {pilotosFiltrados.length === 0 ? (
                          <p className="px-4 py-4 text-sm text-gray-400 text-center">Sin coincidencias</p>
                        ) : pilotosFiltrados.map(p => {
                          const okEsteId = ingresoManualOkId === p.piloto_id;
                          const cargando = ingresandoManualId === p.piloto_id;
                          return (
                            <div key={p.piloto_id} className={`px-4 py-3 flex items-center justify-between gap-3 transition-colors ${okEsteId ? "bg-green-50" : "bg-white"}`}>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                                <p className="text-xs text-gray-400">{p.rut}</p>
                              </div>
                              {okEsteId ? (
                                <span className="text-xs font-bold text-green-600 flex items-center gap-1 flex-shrink-0">
                                  ✓ En carrera
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleIngresoManual(p.piloto_id)}
                                  disabled={cargando || sesiones.length >= maxPilotos}
                                  className="flex-shrink-0 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                                >
                                  {cargando ? "…" : "▶ Agregar"}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-400">Solo usar si el QR falla. Queda registrado en el log.</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
        {/* ── PILOTOS ────────────────────────────────────────────────── */}
        {tab === "pilotos" && (() => {
          if (!contexto.fechaId) return (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-14 text-center">
              <p className="text-4xl mb-4">👥</p>
              <p className="text-base font-bold text-gray-800">Sin fecha activa</p>
              <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
                Seleccioná un campeonato y una fecha arriba para ver los pilotos del evento.
              </p>
            </div>
          );

          if (loadingPilotosEvento) return (
            <div className="bg-white rounded-2xl border border-gray-200 py-12 flex justify-center">
              <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
            </div>
          );

          // Grupos por etapa del proceso
          const porAprobar   = pilotosEvento.filter(p => p.estado_insc === "solicitado");
          const porPago      = pilotosEvento.filter(p => p.estado_insc === "inscrito" && p.pago_estado === "pendiente");
          const porHabilitar = pilotosEvento.filter(p => p.estado_insc === "inscrito" && p.pago_estado === "confirmado_admin");
          const confirmados  = pilotosEvento.filter(p => p.estado_insc === "confirmado");
          const enPistaArr   = pilotosEvento.filter(p => sesiones.some(s => s.piloto_id === p.piloto_id));
          const rechazados   = pilotosEvento.filter(p => p.estado_insc === "rechazado");

          const totalPendientes = porAprobar.length + porPago.length + porHabilitar.length;

          const Avatar = ({ nombre }: { nombre: string }) => {
            const iniciales = nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
            const colors = ["bg-indigo-500","bg-teal-500","bg-orange-500","bg-pink-500","bg-purple-500"];
            const color = colors[nombre.charCodeAt(0) % colors.length];
            return (
              <div className={`w-9 h-9 rounded-full ${color} text-white text-sm font-bold flex items-center justify-center flex-shrink-0`}>
                {iniciales}
              </div>
            );
          };

          return (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Total",      val: pilotosEvento.length,  cls: "text-gray-900"  },
                  { label: "Por revisar",val: totalPendientes,        cls: "text-amber-600" },
                  { label: "Listos",     val: confirmados.length,     cls: "text-green-700" },
                  { label: "En pista",   val: enPistaArr.length,      cls: "text-green-600" },
                ].map((s, i) => (
                  <div key={i} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center">
                    <p className={`text-lg font-bold ${s.cls}`}>{s.val}</p>
                    <p className="text-xs text-gray-400 leading-tight mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              {pilotosEvento.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 py-10 text-center text-gray-400 text-sm">
                  Aún no hay pilotos inscritos en este evento
                </div>
              )}

              {/* ── SECCIÓN 1: Por aprobar (solicitado) ── */}
              {porAprobar.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-amber-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                      Solicitudes pendientes — {porAprobar.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {porAprobar.map(p => (
                      <div key={p.inscripcion_id} className="px-5 py-3.5 flex items-center gap-3">
                        <Avatar nombre={p.nombre} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400">{p.rut}{p.telefono ? ` · ${p.telefono}` : ""}</p>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => cambiarEstadoInsc(p.inscripcion_id, "inscrito")}
                            disabled={accionandoInscId === p.inscripcion_id}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold transition"
                          >
                            {accionandoInscId === p.inscripcion_id ? "…" : "✓ Aprobar"}
                          </button>
                          <button
                            onClick={() => cambiarEstadoInsc(p.inscripcion_id, "rechazado")}
                            disabled={accionandoInscId === p.inscripcion_id}
                            className="text-xs border border-red-200 hover:bg-red-50 disabled:opacity-50 text-red-600 px-3 py-1.5 rounded-lg font-semibold transition"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── SECCIÓN 2: Inscrito, esperando pago ── */}
              {porPago.length > 0 && (
                <div className="bg-white rounded-2xl border border-blue-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-blue-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
                      Esperando pago — {porPago.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {porPago.map(p => (
                      <div key={p.inscripcion_id} className="px-5 py-3.5 flex items-center gap-3">
                        <Avatar nombre={p.nombre} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400">{p.rut}{p.telefono ? ` · ${p.telefono}` : ""}</p>
                        </div>
                        <button
                          onClick={() => confirmarPagoAdmin(p.inscripcion_id)}
                          disabled={accionandoInscId === p.inscripcion_id}
                          className="flex-shrink-0 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold transition"
                        >
                          {accionandoInscId === p.inscripcion_id ? "…" : "💳 Confirmar pago"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── SECCIÓN 3: Pago confirmado, por habilitar ── */}
              {porHabilitar.length > 0 && (
                <div className="bg-white rounded-2xl border border-indigo-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-indigo-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
                      Pago confirmado, por habilitar — {porHabilitar.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {porHabilitar.map(p => (
                      <div key={p.inscripcion_id} className="px-5 py-3.5 flex items-center gap-3">
                        <Avatar nombre={p.nombre} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                          <p className="text-xs text-gray-400">{p.rut}{p.telefono ? ` · ${p.telefono}` : ""}</p>
                        </div>
                        <button
                          onClick={() => cambiarEstadoInsc(p.inscripcion_id, "confirmado")}
                          disabled={accionandoInscId === p.inscripcion_id}
                          className="flex-shrink-0 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-semibold transition"
                        >
                          {accionandoInscId === p.inscripcion_id ? "…" : "✓ Habilitar"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── SECCIÓN 4: Confirmados (listos para pista) ── */}
              {confirmados.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Confirmados — {confirmados.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {confirmados.map(p => {
                      const enPista  = sesiones.some(s => s.piloto_id === p.piloto_id);
                      const cargando = accionandoInscId === p.inscripcion_id;
                      return (
                        <div key={p.inscripcion_id} className="px-5 py-3.5 flex items-center gap-3">
                          <Avatar nombre={p.nombre} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                            <p className="text-xs text-gray-400">{p.rut}{p.telefono ? ` · ${p.telefono}` : ""}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {enPista ? (
                              <span className="text-xs bg-green-100 text-green-700 font-bold px-2.5 py-1 rounded-full">
                                🟢 En pista
                              </span>
                            ) : (
                              <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">
                                Listo · QR pendiente
                              </span>
                            )}
                            <button
                              onClick={() => expulsarPiloto(p.piloto_id, p.inscripcion_id)}
                              disabled={cargando}
                              title="Expulsar del evento"
                              className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 border border-transparent hover:border-red-200 px-2 py-1 rounded-lg transition"
                            >
                              {cargando ? "…" : "⊗"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── SECCIÓN 5: Rechazados (colapsado) ── */}
              {rechazados.length > 0 && (
                <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Rechazados — {rechazados.length}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100 px-5 pb-3">
                    {rechazados.map(p => (
                      <div key={p.inscripcion_id} className="py-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm text-gray-500">{p.nombre}</p>
                          <p className="text-xs text-gray-400">{p.rut}</p>
                        </div>
                        <button
                          onClick={() => cambiarEstadoInsc(p.inscripcion_id, "solicitado")}
                          disabled={accionandoInscId === p.inscripcion_id}
                          className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-2.5 py-1 rounded-lg transition"
                        >
                          Restaurar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
        {/* ── EVENTOS / CAMPEONATOS ───────────────────────────────────── */}
        {tab === "eventos" && (
          <AdminEventos
            contextoFechaId={contexto.fechaId}
            onContextoCambia={cargarCampeonatos}
          />
        )}

        {/* ── REVISIÓN TÉCNICA ────────────────────────────────────────── */}
        {tab === "revision" && (
          <div style={{
            position: "fixed",
            inset: 0,
            top: 112,
            zIndex: 10,
          }}>
            <iframe
              src="/revision-tecnica.html"
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
              title="Revisión Técnica TCC 2026"
            />
          </div>
        )}

        {/* ── CONFIG ─────────────────────────────────────────────────── */}
        {tab === "config" && (
          <div className="space-y-5">

            {/* Biblioteca de circuitos */}
            <CircuitoManager
              onMaxPilotosChange={setMaxPilotos}
              onCircuitoActivado={handleCircuitoActivado}
            />

            {/* Sectores de pista */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
                <span className="text-base">🏁</span>
                <div>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Sectores de pista</p>
                  <p className="text-xs text-gray-400 mt-0.5">Divisiones del circuito activo para control independiente de banderas</p>
                </div>
              </div>
              <div className="p-5">
                <SectoresEditor circuitoId={circuitoIdActivo} />
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

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
import { registrarLog, setTandaActivaLog, NOMBRE_BANDERA } from "@/lib/log";
const GeofenceMap = dynamic(() => import('@/components/GeofenceMap'), { ssr: false })
const QrScanner = dynamic(() => import("@/components/QrScanner"), {
  ssr: false,
  loading: () => (
    <div className="text-center py-10 text-gray-400 text-sm">Iniciando cámara…</div>
  ),
});
const DireccionCarrera = dynamic(() => import('@/components/DireccionCarrera'), { ssr: false });
const Cronometraje     = dynamic(() => import('@/components/Cronometraje'),     { ssr: false });
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
  numero?: string | null;   // número de competición (hasta 3 caracteres)
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
  bandera_piloto?: string | null;
  piloto?: Piloto;
}

// ── Banderas personales por piloto ──────────────────────────────
// Solo las ve el piloto al que se le asignan (sesiones.bandera_piloto).
// Disponibles según el tipo de sesión, igual que en DireccionCarrera.
const BANDERAS_PILOTO: Array<{
  value: string; label: string; emoji: string; activeCls: string; tipos: string[];
}> = [
  { value: "azul",         label: "Azul — dejar pasar", emoji: "🔵", activeCls: "bg-blue-600 border-blue-600 text-white",     tipos: ["racing", "track_day"] },
  { value: "negra_blanco", label: "Advertencia",        emoji: "⚠️", activeCls: "bg-gray-700 border-gray-700 text-white",     tipos: ["racing"] },
  { value: "negra",        label: "Negra — exclusión",  emoji: "⚫", activeCls: "bg-black border-black text-white",           tipos: ["racing", "track_day"] },
  { value: "taller",       label: "A taller",           emoji: "🔧", activeCls: "bg-violet-600 border-violet-600 text-white", tipos: ["racing", "track_day", "entrenamiento"] },
];
interface ValidacionResult {
  valido: boolean;
  motivo?: string;
  piloto?: Piloto;
  qr_id?: string;
  advertencia?: string;
}
type PanelTab = "direccion" | "crono" | "qr" | "pilotos" | "config" | "revision" | "eventos";
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
    { id: "crono",     label: "Crono",        emoji: "⏱"   },
    { id: "qr",        label: "Acceso QR",    emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",      emoji: "👤"  },
    { id: "revision",  label: "Rev. Técnica", emoji: "🔧"  },
    { id: "config",    label: "Config",       emoji: "⚙️"  },
  ],
  track_day: [
    { id: "direccion", label: "Dirección",  emoji: "🏎"  },
    { id: "crono",     label: "Crono",      emoji: "⏱"   },
    { id: "qr",        label: "Acceso QR",  emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",    emoji: "👤"  },
    { id: "config",    label: "Config",     emoji: "⚙️"  },
  ],
  entrenamiento: [
    { id: "direccion", label: "Dirección",  emoji: "🏎"  },
    { id: "crono",     label: "Crono",      emoji: "⏱"   },
    { id: "qr",        label: "Acceso QR",  emoji: "📷"  },
    { id: "pilotos",   label: "Pilotos",    emoji: "👤"  },
    { id: "config",    label: "Config",     emoji: "⚙️"  },
  ],
  sin_contexto: [
    { id: "eventos",   label: "Eventos",    emoji: "📅"  },
  ],
};

// ── Tarjeta de tanda en curso (Dirección): tipo + tiempo/vueltas ──────────
function TandaStatusCard({
  tanda, cruces,
}: {
  tanda: { nombre: string; tipo: string; inicio: string; duracion_min?: number | null; vueltas_programadas?: number | null };
  cruces: number;
}) {
  const [, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT(x => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const COLOR: Record<string, string> = {
    libre: "bg-gray-600", entrenamiento: "bg-emerald-600",
    clasificacion: "bg-blue-600", carrera: "bg-red-600",
  };
  const inicioMs     = new Date(tanda.inicio).getTime();
  const transcurrido = Math.max(0, Math.floor((Date.now() - inicioMs) / 1000));
  const restante     = tanda.duracion_min ? Math.max(0, tanda.duracion_min * 60 - transcurrido) : null;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const esCarrera = tanda.tipo === "carrera";
  return (
    <div className="bg-gray-900 rounded-2xl px-4 py-3 flex items-center gap-3">
      <span className={`text-[11px] font-bold tracking-wider text-white px-2.5 py-1 rounded-full flex-shrink-0 ${COLOR[tanda.tipo] || "bg-gray-600"}`}>
        {tanda.nombre.toUpperCase()}
      </span>
      <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        En curso
      </span>
      <div className="ml-auto text-right leading-tight">
        {esCarrera && tanda.vueltas_programadas ? (
          <p className="text-white font-bold tabular-nums text-sm">
            Vuelta {Math.max(0, cruces - 1)} <span className="text-gray-500">/ {tanda.vueltas_programadas}</span>
          </p>
        ) : null}
        <p className="text-gray-300 text-sm font-semibold tabular-nums">
          {restante != null ? <>Restan {fmt(restante)}</> : <>⏱ {fmt(transcurrido)}</>}
        </p>
      </div>
    </div>
  );
}

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
  const [pilotoGpsState, setPilotoGpsState] = useState<Map<string, { dentro_geocerca: boolean | null; dentro_recinto: boolean | null; ts: number }>>(new Map());
  const [gpsTick, setGpsTick] = useState(0);

  // ── Estado GPS unificado del piloto ──────────────────────────
  // Misma lógica y mismas etiquetas que ve el piloto en su app
  // (SpeedCard 3 niveles) + "Sin señal" cuando dejó de transmitir.
  // Usar SIEMPRE este helper en cualquier vista del admin.
  const GPS_OFFLINE_MS = 20_000;
  const estadoGpsPiloto = (pilotoId: string): { label: string; cls: string } => {
    const gps = pilotoGpsState.get(pilotoId);
    if (!gps || Date.now() - gps.ts > GPS_OFFLINE_MS)
      return { label: "Sin señal", cls: "bg-red-100 text-red-600" };
    if (gps.dentro_geocerca === true)
      return { label: "En pista", cls: "bg-green-100 text-green-700" };
    // 2 zonas visibles: pista o boxes. El detalle del recinto se registra
    // internamente (constancia de asistencia) pero no se muestra.
    if (gps.dentro_geocerca === false)
      return { label: "Boxes", cls: "bg-indigo-100 text-indigo-700" };
    return { label: "Sin GPS", cls: "bg-gray-100 text-gray-500" };
  };
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
    numero: string | null;
    telefono: string;
    rut: string;
    bloqueado: boolean;
    estado_insc: string;
    pago_estado: string;
  }
  const [pilotosEvento, setPilotosEvento] = useState<PilotoEvento[]>([]);
  const [loadingPilotosEvento, setLoadingPilotosEvento] = useState(false);

  // silencioso = true: refresco en segundo plano (realtime/polling) sin spinner
  const cargarPilotosEvento = useCallback(async (fechaId: string, silencioso = false) => {
    if (!silencioso) setLoadingPilotosEvento(true);
    const res = await supabase
      .from("inscripciones")
      .select("id, estado, pago_estado, piloto_id, pilotos(nombre, numero, telefono, rut, bloqueado)")
      .eq("fecha_id", fechaId)
      .order("created_at");
    let data: any[] | null = res.data as any;
    // Compatibilidad: si la columna numero aún no está migrada, reintenta sin ella
    if (res.error) {
      const r2 = await supabase
        .from("inscripciones")
        .select("id, estado, pago_estado, piloto_id, pilotos(nombre, telefono, rut, bloqueado)")
        .eq("fecha_id", fechaId)
        .order("created_at");
      data = r2.data as any;
    }
    const mapped: PilotoEvento[] = (data || []).map((row: any) => ({
      inscripcion_id: row.id,
      piloto_id:      row.piloto_id,
      nombre:         row.pilotos?.nombre   || "—",
      numero:         row.pilotos?.numero   ?? null,
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
    const hoy = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0]; // "YYYY-MM-DD"
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

  // Circuito asignado a una fecha: DB primero, localStorage como respaldo
  const resolverCircuitoDeFecha = useCallback(async (fechaId: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("fechas_evento")
      .select("circuito_id")
      .eq("id", fechaId)
      .maybeSingle();
    if (!error && (data as any)?.circuito_id) return (data as any).circuito_id as string;
    const porFecha: Record<string, string> = JSON.parse(localStorage.getItem("circuitosByFecha") || "{}");
    return porFecha[fechaId] ?? null;
  }, []);

  const seleccionarFecha = useCallback((fechaId: string) => {
    const fecha = fechasOpt.find(f => f.id === fechaId);
    if (!fecha) return;
    setContexto(prev => ({ ...prev, fechaId: fecha.id, fechaNombre: fecha.nombre, tipo: fecha.tipo }));
    cargarPilotosEvento(fecha.id);
    // Restaurar circuito asociado a este evento (DB primero, localStorage de respaldo)
    setCircuitoIdActivo(null);
    resolverCircuitoDeFecha(fecha.id).then(setCircuitoIdActivo);
    // Si el tab actual no está disponible para este tipo, ir al primero disponible
    const tabsDisp = TABS_POR_TIPO[fecha.tipo] || TABS_POR_TIPO.sin_contexto;
    setTab(prev => (tabsDisp.some(t => t.id === prev) ? prev : tabsDisp[0].id) as PanelTab);
  }, [fechasOpt, cargarPilotosEvento, resolverCircuitoDeFecha]);

  // ── Refs para el log de entradas/salidas de pista ────────────────────────
  // Los callbacks de Realtime se crean una sola vez; estos refs les dan
  // acceso al estado vigente sin re-suscribir.
  const gpsStateRef = useRef(pilotoGpsState);
  useEffect(() => { gpsStateRef.current = pilotoGpsState; }, [pilotoGpsState]);
  const fechaIdRef = useRef<string | null>(null);
  useEffect(() => { fechaIdRef.current = contexto.fechaId; }, [contexto.fechaId]);
  const nombresSesionRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const m = new Map<string, string>();
    sesiones.forEach(s => m.set(s.piloto_id, s.piloto?.nombre || s.piloto_id.slice(0, 8)));
    nombresSesionRef.current = m;
  }, [sesiones]);
  // Pilotos cuya pérdida de señal ya quedó registrada (evita duplicados)
  const offlineAvisadoRef = useRef<Set<string>>(new Set());

  // ── Tandas de la fecha (entrenamiento / clasificación / carrera) ─────────
  interface Tanda {
    id: string; tipo: string; nombre: string; inicio: string; fin: string | null;
    duracion_min?: number | null; vueltas_programadas?: number | null;
  }
  const TIPO_TANDA_LABEL: Record<string, string> = {
    libre: "Libre", entrenamiento: "Entrenamiento", clasificacion: "Clasificación", carrera: "Carrera",
  };
  const [tandasFecha, setTandasFecha]   = useState<Tanda[]>([]);
  const [tandaActiva, setTandaActivaUi] = useState<Tanda | null>(null);
  const [tandaSel, setTandaSel]         = useState<string>("todas"); // "todas" | tanda.id

  const cargarTandas = useCallback(async (fechaId: string) => {
    try {
      const { data, error } = await supabase
        .from("tandas")
        .select("*")
        .eq("fecha_id", fechaId)
        .order("inicio");
      if (error) throw error;
      const lista = (data || []) as Tanda[];
      setTandasFecha(lista);
      const activa = lista.find(t => !t.fin) || null;
      setTandaActivaUi(activa);
      setTandaActivaLog(activa?.id ?? null);
    } catch {
      // tabla sin migrar: sin tandas, el log funciona igual
      setTandasFecha([]); setTandaActivaUi(null); setTandaActivaLog(null);
    }
  }, []);

  // Núcleo compartido: lo usan el Log de acciones y la pestaña Crono
  const iniciarTanda = useCallback(async (tipo: string, durMin: number | null, vueltasProg: number | null) => {
    if (!contexto.fechaId || tandaActiva || !tipo) return;
    const n = tandasFecha.filter(t => t.tipo === tipo).length + 1;
    const nombre = `${TIPO_TANDA_LABEL[tipo] || tipo} ${n}`;
    const dur = durMin;
    const vp  = tipo === "carrera" ? vueltasProg : null;

    // Meta congelada al iniciar: se copia desde el circuito del evento
    let metaIdx: number | null = null;
    try {
      if (circuitoIdActivo) {
        const { data: c } = await supabase
          .from("circuitos").select("meta_idx").eq("id", circuitoIdActivo).maybeSingle();
        metaIdx = (c as any)?.meta_idx ?? 0;
      }
    } catch { /* columna sin migrar */ }

    let res = await supabase
      .from("tandas")
      .insert({ fecha_id: contexto.fechaId, tipo, nombre, duracion_min: dur, vueltas_programadas: vp, meta_idx: metaIdx })
      .select()
      .single();
    let sinMigracion = false;
    if (res.error) {
      // Columnas de cronometraje sin migrar: crear la tanda básica igual,
      // pero AVISANDO fuerte — sin duración guardada no hay auto-cierre
      sinMigracion = true;
      res = await supabase
        .from("tandas")
        .insert({ fecha_id: contexto.fechaId, tipo, nombre })
        .select()
        .single();
    }
    if (res.error || !res.data) return;
    setTandaActivaLog(res.data.id);
    // El log y Crono siguen automáticamente la tanda recién iniciada
    setTandaSel(res.data.id);

    // Regla: tanda iniciada = bandera VERDE automática
    setBandera("verde");
    await supabase.from("estado_pista").update({ bandera: "verde" }).eq("activo", true);
    await registrarLog({ fecha_id: contexto.fechaId, tipo: "bandera_global", descripcion: "Bandera global: Verde (inicio de tanda)" });

    const detalle = `${dur ? ` · ${dur} min` : ""}${vp ? ` · ${vp} vueltas` : ""}`;
    await registrarLog({ fecha_id: contexto.fechaId, tipo: "tanda", descripcion: `▶️ Tanda iniciada: ${nombre}${detalle}` });
    if (sinMigracion) {
      await registrarLog({ fecha_id: contexto.fechaId, tipo: "tanda", descripcion: "⚠️ Tanda creada SIN duración: falta correr la migración de cronometraje (no habrá auto-cierre ni conteo de vueltas)" });
      alert("⚠️ Falta correr la migración de cronometraje en Supabase (docs/task-cronometraje-migration.sql).\n\nLa tanda se creó SIN duración: no se cerrará sola y no contará vueltas.");
    }
    cargarTandas(contexto.fechaId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto.fechaId, tandaActiva, tandasFecha, cargarTandas, circuitoIdActivo]);

  const finalizarTanda = useCallback(async () => {
    if (!contexto.fechaId || !tandaActiva) return;
    // Bandera a cuadros automática al finalizar la tanda (misma escritura
    // que aplicarBandera; inline por orden de declaración de callbacks)
    setBandera("cuadros");
    await supabase.from("estado_pista").update({ bandera: "cuadros" }).eq("activo", true);
    await registrarLog({ fecha_id: contexto.fechaId, tipo: "bandera_global", descripcion: "Bandera global: Cuadros (fin de tanda)" });
    // Registrar el cierre ANTES de soltar la tanda para que quede dentro de ella
    await registrarLog({ fecha_id: contexto.fechaId, tipo: "tanda", descripcion: `⏹ Tanda finalizada: ${tandaActiva.nombre}` });
    await supabase.from("tandas").update({ fin: new Date().toISOString() }).eq("id", tandaActiva.id);
    setTandaActivaLog(null);
    cargarTandas(contexto.fechaId);
  }, [contexto.fechaId, tandaActiva, cargarTandas]);

  // ── Cierre AUTOMÁTICO de la tanda: por tiempo, o por vueltas en carrera ──
  // (lo que ocurra primero). Lanza la bandera a cuadros y finaliza la tanda;
  // los pilotos completan su vuelta en curso gracias a la ventana de gracia
  // del detector en el teléfono.
  const finalizandoRef = useRef(false);
  const [crucesTanda, setCrucesTanda] = useState(0); // cruces del líder (display en Dirección)
  useEffect(() => {
    if (!autenticado || !tandaActiva || tandaActiva.fin) { setCrucesTanda(0); return; }
    const t = tandaActiva;
    const revisar = async () => {
      if (finalizandoRef.current) return;
      let terminar = false;
      const inicioMs = new Date(t.inicio).getTime();
      // "Libre" corre sin reglas de término; el resto por tiempo/vueltas
      if (t.tipo !== "libre" && t.duracion_min && Date.now() >= inicioMs + t.duracion_min * 60000) terminar = true;
      try {
        const { data } = await supabase
          .from("vueltas")
          .select("numero")
          .eq("tanda_id", t.id)
          .order("numero", { ascending: false })
          .limit(1);
        const maxCruces = (data?.[0] as any)?.numero || 0;
        setCrucesTanda(maxCruces);
        if (!terminar && t.tipo === "carrera" && t.vueltas_programadas && maxCruces - 1 >= t.vueltas_programadas) {
          terminar = true;
        }
      } catch { /* vueltas sin migrar */ }
      if (terminar) {
        finalizandoRef.current = true;
        try { await finalizarTanda(); } finally { finalizandoRef.current = false; }
      }
    };
    revisar();
    const id = setInterval(revisar, 5_000);
    return () => clearInterval(id);
  }, [autenticado, tandaActiva, finalizarTanda]);

  // ── Log de acciones de pista ──────────────────────────────────────────────
  interface LogRow { id: string; tipo: string; descripcion: string; creado_at: string; }
  const [logAcciones, setLogAcciones] = useState<LogRow[]>([]);

  const cargarLog = useCallback(async (fechaId: string) => {
    let q = supabase
      .from("log_acciones")
      .select("id, tipo, descripcion, creado_at")
      .eq("fecha_id", fechaId)
      .order("creado_at", { ascending: false })
      .limit(80);
    if (tandaSel !== "todas") q = q.eq("tanda_id", tandaSel);
    const { data, error } = await q;
    if (!error && data) setLogAcciones(data as LogRow[]);
  }, [tandaSel]);

  // Log en vivo: Realtime filtrado por el evento + polling de respaldo
  useEffect(() => {
    if (!autenticado || !contexto.fechaId) { setLogAcciones([]); setTandaActivaLog(null); return; }
    const fid = contexto.fechaId;
    cargarLog(fid);
    cargarTandas(fid);
    const ch = supabase
      .channel("admin-log-live")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "log_acciones", filter: `fecha_id=eq.${fid}` },
        () => { cargarLog(fid); })
      .subscribe();
    const poll = setInterval(() => cargarLog(fid), 15_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); setTandaActivaLog(null); };
  }, [autenticado, contexto.fechaId, cargarLog, cargarTandas]);

  // Descarga el log como CSV (abre en Excel): toda la fecha o solo la tanda seleccionada
  const descargarLog = useCallback(async () => {
    if (!contexto.fechaId) return;
    let q = supabase
      .from("log_acciones")
      .select("tipo, descripcion, creado_at")
      .eq("fecha_id", contexto.fechaId)
      .order("creado_at", { ascending: true });
    if (tandaSel !== "todas") q = q.eq("tanda_id", tandaSel);
    const { data } = await q;
    const rows = data || [];
    if (!rows.length) return;
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = "﻿" + ["Fecha;Hora;Tipo;Acción"]
      .concat(rows.map((r: any) => {
        const d = new Date(r.creado_at);
        return [
          d.toLocaleDateString("es-CL"),
          d.toLocaleTimeString("es-CL"),
          r.tipo,
          r.descripcion,
        ].map(esc).join(";");
      }))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    const sufijo = tandaSel !== "todas"
      ? `-${(tandasFecha.find(t => t.id === tandaSel)?.nombre || "tanda").replace(/\s+/g, "-")}`
      : "";
    a.download = `log-${(contexto.fechaNombre || "evento").replace(/\s+/g, "-")}${sufijo}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [contexto.fechaId, contexto.fechaNombre, tandaSel, tandasFecha]);

  // ── Resumen de experiencia del piloto (clic en el nombre) ────────────────
  interface ResumenPiloto {
    pilotoId: string; nombre: string; numero: string | null; cargando: boolean;
    eventos: number; minutos: number; km: number; velMax: number;
    xp: number; nivel: number;
    porAuto: Array<{ nombre: string; km: number; minutos: number; activo: boolean }>;
  }
  const [resumenPiloto, setResumenPiloto] = useState<ResumenPiloto | null>(null);
  const [editNumero, setEditNumero]       = useState(false);
  const [valorNumero, setValorNumero]     = useState("");

  // Guardar número de competición (hasta 3 caracteres; vacío = volver a iniciales)
  const guardarNumeroPiloto = async () => {
    if (!resumenPiloto?.pilotoId) return;
    const limpio = valorNumero.trim().slice(0, 3);
    await supabase.from("pilotos").update({ numero: limpio || null }).eq("id", resumenPiloto.pilotoId);
    setResumenPiloto(prev => prev ? { ...prev, numero: limpio || null } : prev);
    setEditNumero(false);
    if (contexto.fechaId) cargarPilotosEvento(contexto.fechaId, true);
    cargarSesiones();
  };

  const abrirResumenPiloto = useCallback(async (pilotoId: string, nombre: string) => {
    setEditNumero(false);
    setResumenPiloto({ pilotoId, nombre, numero: null, cargando: true, eventos: 0, minutos: 0, km: 0, velMax: 0, xp: 0, nivel: 1, porAuto: [] });
    try {
      const [histQ, inscQ, vehQ, pilQ] = await Promise.all([
        supabase.from("historial_pista").select("vehiculo_id, minutos, km, vel_max").eq("piloto_id", pilotoId),
        supabase.from("inscripciones").select("id", { count: "exact", head: true }).eq("piloto_id", pilotoId).in("estado", ["en_pista", "finalizado"]),
        supabase.from("vehiculos").select("id, marca, modelo").eq("piloto_id", pilotoId),
        supabase.from("pilotos").select("vehiculo_activo_id, numero").eq("id", pilotoId).maybeSingle(),
      ]);
      // Compatibilidad: si numero aún no está migrado, reintenta sin la columna
      let pilData: any = pilQ.data;
      if (pilQ.error) {
        const r = await supabase.from("pilotos").select("vehiculo_activo_id").eq("id", pilotoId).maybeSingle();
        pilData = r.data;
      }
      const rows     = histQ.data || [];
      const vehs     = (vehQ.data || []) as Array<{ id: string; marca: string; modelo: string }>;
      const activoId = pilData?.vehiculo_activo_id ?? null;
      const numero   = pilData?.numero ?? null;

      let minutos = 0, km = 0, velMax = 0;
      const mapa = new Map<string | null, { km: number; minutos: number }>();
      for (const r of rows as any[]) {
        minutos += r.minutos || 0;
        km      += Number(r.km) || 0;
        velMax   = Math.max(velMax, r.vel_max || 0);
        const k = r.vehiculo_id ?? null;
        const acc = mapa.get(k) || { km: 0, minutos: 0 };
        acc.km += Number(r.km) || 0; acc.minutos += r.minutos || 0;
        mapa.set(k, acc);
      }
      const eventos = inscQ.count || 0;
      // Misma fórmula que ve el piloto en su app
      const xp    = Math.round(eventos * 100 + minutos + km);
      const nivel = Math.max(1, Math.floor(xp / 500));
      const nombreVeh = (id: string | null) => {
        if (id === null) return "Sin auto asignado";
        const v = vehs.find(x => x.id === id);
        return v ? `${v.marca} ${v.modelo}` : "Auto eliminado";
      };
      setResumenPiloto({
        pilotoId, nombre, numero, cargando: false, eventos, minutos,
        km: Math.round(km * 10) / 10, velMax, xp, nivel,
        porAuto: Array.from(mapa.entries()).map(([id, v]) => ({
          nombre: nombreVeh(id), km: Math.round(v.km * 10) / 10, minutos: v.minutos, activo: id !== null && id === activoId,
        })),
      });
    } catch {
      setResumenPiloto(prev => prev ? { ...prev, cargando: false } : null);
    }
  }, []);

  // ── Bandera personal por piloto (menú en "Pilotos en sesión") ────────────
  const [menuBanderaPiloto, setMenuBanderaPiloto] = useState<string | null>(null); // sesion.id abierta

  const toggleBanderaPiloto = useCallback(async (sesionId: string, bandera: string, actual: string | null, nombrePiloto: string, pilotoId: string) => {
    // Toggle: clic en la activa la quita; el piloto la ve/deja de ver al instante
    const nueva = actual === bandera ? null : bandera;
    await supabase.from("sesiones").update({ bandera_piloto: nueva }).eq("id", sesionId);
    cargarSesiones();
    registrarLog({
      fecha_id: contexto.fechaId,
      piloto_id: pilotoId,
      tipo: "bandera_piloto",
      descripcion: nueva
        ? `Bandera personal ${NOMBRE_BANDERA[nueva] || nueva} → ${nombrePiloto}`
        : `Se quitó la bandera personal de ${nombrePiloto}`,
    });
  }, [cargarSesiones, contexto.fechaId]);

  // ── Fechas que se corren HOY (se muestran en la portada) ─────────────────
  const [fechasHoy, setFechasHoy] = useState<Array<{
    id: string; nombre: string; tipo: string | null;
    campeonatoId: string; campeonatoNombre: string;
  }>>([]);

  useEffect(() => {
    if (!autenticado) return;
    const cargar = async () => {
      const hoy = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0];
      const { data } = await supabase
        .from("fechas_evento")
        .select("id, nombre, tipo, campeonato_id, campeonatos(nombre)")
        .eq("fecha_evento", hoy)
        .in("estado", ["borrador", "abierto"]);
      setFechasHoy((data || []).map((f: any) => ({
        id: f.id,
        nombre: f.nombre,
        tipo: f.tipo ?? null,
        campeonatoId: f.campeonato_id,
        campeonatoNombre: f.campeonatos?.nombre || "",
      })));
    };
    cargar();
  }, [autenticado, tab, contexto.fechaId]); // se refresca al volver a la portada

  // ── Navegación rápida: migas del header + "Operar esta fecha" ────────────
  const irAlInicioEventos = useCallback(() => {
    setContexto({ campeonatoId: null, campeonatoNombre: "", fechaId: null, fechaNombre: "", tipo: null });
    setFechasOpt([]);
    setCircuitoIdActivo(null);
    setTab("eventos");
  }, []);

  // Portada del panel: lo que se ve al abrir la página por primera vez
  // (contexto limpio, pantalla "Sin evento activo" con acceso a Eventos)
  const irAlHome = useCallback(() => {
    setContexto({ campeonatoId: null, campeonatoNombre: "", fechaId: null, fechaNombre: "", tipo: null });
    setFechasOpt([]);
    setCircuitoIdActivo(null);
    setTab("direccion");
  }, []);

  const volverAlCampeonato = useCallback(() => {
    setContexto(prev => ({ ...prev, fechaId: null, fechaNombre: "", tipo: null }));
    setCircuitoIdActivo(null);
    setTab("eventos");
  }, []);

  // Entra directo a operar una fecha desde la lista de Eventos
  const operarFecha = useCallback((campeonato: { id: string; nombre: string }, fecha: { id: string; nombre: string; tipo: string | null }) => {
    const tipo = (fecha.tipo || null) as Contexto["tipo"];
    setContexto({
      campeonatoId:     campeonato.id,
      campeonatoNombre: campeonato.nombre,
      fechaId:          fecha.id,
      fechaNombre:      fecha.nombre,
      tipo,
    });
    cargarFechasDeContexto(campeonato.id); // rellena el selector de fechas del header
    cargarPilotosEvento(fecha.id);
    setCircuitoIdActivo(null);
    resolverCircuitoDeFecha(fecha.id).then(setCircuitoIdActivo);
    const tabsDisp = TABS_POR_TIPO[tipo || "sin_contexto"] || TABS_POR_TIPO.sin_contexto;
    setTab(tabsDisp[0].id);
  }, [cargarFechasDeContexto, cargarPilotosEvento, resolverCircuitoDeFecha]);

  // ── Sesiones visibles según el evento activo ─────────────────────────────
  // Con una fecha seleccionada, las listas muestran solo pilotos inscritos en
  // ella (una fecha nueva parte limpia).
  const sesionesVisibles = contexto.fechaId
    ? sesiones.filter(s => pilotosEvento.some(p => p.piloto_id === s.piloto_id))
    : sesiones;

  // Capacidad de pista = autos EFECTIVAMENTE en pista según GPS.
  // Boxes y sin señal no ocupan cupo en el display (la validación del QR
  // en auth.ts sigue contando sesiones activas, que es el límite formal).
  void gpsTick;
  const autosEnPista = sesionesVisibles.filter(s => estadoGpsPiloto(s.piloto_id).label === "En pista").length;

  // ── Inscripciones en vivo del evento activo ──────────────────────────────
  // Cuando un piloto se inscribe desde su app, la solicitud aparece sola en la
  // pestaña Pilotos: Realtime filtrado por fecha + polling de respaldo cada 10 s
  // (por si inscripciones no está en la publicación supabase_realtime).
  useEffect(() => {
    if (!autenticado || !contexto.fechaId) return;
    const fid = contexto.fechaId;

    const ch = supabase
      .channel("admin-inscripciones-live")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "inscripciones", filter: `fecha_id=eq.${fid}` },
        () => { cargarPilotosEvento(fid, true); })
      .subscribe();

    const poll = setInterval(() => cargarPilotosEvento(fid, true), 10_000);

    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [autenticado, contexto.fechaId, cargarPilotosEvento]);

  // Callback: cuando CircuitoManager activa un circuito, vincularlo al evento activo
  const handleCircuitoActivado = useCallback(async (circuitoId: string) => {
    setCircuitoIdActivo(circuitoId);
    const fechaId = contexto.fechaId;
    if (fechaId) {
      // localStorage como respaldo legado
      const porFecha: Record<string, string> = JSON.parse(localStorage.getItem("circuitosByFecha") || "{}");
      porFecha[fechaId] = circuitoId;
      localStorage.setItem("circuitosByFecha", JSON.stringify(porFecha));
      // Fuente de verdad en DB: la app del piloto lee de aquí qué pista mostrar
      await supabase.from("fechas_evento").update({ circuito_id: circuitoId }).eq("id", fechaId);
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
    const nombreSector = sectores.find(s => s.id === id)?.nombre || "Sector";
    registrarLog({
      fecha_id: contexto.fechaId,
      tipo: "bandera_sector",
      descripcion: `${nombreSector}: bandera ${NOMBRE_BANDERA[nuevaBandera] || nuevaBandera} (director)`,
    });
  }, [sectores, contexto.fechaId]);

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
      } else {
        registrarLog({
          fecha_id: contexto.fechaId,
          tipo: "bandera_global",
          descripcion: `Bandera global: ${NOMBRE_BANDERA[nuevaBandera] || nuevaBandera}`,
        });
      }
    } finally {
      setCargandoBandera(false);
    }
  }, [cargarBandera, contexto.fechaId]);

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

            // ── Log de entradas/salidas de pista ──
            const anterior = gpsStateRef.current.get(u.piloto_id);
            const nombre   = nombresSesionRef.current.get(u.piloto_id);
            const fid      = fechaIdRef.current;
            if (nombre && fid) {
              const estabaOffline = !anterior || (Date.now() - anterior.ts) > 20_000;
              const veniaEnPista  = anterior?.dentro_geocerca === true;
              if (u.dentro_geocerca === true && estabaOffline && veniaEnPista) {
                registrarLog({ fecha_id: fid, piloto_id: u.piloto_id, tipo: "pista", descripcion: `📶 ${nombre} recuperó señal en pista` });
              } else if (u.dentro_geocerca === true && !veniaEnPista) {
                registrarLog({ fecha_id: fid, piloto_id: u.piloto_id, tipo: "pista", descripcion: `🟢 ${nombre} entró a pista` });
              } else if (veniaEnPista && u.dentro_geocerca === false) {
                registrarLog({ fecha_id: fid, piloto_id: u.piloto_id, tipo: "pista", descripcion: `⬅️ ${nombre} salió de pista — en boxes` });
              }
            }
            offlineAvisadoRef.current.delete(u.piloto_id);

            setPilotoGpsState(prev => {
              const next = new Map(prev);
              next.set(u.piloto_id, {
                dentro_geocerca: u.dentro_geocerca,
                dentro_recinto:  u.dentro_recinto ?? null,
                ts: Date.now(),
              });
              return next;
            });
          })
      .subscribe((status) => { setRealtimeConectado(status === "SUBSCRIBED"); });

    // Ticker para re-calcular estado offline en el panel derecho cada 5 s
    // + registrar UNA VEZ la pérdida de señal de pilotos que estaban en pista
    const tickId = setInterval(() => {
      setGpsTick(t => t + 1);
      const ahora = Date.now();
      const fid = fechaIdRef.current;
      if (!fid) return;
      for (const [pid, st] of gpsStateRef.current) {
        if (st.dentro_geocerca === true && ahora - st.ts > 20_000 && !offlineAvisadoRef.current.has(pid)) {
          offlineAvisadoRef.current.add(pid);
          const nombre = nombresSesionRef.current.get(pid);
          if (nombre) {
            registrarLog({ fecha_id: fid, piloto_id: pid, tipo: "pista", descripcion: `📵 ${nombre} perdió señal — última posición: en pista` });
          }
        }
      }
    }, 5_000);

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
      registrarLog({
        fecha_id: contexto.fechaId,
        piloto_id: validacion.piloto.id,
        tipo: "ingreso",
        descripcion: `${validacion.piloto.nombre} — QR validado, ingreso a pista autorizado`,
      });
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
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo + título: clic vuelve a la portada del panel */}
            <button
              onClick={irAlHome}
              title="Volver al inicio"
              className="flex items-center gap-3 flex-shrink-0 text-left hover:opacity-80 transition-opacity"
            >
              <span className="text-xl">🏁</span>
              <div>
                <div className="font-bold text-sm leading-none">Panel Maestro</div>
                <div className="text-xs text-gray-400 leading-none mt-0.5">Race Control</div>
              </div>
            </button>

            {/* Migas de navegación: Eventos › campeonato › fecha */}
            <div className="flex items-center gap-1.5 ml-3 text-xs min-w-0">
              <button
                onClick={irAlInicioEventos}
                title="Volver a la lista de eventos"
                className="flex-shrink-0 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors"
              >
                🏠 Eventos
              </button>
              {contexto.campeonatoNombre && (
                <>
                  <span className="text-gray-600 flex-shrink-0">›</span>
                  <button
                    onClick={volverAlCampeonato}
                    title="Ver fechas de este campeonato"
                    className="text-gray-300 hover:text-white transition-colors truncate max-w-[150px]"
                  >
                    {contexto.campeonatoNombre}
                  </button>
                </>
              )}
              {contexto.fechaNombre && (
                <>
                  <span className="text-gray-600 flex-shrink-0">›</span>
                  <button
                    onClick={() => {
                      const tabsDisp = TABS_POR_TIPO[contexto.tipo || "sin_contexto"];
                      setTab(tabsDisp[0].id);
                    }}
                    title="Operar esta fecha"
                    className="text-white font-semibold hover:text-indigo-300 transition-colors truncate max-w-[150px]"
                  >
                    {contexto.fechaNombre}
                  </button>
                </>
              )}
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
              Selecciona un campeonato y una fecha en el selector de arriba,<br />
              o crea uno nuevo desde la pestaña Eventos.
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
          fechasHoy.length > 0 ? (
            /* Fechas que se corren hoy: un clic y a operar */
            <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
              <div className="px-6 pt-8 pb-4 text-center">
                <p className="text-4xl mb-3">🏁</p>
                <p className="text-base font-bold text-gray-800">Fechas de hoy</p>
                <p className="text-sm text-gray-400 mt-1">Selecciona una para entrar a operarla</p>
              </div>
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {fechasHoy.map(f => (
                  <button
                    key={f.id}
                    onClick={() => operarFecha(
                      { id: f.campeonatoId, nombre: f.campeonatoNombre },
                      { id: f.id, nombre: f.nombre, tipo: f.tipo },
                    )}
                    className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{f.nombre}</p>
                      <p className="text-xs text-gray-400 truncate">{f.campeonatoNombre}</p>
                    </div>
                    {f.tipo && TIPO_LABEL[f.tipo as keyof typeof TIPO_LABEL] && (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${TIPO_COLOR[f.tipo as keyof typeof TIPO_COLOR]}`}>
                        {TIPO_LABEL[f.tipo as keyof typeof TIPO_LABEL]}
                      </span>
                    )}
                    <span className="text-xs bg-gray-900 text-white font-bold px-3 py-1.5 rounded-lg flex-shrink-0">
                      Operar →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-gray-50 border border-gray-200 px-6 py-14 text-center">
              <p className="text-4xl mb-4">🏁</p>
              <p className="text-base font-bold text-gray-800">Sin fecha activa hoy</p>
              <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
                No hay fechas programadas para hoy. Selecciona un campeonato y una fecha
                arriba, o crea una nueva en Eventos.
              </p>
            </div>
          )
        )}

        {/* ── CRONOMETRAJE ────────────────────────────────────────────── */}
        {tab === "crono" && !!contexto.fechaId && (
          <Cronometraje
            fechaId={contexto.fechaId}
            tandaSeleccionada={tandaSel === "todas" ? null : tandaSel}
            onSeleccionarTanda={(id) => setTandaSel(id)}
            tandaActivaId={tandaActiva?.id ?? null}
            onIniciarTanda={iniciarTanda}
            onFinalizarTanda={finalizarTanda}
          />
        )}
        {tab === "crono" && !contexto.fechaId && (
          <div className="rounded-2xl bg-gray-50 border border-gray-200 px-6 py-14 text-center">
            <p className="text-4xl mb-4">⏱</p>
            <p className="text-base font-bold text-gray-800">Sin fecha activa</p>
            <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">
              Selecciona un campeonato y una fecha para ver el cronometraje.
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

            {/* ── Tanda en curso: tipo + tiempo/vueltas ── */}
            {tandaActiva && !tandaActiva.fin && (
              <TandaStatusCard tanda={tandaActiva} cruces={crucesTanda} />
            )}

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
                      {autosEnPista} de {maxPilotos} autos en pista
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
            {circuitoIdActivo === null ? (
              <div className="bg-white rounded-2xl border border-gray-200 px-5 py-6 text-center">
                <p className="text-sm text-gray-400">Sin circuito asignado a este evento</p>
                <p className="text-xs text-gray-400 mt-1">Actívale uno en Config → Biblioteca de circuitos</p>
              </div>
            ) : sectores.length > 0 && (
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
                    // Solo roja y amarilla global dominan los sectores.
                    // Con Safety Car o cuadros el director MANTIENE el control
                    // por sector (ej. dejar amarilla de advertencia activa).
                    const isGlobalOverride = bandera === "roja" || bandera === "amarilla";
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
                            <button
                              onClick={() => setSectorBandera(s.id, "rayas")}
                              disabled={s.bandera === "rayas"}
                              title="Superficie deslizante (rayas amarillo/rojo)"
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                s.bandera === "rayas"
                                  ? "border-red-600"
                                  : "bg-white border-gray-200 hover:border-red-400"
                              }`}
                              style={s.bandera === "rayas"
                                ? { background: "repeating-linear-gradient(45deg, #eab308 0 5px, #ef4444 5px 10px)" }
                                : undefined}
                            >
                              <span
                                className="inline-block rounded-sm"
                                style={{
                                  width: 14, height: 14, verticalAlign: "-3px",
                                  background: "repeating-linear-gradient(45deg, #eab308 0 4px, #ef4444 4px 8px)",
                                  border: s.bandera === "rayas" ? "1.5px solid #fff" : "none",
                                }}
                              />
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
                <span className="text-sm font-bold text-gray-900">{autosEnPista} / {maxPilotos}</span>
              </div>
              <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    autosEnPista / maxPilotos >= 0.9 ? "bg-red-500"
                    : autosEnPista / maxPilotos >= 0.7 ? "bg-amber-400"
                    : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(100, (autosEnPista / maxPilotos) * 100)}%` }}
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
              {sesionesVisibles.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">
                  Ningún piloto activo en este momento
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {sesionesVisibles.map(s => {
                    const nombre = s.piloto?.nombre || s.piloto_id.slice(0, 8);
                    const iniciales = nombre.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();
                    const colors = ["bg-indigo-500", "bg-teal-500", "bg-orange-500", "bg-pink-500", "bg-purple-500"];
                    const color = colors[nombre.charCodeAt(0) % colors.length];

                    // Estado GPS del piloto — mismo helper en todas las vistas
                    void gpsTick; // referencia para que React re-calcule cuando cambia el tick
                    const estadoBadge = estadoGpsPiloto(s.piloto_id);

                    const menuAbierto = menuBanderaPiloto === s.id;
                    const banderaActual = s.bandera_piloto ?? null;
                    const banderaInfo = BANDERAS_PILOTO.find(b => b.value === banderaActual);
                    const banderasDisp = BANDERAS_PILOTO.filter(b => b.tipos.includes(contexto.tipo || "racing"));

                    return (
                      <div key={s.id} className="px-5 py-3.5">
                        <div className="flex items-center gap-4">
                          <div className={`w-9 h-9 rounded-full ${color} text-white font-bold flex items-center justify-center flex-shrink-0 ${(s.piloto?.numero || iniciales).length > 2 ? "text-xs" : "text-sm"}`}>
                            {s.piloto?.numero || iniciales}
                          </div>
                          {/* Nombre clicable → menú de bandera personal */}
                          <button
                            onClick={() => setMenuBanderaPiloto(prev => prev === s.id ? null : s.id)}
                            title="Bandera personal para este piloto"
                            className="flex-1 min-w-0 text-left"
                          >
                            <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                              {nombre}
                              {banderaInfo && <span className="flex-shrink-0">{banderaInfo.emoji}</span>}
                              <span className="text-gray-300 text-[10px] flex-shrink-0">{menuAbierto ? "▲" : "▼"}</span>
                            </p>
                            <p className="text-xs text-gray-400">
                              {new Date(s.inicio).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </button>
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${estadoBadge.cls}`}>
                            {estadoBadge.label}
                          </span>
                          <button
                            onClick={async () => {
                              if (!confirm(`¿Retirar a ${nombre} de pista?`)) return;
                              await cerrarSesionAdmin(s.piloto_id);
                              registrarLog({
                                fecha_id: contexto.fechaId,
                                piloto_id: s.piloto_id,
                                tipo: "retiro",
                                descripcion: `${nombre} retirado de pista por el administrador`,
                              });
                              cargarSesiones();
                            }}
                            className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-2.5 py-1 rounded-lg transition-colors"
                            title="Cerrar sesión del piloto"
                          >
                            ✕ Retirar
                          </button>
                        </div>

                        {/* Menú de bandera personal: solo la ve este piloto en su app */}
                        {menuAbierto && (
                          <div className="mt-2.5 pl-13" style={{ paddingLeft: 52 }}>
                            <p className="text-xs text-gray-400 mb-1.5">
                              Bandera personal — solo la ve {nombre.split(" ")[0]}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {banderasDisp.map(b => (
                                <button
                                  key={b.value}
                                  onClick={() => toggleBanderaPiloto(s.id, b.value, banderaActual, nombre, s.piloto_id)}
                                  title={banderaActual === b.value ? "Quitar bandera" : b.label}
                                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
                                    banderaActual === b.value
                                      ? b.activeCls
                                      : "border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300"
                                  }`}
                                >
                                  {b.emoji} {b.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-shrink-0">Log de acciones</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  {tandasFecha.length > 0 && (
                    <select
                      value={tandaSel}
                      onChange={e => setTandaSel(e.target.value)}
                      title="Ver toda la fecha o solo una tanda"
                      className="text-xs border border-gray-200 text-gray-600 rounded-lg px-1.5 py-1 focus:outline-none max-w-[130px] truncate"
                    >
                      <option value="todas">Toda la fecha</option>
                      {tandasFecha.map(t => (
                        <option key={t.id} value={t.id}>{t.nombre}{!t.fin ? " · en curso" : ""}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={descargarLog}
                    disabled={logAcciones.length === 0}
                    title="Descargar CSV de lo seleccionado (se abre en Excel)"
                    className="text-xs border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg transition-colors font-medium flex-shrink-0"
                  >
                    ⬇ CSV
                  </button>
                </div>
              </div>

              <div className="divide-y divide-gray-50 max-h-[340px] overflow-y-auto">
                {logAcciones.map(l => (
                  <div key={l.id} className="px-5 py-2.5 flex items-start gap-3">
                    <span className="text-xs text-gray-400 w-16 flex-shrink-0 tabular-nums pt-0.5">
                      {new Date(l.creado_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="text-sm text-gray-600 leading-snug">{l.descripcion}</span>
                  </div>
                ))}
                {logAcciones.length === 0 && (
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
                      Selecciona un evento para ver los pilotos disponibles.
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
                                <button onClick={() => abrirResumenPiloto(p.piloto_id, p.nombre)} title="Ver experiencia del piloto" className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2 transition text-left block max-w-full">{p.nombre}</button>
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
                Selecciona un campeonato y una fecha arriba para ver los pilotos del evento.
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
          // "En pista" = estado GPS real (mismo criterio que los badges),
          // no solo tener una sesión abierta: una sesión zombie sin señal
          // o un piloto en el recinto NO cuentan como en pista
          void gpsTick;
          const enPistaArr = pilotosEvento.filter(p =>
            sesiones.some(s => s.piloto_id === p.piloto_id) &&
            estadoGpsPiloto(p.piloto_id).label === "En pista"
          );
          const rechazados   = pilotosEvento.filter(p => p.estado_insc === "rechazado");

          const totalPendientes = porAprobar.length + porPago.length + porHabilitar.length;

          const Avatar = ({ nombre, numero }: { nombre: string; numero?: string | null }) => {
            // Número de competición si existe; iniciales como respaldo
            const texto = numero || nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
            const colors = ["bg-indigo-500","bg-teal-500","bg-orange-500","bg-pink-500","bg-purple-500"];
            const color = colors[nombre.charCodeAt(0) % colors.length];
            return (
              <div className={`w-9 h-9 rounded-full ${color} text-white font-bold flex items-center justify-center flex-shrink-0 ${String(texto).length > 2 ? "text-xs" : "text-sm"}`}>
                {texto}
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
                        <Avatar nombre={p.nombre} numero={p.numero} />
                        <div className="flex-1 min-w-0">
                          <button onClick={() => abrirResumenPiloto(p.piloto_id, p.nombre)} title="Ver experiencia del piloto" className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2 transition text-left block max-w-full">{p.nombre}</button>
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
                        <Avatar nombre={p.nombre} numero={p.numero} />
                        <div className="flex-1 min-w-0">
                          <button onClick={() => abrirResumenPiloto(p.piloto_id, p.nombre)} title="Ver experiencia del piloto" className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2 transition text-left block max-w-full">{p.nombre}</button>
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
                        <Avatar nombre={p.nombre} numero={p.numero} />
                        <div className="flex-1 min-w-0">
                          <button onClick={() => abrirResumenPiloto(p.piloto_id, p.nombre)} title="Ver experiencia del piloto" className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2 transition text-left block max-w-full">{p.nombre}</button>
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
                          <Avatar nombre={p.nombre} numero={p.numero} />
                          <div className="flex-1 min-w-0">
                            <button onClick={() => abrirResumenPiloto(p.piloto_id, p.nombre)} title="Ver experiencia del piloto" className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2 transition text-left block max-w-full">{p.nombre}</button>
                            <p className="text-xs text-gray-400">{p.rut}{p.telefono ? ` · ${p.telefono}` : ""}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {enPista ? (() => {
                              // Con sesión activa: mostrar el estado GPS real,
                              // el mismo que ve el piloto en su app
                              void gpsTick;
                              const b = estadoGpsPiloto(p.piloto_id);
                              return (
                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${b.cls}`}>
                                  {b.label}
                                </span>
                              );
                            })() : (
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
            onOperarFecha={operarFecha}
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
              circuitoAsignadoId={contexto.fechaId ? circuitoIdActivo : undefined}
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

      {/* ── MODAL: EXPERIENCIA DEL PILOTO ─────────────────────────── */}
      {resumenPiloto && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
          style={{ zIndex: 200 }}
          onClick={() => setResumenPiloto(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
              {/* Círculo editable: número de competición (hasta 3 caracteres) */}
              {editNumero ? (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <input
                    autoFocus
                    value={valorNumero}
                    maxLength={3}
                    onChange={e => setValorNumero(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && guardarNumeroPiloto()}
                    placeholder="N°"
                    className="w-14 h-10 rounded-xl border-2 border-indigo-400 text-center font-bold text-sm text-gray-900 focus:outline-none"
                  />
                  <button onClick={guardarNumeroPiloto}
                    className="text-xs bg-indigo-600 text-white font-bold px-2.5 py-2 rounded-lg hover:bg-indigo-700 transition">
                    OK
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setValorNumero(resumenPiloto.numero || ""); setEditNumero(true); }}
                  title="Editar número de competición (vacío = iniciales)"
                  className={`w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold flex-shrink-0 hover:bg-indigo-700 hover:ring-2 hover:ring-indigo-300 transition ${
                    (resumenPiloto.numero || "").length > 2 ? "text-xs" : "text-sm"
                  }`}
                >
                  {resumenPiloto.numero || resumenPiloto.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                </button>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{resumenPiloto.nombre}</p>
                <p className="text-xs text-gray-400">Experiencia del piloto · toca el círculo para editar su número</p>
              </div>
              <button onClick={() => setResumenPiloto(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Cerrar">✕</button>
            </div>

            {resumenPiloto.cargando ? (
              <div className="py-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* XP + nivel */}
                <div className="border border-gray-200 rounded-2xl px-4 py-3.5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-gray-900">⭐ Experiencia total</p>
                    <p className="text-sm text-gray-500">
                      <span className="font-bold text-gray-900 tabular-nums">{resumenPiloto.xp.toLocaleString("es-CL")}</span> XP · Nivel {resumenPiloto.nivel}
                    </p>
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${Math.min(100, Math.round(((resumenPiloto.xp - resumenPiloto.nivel * 500 + 500) / 500) * 100))}%` }}
                    />
                  </div>
                </div>

                {/* Métricas */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    [String(resumenPiloto.eventos), "eventos"],
                    [String(resumenPiloto.minutos), "min en pista"],
                    [String(resumenPiloto.km), "km recorridos"],
                    [String(resumenPiloto.velMax), "vel. máx (km/h)"],
                  ].map(([v, l]) => (
                    <div key={l} className="bg-gray-50 rounded-xl px-3 py-3 text-center">
                      <p className="text-2xl font-black text-gray-900 tabular-nums leading-none">{v}</p>
                      <p className="text-xs text-gray-400 mt-1">{l}</p>
                    </div>
                  ))}
                </div>

                {/* Historial por auto */}
                {resumenPiloto.porAuto.length > 0 ? (
                  <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100">
                    {resumenPiloto.porAuto.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-sm flex-shrink-0">🚗</span>
                        <span className="flex-1 text-xs font-medium text-gray-700 truncate">
                          {r.nombre}
                          {r.activo && <span className="text-indigo-600 font-semibold"> · activo</span>}
                        </span>
                        <span className="text-xs text-gray-500 tabular-nums">{r.km} km</span>
                        <span className="text-xs text-gray-500 tabular-nums w-14 text-right">{r.minutos} min</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-2">
                    Sin tandas registradas aún — el historial se acumula al cerrar cada sesión de pista.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

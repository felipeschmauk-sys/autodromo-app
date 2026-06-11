"use client";

/**
 * DireccionCarrera.tsx — components/DireccionCarrera.tsx
 *
 * Panel de control de pista:
 *  · Mapa Leaflet con posición en tiempo real de pilotos
 *  · Banderas globales (según tipo de sesión: racing / track_day / entrenamiento)
 *  · Banderas por sector (verde / amarilla / rayas)
 *  · Banderas personales por piloto (inline, toggle)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { getTrazadoActivo, type Coordenada } from "@/lib/gps";

const LeafletAdminMap = dynamic(() => import("@/components/LeafletAdminMap"), { ssr: false });

// ── Tipos ──────────────────────────────────────────────────────────────────────

interface SectorInfo {
  id: string;
  nombre: string;
  orden: number;
  punto_inicio: number;
  punto_fin: number;
  bandera: string;
}

interface PilotoEnPista {
  piloto_id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  velocidad: number;
  dentro_geocerca: boolean | null;
  ultima_actualizacion: Date | null;
  color: string;
  bandera_piloto: string | null;
}

type SessionType = "racing" | "track_day" | "entrenamiento";

// ── Config de banderas por tipo de sesión ──────────────────────────────────────

interface GlobalFlagDef {
  value: string;
  label: string;
  shortLabel: string;
  bg: string;
  activeBg: string;
  border: string;
  activeBorder: string;
  textColor: string;
  pulse?: boolean;
  pattern?: "cuadros";
}

const FLAG_GLOBAL: Record<SessionType, GlobalFlagDef[]> = {
  racing: [
    {
      value: "verde", label: "Pista libre", shortLabel: "VERDE",
      bg: "bg-gray-900", activeBg: "bg-green-950",
      border: "border-gray-700", activeBorder: "border-green-500",
      textColor: "text-green-400",
    },
    {
      value: "roja", label: "Bandera roja", shortLabel: "ROJA",
      bg: "bg-gray-900", activeBg: "bg-red-950",
      border: "border-gray-700", activeBorder: "border-red-500",
      textColor: "text-red-400", pulse: true,
    },
    {
      value: "safety_car", label: "Safety Car", shortLabel: "SC",
      bg: "bg-gray-900", activeBg: "bg-orange-950",
      border: "border-gray-700", activeBorder: "border-orange-500",
      textColor: "text-orange-400",
    },
    {
      value: "cuadros", label: "Cuadros", shortLabel: "FIN",
      bg: "bg-gray-900", activeBg: "bg-gray-700",
      border: "border-gray-700", activeBorder: "border-white",
      textColor: "text-white", pattern: "cuadros",
    },
  ],
  track_day: [
    {
      value: "verde", label: "Pista libre", shortLabel: "VERDE",
      bg: "bg-gray-900", activeBg: "bg-green-950",
      border: "border-gray-700", activeBorder: "border-green-500",
      textColor: "text-green-400",
    },
    {
      value: "roja", label: "Bandera roja", shortLabel: "ROJA",
      bg: "bg-gray-900", activeBg: "bg-red-950",
      border: "border-gray-700", activeBorder: "border-red-500",
      textColor: "text-red-400", pulse: true,
    },
    {
      value: "safety_car", label: "Pace Car", shortLabel: "PC",
      bg: "bg-gray-900", activeBg: "bg-orange-950",
      border: "border-gray-700", activeBorder: "border-orange-500",
      textColor: "text-orange-400",
    },
    {
      value: "cuadros", label: "Cuadros", shortLabel: "FIN",
      bg: "bg-gray-900", activeBg: "bg-gray-700",
      border: "border-gray-700", activeBorder: "border-white",
      textColor: "text-white", pattern: "cuadros",
    },
  ],
  entrenamiento: [
    {
      value: "verde", label: "Pista libre", shortLabel: "VERDE",
      bg: "bg-gray-900", activeBg: "bg-green-950",
      border: "border-gray-700", activeBorder: "border-green-500",
      textColor: "text-green-400",
    },
    {
      value: "roja", label: "Bandera roja", shortLabel: "ROJA",
      bg: "bg-gray-900", activeBg: "bg-red-950",
      border: "border-gray-700", activeBorder: "border-red-500",
      textColor: "text-red-400", pulse: true,
    },
    {
      value: "cuadros", label: "Cuadros", shortLabel: "FIN",
      bg: "bg-gray-900", activeBg: "bg-gray-700",
      border: "border-gray-700", activeBorder: "border-white",
      textColor: "text-white", pattern: "cuadros",
    },
  ],
};

interface PilotoFlagDef {
  value: string;
  label: string;
  title: string;
  bg: string;
  activeShadow: string;
}

const FLAG_PILOTO: Record<SessionType, PilotoFlagDef[]> = {
  racing: [
    { value: "azul",         label: "A",  title: "Azul — déjalo pasar",    bg: "#1d4ed8", activeShadow: "0 0 0 2px #3b82f6" },
    { value: "negra_blanco", label: "NB", title: "Negra+blanco — aviso",   bg: "linear-gradient(135deg,#000 50%,#fff 50%)", activeShadow: "0 0 0 2px #9ca3af" },
    { value: "negra",        label: "N",  title: "Negra — exclusión",      bg: "#000",    activeShadow: "0 0 0 2px #6b7280" },
    { value: "taller",       label: "T",  title: "A taller",               bg: "#7c3aed", activeShadow: "0 0 0 2px #a78bfa" },
  ],
  track_day: [
    { value: "azul",  label: "A", title: "Azul — déjalo pasar", bg: "#1d4ed8", activeShadow: "0 0 0 2px #3b82f6" },
    { value: "negra", label: "N", title: "Negra — exclusión",   bg: "#000",    activeShadow: "0 0 0 2px #6b7280" },
    { value: "taller",label: "T", title: "A taller",            bg: "#7c3aed", activeShadow: "0 0 0 2px #a78bfa" },
  ],
  entrenamiento: [
    { value: "taller", label: "T", title: "A taller", bg: "#7c3aed", activeShadow: "0 0 0 2px #a78bfa" },
  ],
};

// ── Helpers de color de bandera global ────────────────────────────────────────

function globalFlagChip(bandera: string) {
  switch (bandera) {
    case "verde":      return { label: "Pista libre", cls: "bg-green-950  text-green-400  border-green-800" };
    case "roja":       return { label: "Roja",        cls: "bg-red-950    text-red-400    border-red-800    animate-pulse" };
    case "safety_car": return { label: "Safety Car",  cls: "bg-orange-950 text-orange-400 border-orange-800 animate-pulse" };
    case "cuadros":    return { label: "Cuadros",     cls: "bg-gray-800   text-white       border-gray-600" };
    default:           return { label: bandera,       cls: "bg-gray-800   text-gray-400   border-gray-700" };
  }
}

const COLORES = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6",
  "#a78bfa", "#fb923c", "#22d3ee", "#4ade80",
];

// ── Componente principal ───────────────────────────────────────────────────────

interface DireccionCarreraProps {
  fechaId?: string | null;
  mapHeight?: number;
}

export default function DireccionCarrera({ fechaId, mapHeight = 320 }: DireccionCarreraProps = {}) {
  const [trazado,     setTrazado]     = useState<Coordenada[]>([]);
  const [pilotos,     setPilotos]     = useState<Map<string, PilotoEnPista>>(new Map());
  const [bandera,     setBandera]     = useState("verde");
  const [sectores,    setSectores]    = useState<SectorInfo[]>([]);
  const [tick,        setTick]        = useState(0);
  const [sessionType, setSessionType] = useState<SessionType>("racing");

  // Refs para evitar closures stale en callbacks de Supabase
  const trazadoRef    = useRef<Coordenada[]>([]);
  const sectoresRef   = useRef<SectorInfo[]>([]);
  const banderaRef    = useRef<string>("verde");
  const autoYellowRef = useRef<Map<string, string>>(new Map());

  useEffect(() => { trazadoRef.current  = trazado;  }, [trazado]);
  useEffect(() => { sectoresRef.current = sectores; }, [sectores]);
  useEffect(() => { banderaRef.current  = bandera;  }, [bandera]);

  // ── Cargar tipo de sesión ──────────────────────────────────────────────────
  useEffect(() => {
    if (!fechaId) return;
    supabase
      .from("fechas_evento")
      .select("tipo")
      .eq("id", fechaId)
      .single()
      .then(({ data }) => {
        if (data?.tipo) setSessionType(data.tipo as SessionType);
      });
  }, [fechaId]);

  // ── Auto-yellow helpers ────────────────────────────────────────────────────
  function findClosestIdx(lat: number, lng: number, tr: Coordenada[]): number {
    let minD = Infinity, closest = 0;
    tr.forEach((c, i) => {
      const d = (lat - c.lat) ** 2 + (lng - c.lng) ** 2;
      if (d < minD) { minD = d; closest = i; }
    });
    return closest;
  }

  function detectSectorByPos(lat: number, lng: number): SectorInfo | null {
    const t = trazadoRef.current;
    const s = sectoresRef.current;
    if (!t.length || !s.length) return null;
    const idx = findClosestIdx(lat, lng, t);
    return s.find(sec => idx >= sec.punto_inicio && idx <= sec.punto_fin) || null;
  }

  async function revertAutoYellow(pilotoId: string) {
    for (const [sectorId, pId] of autoYellowRef.current.entries()) {
      if (pId === pilotoId) {
        autoYellowRef.current.delete(sectorId);
        await supabase.from("sectores_pista").update({ bandera: "verde" }).eq("id", sectorId);
      }
    }
  }

  async function checkAutoYellow(
    pilotoId: string,
    lat: number,
    lng: number,
    velocidad: number,
    dentroGeocerca: boolean | null,
  ) {
    if (banderaRef.current !== "verde") return;
    if (dentroGeocerca !== true) { await revertAutoYellow(pilotoId); return; }

    const stopped = velocidad <= 5;
    if (stopped) {
      const sector = detectSectorByPos(lat, lng);
      if (sector && sector.bandera === "verde" && !autoYellowRef.current.has(sector.id)) {
        autoYellowRef.current.set(sector.id, pilotoId);
        await supabase.from("sectores_pista").update({ bandera: "amarilla" }).eq("id", sector.id);
      }
    } else {
      await revertAutoYellow(pilotoId);
    }
  }

  // ── Cargar circuito ────────────────────────────────────────────────────────
  useEffect(() => {
    getTrazadoActivo().then(c => { if (c) setTrazado(c); });
  }, []);

  // ── Cargar sectores y suscribir cambios ────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("sectores_pista").select("*").order("orden");
      if (data) setSectores(data);
    };
    load();
    const ch = supabase
      .channel("dir-sectores")
      .on("postgres_changes", { event: "*", schema: "public", table: "sectores_pista" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Estado de pista (bandera global) ──────────────────────────────────────
  useEffect(() => {
    supabase
      .from("estado_pista")
      .select("bandera")
      .eq("activo", true)
      .single()
      .then(({ data }) => { if (data) setBandera(data.bandera); });

    const ch = supabase
      .channel("dir-bandera")
      .on("postgres_changes", { event: "*", schema: "public", table: "estado_pista" },
        payload => { const n = payload.new as any; if (n?.bandera) setBandera(n.bandera); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Sesiones activas + ubicaciones en tiempo real ─────────────────────────
  useEffect(() => {
    let colorIdx = 0;

    const loadSessions = async () => {
      let pilotoIds: string[] | null = null;
      if (fechaId) {
        const { data: inscritos } = await supabase
          .from("inscripciones")
          .select("piloto_id")
          .eq("fecha_id", fechaId)
          .in("estado", ["confirmado", "en_pista"]);
        pilotoIds = inscritos?.map((i: any) => i.piloto_id) ?? [];
      }

      let query = supabase
        .from("sesiones")
        .select("piloto_id, bandera_piloto, pilotos(nombre)")
        .eq("estado", "activa");

      if (pilotoIds !== null) {
        if (pilotoIds.length === 0) { setPilotos(new Map()); return; }
        query = query.in("piloto_id", pilotoIds);
      }

      const { data } = await query;
      if (!data) return;

      setPilotos(prev => {
        const next      = new Map(prev);
        const activeIds = new Set(data.map((s: any) => s.piloto_id));
        for (const s of data as any[]) {
          if (!next.has(s.piloto_id)) {
            next.set(s.piloto_id, {
              piloto_id:           s.piloto_id,
              nombre:              s.pilotos?.nombre || "Piloto",
              lat: null, lng: null, velocidad: 0,
              dentro_geocerca:     null,
              ultima_actualizacion: null,
              color:               COLORES[colorIdx++ % COLORES.length],
              bandera_piloto:      s.bandera_piloto ?? null,
            });
          } else {
            // Actualizar bandera_piloto si cambió
            const p = next.get(s.piloto_id)!;
            next.set(s.piloto_id, { ...p, bandera_piloto: s.bandera_piloto ?? null });
          }
        }
        for (const id of next.keys()) {
          if (!activeIds.has(id)) next.delete(id);
        }
        return next;
      });
    };

    loadSessions();

    const sesCh = supabase
      .channel("dir-sesiones")
      .on("postgres_changes", { event: "*", schema: "public", table: "sesiones" }, loadSessions)
      .subscribe();

    const locCh = supabase
      .channel("dir-ubicaciones")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "ubicaciones_piloto" },
        payload => {
          const u = payload.new as any;
          setPilotos(prev => {
            const next = new Map(prev);
            const p    = next.get(u.piloto_id);
            if (p) {
              next.set(u.piloto_id, {
                ...p,
                lat:                  u.lat,
                lng:                  u.lng,
                velocidad:            u.velocidad ?? 0,
                dentro_geocerca:      u.dentro_geocerca,
                ultima_actualizacion: new Date(),
              });
            } else {
              loadSessions();
            }
            return next;
          });
          if (u.lat && u.lng) {
            checkAutoYellow(u.piloto_id, u.lat, u.lng, u.velocidad ?? 0, u.dentro_geocerca ?? null);
          }
        })
      .subscribe();

    return () => {
      supabase.removeChannel(sesCh);
      supabase.removeChannel(locCh);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaId]);

  // ── Tick ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Acciones de bandera ────────────────────────────────────────────────────
  const setGlobalFlag = useCallback(async (flag: string) => {
    await supabase.from("estado_pista").update({ bandera: flag }).eq("activo", true);
  }, []);

  const setSectorFlag = useCallback(async (sectorId: string, flag: string) => {
    await supabase.from("sectores_pista").update({ bandera: flag }).eq("id", sectorId);
  }, []);

  const togglePilotoFlag = useCallback(async (p: PilotoEnPista, flagValue: string) => {
    const newFlag = p.bandera_piloto === flagValue ? null : flagValue;
    // Optimistic update inmediato
    setPilotos(prev => {
      const next = new Map(prev);
      const existing = next.get(p.piloto_id);
      if (existing) next.set(p.piloto_id, { ...existing, bandera_piloto: newFlag });
      return next;
    });
    await supabase
      .from("sesiones")
      .update({ bandera_piloto: newFlag })
      .eq("piloto_id", p.piloto_id)
      .eq("estado", "activa");
  }, []);

  // ── Datos derivados ────────────────────────────────────────────────────────
  const flagsGlobal  = FLAG_GLOBAL[sessionType] || FLAG_GLOBAL.racing;
  const flagsPiloto  = FLAG_PILOTO[sessionType] || FLAG_PILOTO.racing;
  const pilotosList  = Array.from(pilotos.values());
  const chipBandera  = globalFlagChip(bandera);

  const SESSION_LABEL: Record<SessionType, string> = {
    racing: "Carrera",
    track_day: "Track Day",
    entrenamiento: "Entrenamiento",
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden flex flex-col">

      {/* Estilos inline para patrones */}
      <style>{`
        .flag-cuadros {
          background: repeating-conic-gradient(#fff 0% 25%, #111 0% 50%) 0 / 10px 10px;
        }
        .flag-rayas {
          background: repeating-linear-gradient(
            45deg,
            #eab308 0, #eab308 6px,
            #ef4444 6px, #ef4444 12px
          );
        }
        .sector-btn-rayas {
          background: repeating-linear-gradient(
            45deg,
            #eab308 0, #eab308 4px,
            #ef4444 4px, #ef4444 8px
          );
        }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">
            Dirección de Carrera
          </span>
          {fechaId && (
            <span className="text-xs text-gray-600 font-medium">
              · {SESSION_LABEL[sessionType]}
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${chipBandera.cls}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
          {chipBandera.label}
        </div>
      </div>

      {/* ── MAPA ───────────────────────────────────────────────────────────── */}
      {pilotosList.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 pb-0">
          {pilotosList.map(p => (
            <div key={p.piloto_id} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
              <span className="text-xs text-white/40">{p.nombre.split(" ")[0]}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: mapHeight, position: "relative", minHeight: 200 }}>
        {trazado.length > 0 ? (
          <LeafletAdminMap
            trazado={trazado}
            sectores={sectores}
            bandera={bandera}
            pilotos={pilotosList}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-700">
            <p className="text-2xl">🗺</p>
            <p className="text-sm">Sin trazado configurado</p>
          </div>
        )}
      </div>

      {/* ── SECCIÓN: BANDERAS GLOBALES ─────────────────────────────────────── */}
      <div className="border-t border-gray-800 px-4 pt-4 pb-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
          Bandera global
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${flagsGlobal.length}, 1fr)` }}>
          {flagsGlobal.map(f => {
            const isActive = bandera === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setGlobalFlag(f.value)}
                title={f.label}
                className={`
                  relative flex flex-col items-center justify-center gap-1.5
                  rounded-xl border py-3 px-1 transition-all active:scale-95
                  ${isActive
                    ? `${f.activeBg} ${f.activeBorder} ${isActive && f.pulse ? "animate-pulse" : ""}`
                    : `${f.bg} ${f.border} hover:border-gray-500`
                  }
                `}
              >
                {/* Swatch de color */}
                {f.pattern === "cuadros" ? (
                  <div className="flag-cuadros w-6 h-6 rounded-sm flex-shrink-0" />
                ) : (
                  <div
                    className="w-6 h-4 rounded-sm flex-shrink-0"
                    style={{
                      background:
                        f.value === "verde"      ? "#22c55e"
                        : f.value === "roja"     ? "#ef4444"
                        : f.value === "safety_car" ? "#f97316"
                        : "#888",
                    }}
                  />
                )}
                <span className={`text-xs font-black tracking-wider leading-none ${isActive ? f.textColor : "text-gray-500"}`}>
                  {f.shortLabel}
                </span>
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-current" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SECCIÓN: SECTORES ─────────────────────────────────────────────── */}
      {sectores.length > 0 && (
        <div className="border-t border-gray-800 px-4 pt-4 pb-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            Sectores
          </p>
          <div className="flex flex-col gap-2">
            {sectores.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                {/* Label sector */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black"
                  style={{
                    background:
                      s.bandera === "amarilla" ? "#92400e"
                      : s.bandera === "rayas"   ? "transparent"
                      : "#166534",
                    color:
                      s.bandera === "amarilla" ? "#fde68a"
                      : s.bandera === "rayas"   ? "#fff"
                      : "#bbf7d0",
                    ...(s.bandera === "rayas" ? {
                      backgroundImage: "repeating-linear-gradient(45deg,#eab308 0,#eab308 4px,#ef4444 4px,#ef4444 8px)",
                    } : {}),
                  }}
                >
                  S{i + 1}
                </div>

                {/* Nombre */}
                <span className="text-xs text-gray-400 truncate flex-1 min-w-0">{s.nombre}</span>

                {/* Botones V / A / R */}
                <div className="flex gap-1.5 flex-shrink-0">
                  {/* Verde */}
                  <button
                    onClick={() => setSectorFlag(s.id, "verde")}
                    title="Verde"
                    className={`w-8 h-8 rounded-lg text-xs font-black border transition-all active:scale-90 ${
                      s.bandera === "verde"
                        ? "bg-green-700 border-green-500 text-white"
                        : "bg-gray-900 border-gray-700 text-gray-600 hover:border-green-700 hover:text-green-500"
                    }`}
                  >
                    V
                  </button>
                  {/* Amarilla */}
                  <button
                    onClick={() => setSectorFlag(s.id, "amarilla")}
                    title="Amarilla"
                    className={`w-8 h-8 rounded-lg text-xs font-black border transition-all active:scale-90 ${
                      s.bandera === "amarilla"
                        ? "bg-yellow-600 border-yellow-400 text-black"
                        : "bg-gray-900 border-gray-700 text-gray-600 hover:border-yellow-600 hover:text-yellow-500"
                    }`}
                  >
                    A
                  </button>
                  {/* Rayas */}
                  <button
                    onClick={() => setSectorFlag(s.id, "rayas")}
                    title="Rayas (amarilla+roja)"
                    className={`w-8 h-8 rounded-lg text-xs font-black border transition-all active:scale-90 overflow-hidden ${
                      s.bandera === "rayas"
                        ? "border-orange-500 text-white"
                        : "bg-gray-900 border-gray-700 text-gray-600 hover:border-orange-600"
                    }`}
                    style={
                      s.bandera === "rayas"
                        ? { backgroundImage: "repeating-linear-gradient(45deg,#eab308 0,#eab308 4px,#ef4444 4px,#ef4444 8px)" }
                        : {}
                    }
                  >
                    {s.bandera !== "rayas" ? "R" : ""}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SECCIÓN: PILOTOS EN SESIÓN ────────────────────────────────────── */}
      <div className="border-t border-gray-800 px-4 pt-4 pb-4 flex-1">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            Pilotos en sesión
          </p>
          <span className="text-xs text-gray-700 font-medium">
            {pilotosList.length === 0 ? "—" : `${pilotosList.length} activos`}
          </span>
        </div>

        {pilotosList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-2xl mb-2">🏁</p>
            <p className="text-xs text-gray-700">Esperando pilotos</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pilotosList.map(p => {
              const segs    = p.ultima_actualizacion
                ? Math.floor((Date.now() - p.ultima_actualizacion.getTime()) / 1000)
                : null;
              const activo  = segs !== null && segs < 15;
              const stopped = p.velocidad <= 5 && segs !== null;
              void tick; // consume tick para re-render

              return (
                <div
                  key={p.piloto_id}
                  className="flex items-center gap-2.5 bg-gray-900 rounded-xl px-3 py-2.5 border border-gray-800"
                >
                  {/* Dot de color */}
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: p.color }}
                  />

                  {/* Nombre + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold text-white truncate">{p.nombre}</p>
                      {p.bandera_piloto && (
                        <span className="text-xs font-black uppercase tracking-wider" style={{
                          color:
                            p.bandera_piloto === "azul"         ? "#60a5fa"
                            : p.bandera_piloto === "negra"      ? "#9ca3af"
                            : p.bandera_piloto === "negra_blanco" ? "#d1d5db"
                            : p.bandera_piloto === "taller"     ? "#a78bfa"
                            : "#fff",
                        }}>
                          ●
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-bold tabular-nums ${stopped ? "text-yellow-400" : "text-gray-400"}`}>
                        {p.velocidad} km/h
                      </span>
                      {stopped && (
                        <span className="text-xs text-yellow-600 font-semibold">· DETENIDO</span>
                      )}
                      <span className={`text-xs ${activo ? "text-gray-700" : "text-yellow-700"}`}>
                        {segs !== null
                          ? (activo ? `${segs}s` : `⚠ ${segs}s`)
                          : (p.dentro_geocerca === false ? "Fuera" : "—")
                        }
                      </span>
                    </div>
                  </div>

                  {/* Botones de bandera personal */}
                  <div className="flex gap-1 flex-shrink-0">
                    {flagsPiloto.map(f => {
                      const isOn = p.bandera_piloto === f.value;
                      return (
                        <button
                          key={f.value}
                          onClick={() => togglePilotoFlag(p, f.value)}
                          title={`${f.title}${isOn ? " (activa — clic para desactivar)" : ""}`}
                          className="w-6 h-6 rounded-md text-xs font-black leading-none transition-all active:scale-90 overflow-hidden"
                          style={{
                            background: isOn ? f.bg : "#1f2937",
                            boxShadow:  isOn ? f.activeShadow : "none",
                            border:     isOn ? "none" : "1px solid #374151",
                            color:      isOn ? "#fff" : "#6b7280",
                          }}
                        >
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

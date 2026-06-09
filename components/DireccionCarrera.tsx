"use client";

/**
 * DireccionCarrera.tsx — components/DireccionCarrera.tsx
 *
 * Mapa del circuito al centro con pilotos activos en tiempo real (Leaflet).
 * Lista de pilotos al costado derecho.
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { getTrazadoActivo, type Coordenada } from "@/lib/gps";

const LeafletAdminMap = dynamic(() => import("@/components/LeafletAdminMap"), { ssr: false });

// ── Tipos ─────────────────────────────────────────────────────
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
}

// ── Colores para pilotos ───────────────────────────────────────
const COLORES = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6",
  "#a78bfa", "#fb923c", "#22d3ee", "#4ade80",
];

const FLAG_LABEL: Record<string, string> = {
  verde:          "Pista libre",
  amarilla:       "Amarilla",
  amarilla_doble: "Doble amarilla",
  roja:           "Bandera roja",
  safety_car:     "Safety Car",
  blanca:         "Vehículo lento",
  negra:          "A boxes",
};

// ── Componente ─────────────────────────────────────────────────
interface DireccionCarreraProps {
  fechaId?: string | null;
}

export default function DireccionCarrera({ fechaId }: DireccionCarreraProps = {}) {
  const [trazado,  setTrazado]  = useState<Coordenada[]>([]);
  const [pilotos,  setPilotos]  = useState<Map<string, PilotoEnPista>>(new Map());
  const [bandera,  setBandera]  = useState("verde");
  const [sectores, setSectores] = useState<SectorInfo[]>([]);
  const [tick,     setTick]     = useState(0);

  // Refs para acceder a valores actuales dentro de callbacks de Supabase (evita stale closures)
  const trazadoRef    = useRef<Coordenada[]>([]);
  const sectoresRef   = useRef<SectorInfo[]>([]);
  const banderaRef    = useRef<string>("verde");
  // Track auto-yellows: sectorId → pilotoId que lo causó
  const autoYellowRef = useRef<Map<string, string>>(new Map());

  // Sincronizar refs con estado (para callbacks de Supabase)
  useEffect(() => { trazadoRef.current  = trazado;  }, [trazado]);
  useEffect(() => { sectoresRef.current = sectores; }, [sectores]);
  useEffect(() => { banderaRef.current  = bandera;  }, [bandera]);

  // ── Auto-yellow helpers ────────────────────────────────────
  function findClosestIdx(lat: number, lng: number, trazado: Coordenada[]): number {
    let minD = Infinity, closest = 0;
    trazado.forEach((c, i) => {
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

  async function checkAutoYellow(pilotoId: string, lat: number, lng: number, velocidad: number) {
    // Solo aplica cuando la pista está en verde (sin override global)
    if (banderaRef.current !== "verde") return;

    const stopped = velocidad <= 2;

    if (stopped) {
      const sector = detectSectorByPos(lat, lng);
      if (sector && sector.bandera === "verde" && !autoYellowRef.current.has(sector.id)) {
        autoYellowRef.current.set(sector.id, pilotoId);
        await supabase.from("sectores_pista").update({ bandera: "amarilla" }).eq("id", sector.id);
        console.log(`🟡 Auto-amarilla: ${sector.nombre} (piloto ${pilotoId})`);
      }
    } else {
      // Piloto se mueve — revertir su auto-amarilla si la tenía
      for (const [sectorId, pId] of autoYellowRef.current.entries()) {
        if (pId === pilotoId) {
          autoYellowRef.current.delete(sectorId);
          await supabase.from("sectores_pista").update({ bandera: "verde" }).eq("id", sectorId);
          console.log(`🟢 Revertido auto-amarilla: sector ${sectorId}`);
        }
      }
    }
  }

  // Cargar circuito
  useEffect(() => {
    getTrazadoActivo().then(c => { if (c) setTrazado(c); });
  }, []);

  // Cargar sectores y suscribir cambios
  useEffect(() => {
    const loadSectores = async () => {
      const { data } = await supabase
        .from("sectores_pista")
        .select("*")
        .order("orden");
      if (data) setSectores(data);
    };
    loadSectores();
    const ch = supabase
      .channel("dir-sectores")
      .on("postgres_changes", { event: "*", schema: "public", table: "sectores_pista" }, loadSectores)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Estado de pista (bandera)
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

  // Sesiones activas + ubicaciones en tiempo real
  useEffect(() => {
    let colorIdx = 0;

    const loadSessions = async () => {
      // Si hay un fechaId de evento activo, filtrar solo pilotos inscritos en esa fecha
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
        .select("piloto_id, pilotos(nombre)")
        .eq("estado", "activa");

      if (pilotoIds !== null) {
        if (pilotoIds.length === 0) {
          // No hay inscritos confirmados — no mostrar nadie
          setPilotos(new Map());
          return;
        }
        query = query.in("piloto_id", pilotoIds);
      }

      const { data } = await query;

      if (!data) return;

      setPilotos(prev => {
        const next      = new Map(prev);
        const activeIds = new Set(data.map(s => s.piloto_id));

        for (const s of data) {
          if (!next.has(s.piloto_id)) {
            next.set(s.piloto_id, {
              piloto_id:           s.piloto_id,
              nombre:              (s.pilotos as any)?.nombre || "Piloto",
              lat: null, lng: null, velocidad: 0,
              dentro_geocerca:     null,
              ultima_actualizacion: null,
              color:               COLORES[colorIdx++ % COLORES.length],
            });
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

          // Actualizar posición del piloto en el mapa
          setPilotos(prev => {
            const next = new Map(prev);
            const p    = next.get(u.piloto_id);
            if (p) {
              // Piloto ya conocido → actualizar posición
              next.set(u.piloto_id, {
                ...p,
                lat:                  u.lat,
                lng:                  u.lng,
                velocidad:            u.velocidad ?? 0,
                dentro_geocerca:      u.dentro_geocerca,
                ultima_actualizacion: new Date(),
              });
            } else {
              // Piloto no estaba en el mapa aún → recargar sesiones
              // (puede pasar si la ubicación llegó antes que el INSERT de sesión)
              loadSessions();
            }
            return next;
          });

          // Auto-yellow: si el piloto está detenido, amarillar su sector
          if (u.lat && u.lng) {
            checkAutoYellow(u.piloto_id, u.lat, u.lng, u.velocidad ?? 0);
          }
        })
      .subscribe();

    return () => {
      supabase.removeChannel(sesCh);
      supabase.removeChannel(locCh);
    };
  }, [fechaId]);

  // Tick para "hace Xs"
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const pilotosList = Array.from(pilotos.values());

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Mapa en tiempo real
          </span>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${
          bandera === "verde"            ? "bg-green-950  text-green-400"
          : bandera === "roja"           ? "bg-red-950    text-red-400 animate-pulse"
          : bandera === "safety_car"     ? "bg-orange-950 text-orange-400 animate-pulse"
          : bandera.startsWith("amarilla") ? "bg-yellow-950 text-yellow-400"
          : "bg-gray-800 text-gray-400"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {FLAG_LABEL[bandera] || bandera}
        </div>
      </div>

      {/* ── Contenido: mapa + lista ── */}
      <div className="flex flex-col sm:flex-row">

        {/* MAPA (Leaflet) */}
        <div className="flex-1 min-w-0" style={{ minHeight: 300 }}>
          {/* Leyenda de pilotos */}
          {pilotosList.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pt-3 pb-1">
              {pilotosList.map(p => (
                <div key={p.piloto_id} className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: p.color }}
                  />
                  <span className="text-xs text-white/50">{p.nombre.split(" ")[0]}</span>
                </div>
              ))}
            </div>
          )}

          {/* Mapa Leaflet */}
          <div style={{ height: 300, position: "relative" }}>
            {trazado.length > 0 ? (
              <LeafletAdminMap
                trazado={trazado}
                sectores={sectores}
                bandera={bandera}
                pilotos={pilotosList}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-600">
                <p className="text-2xl">🗺</p>
                <p className="text-sm">Sin trazado configurado</p>
              </div>
            )}
          </div>
        </div>

        {/* LISTA DE PILOTOS */}
        <div className="sm:w-52 border-t sm:border-t-0 sm:border-l border-gray-800 flex flex-col">

          <div className="px-3 py-2.5 border-b border-gray-800">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {pilotosList.length === 0 ? "Sin pilotos" : `${pilotosList.length} en pista`}
            </p>
          </div>

          {pilotosList.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center px-4">
              <p className="text-2xl mb-2">🏁</p>
              <p className="text-xs text-white/20">Esperando pilotos</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-gray-800/60">
              {pilotosList.map(p => {
                const segs   = p.ultima_actualizacion
                  ? Math.floor((Date.now() - p.ultima_actualizacion.getTime()) / 1000)
                  : null;
                const activo = segs !== null && segs < 10;
                const stopped = p.velocidad <= 2 && segs !== null;

                return (
                  <div key={p.piloto_id} className="px-3 py-3 flex flex-col gap-1">
                    {/* Nombre + color */}
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: p.color }}
                      />
                      <p className="text-xs font-semibold text-white truncate">{p.nombre}</p>
                    </div>

                    {/* Velocidad */}
                    <div className="flex items-end gap-1 pl-4">
                      <span className={`text-xl font-black tabular-nums leading-none ${
                        stopped ? "text-yellow-400" : "text-white"
                      }`}>
                        {p.velocidad}
                      </span>
                      <span className="text-xs text-white/30 mb-0.5">km/h</span>
                      {stopped && (
                        <span className="text-xs font-bold text-yellow-400 mb-0.5 ml-1">
                          · DETENIDO
                        </span>
                      )}
                    </div>

                    {/* Geocerca + señal */}
                    <div className="flex items-center gap-2 pl-4">
                      <span className={`text-xs font-medium ${
                        p.dentro_geocerca === null ? "text-gray-600"
                        : p.dentro_geocerca        ? "text-green-400"
                        : "text-red-400"
                      }`}>
                        {p.dentro_geocerca === null ? "—"
                         : p.dentro_geocerca ? "En pista"
                         : "Fuera"}
                      </span>
                      {segs !== null && (
                        <span className={`text-xs ${activo ? "text-white/30" : "text-yellow-600"}`}>
                          {activo ? `${segs}s` : `⚠ ${segs}s`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

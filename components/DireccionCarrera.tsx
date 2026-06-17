"use client";

/**
 * DireccionCarrera.tsx — components/DireccionCarrera.tsx
 *
 * Mapa del circuito con pilotos en tiempo real (Leaflet) + auto-amarilla.
 * Los controles de banderas viven en el panel derecho del admin
 * (app/admin/page.tsx), no en este componente.
 */

import { useEffect, useRef, useState } from "react";
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
  offline: boolean;
  color: string;
  bandera_piloto: string | null;
}

type SessionType = "racing" | "track_day" | "entrenamiento";

// ── Helpers de color de bandera global ────────────────────────────────────────
// Nota: el Safety Car se señaliza con amarillo (igual que las banderas), no naranjo.

function globalFlagChip(bandera: string) {
  switch (bandera) {
    case "verde":      return { label: "Pista libre", cls: "bg-green-950  text-green-400  border-green-800" };
    case "roja":       return { label: "Roja",        cls: "bg-red-950    text-red-400    border-red-800    animate-pulse" };
    case "safety_car": return { label: "Safety Car",  cls: "bg-yellow-950 text-yellow-400 border-yellow-800 animate-pulse" };
    case "amarilla":   return { label: "Amarilla",    cls: "bg-yellow-950 text-yellow-400 border-yellow-800" };
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
  /** ID del circuito activo para este evento. Cuando se provee, lee trazado
   *  directamente de la tabla `circuitos` en lugar de la tabla global `trazado_pista`.
   *  Cambiar este prop dispara un re-fetch inmediato sin depender de Realtime. */
  circuitoId?: string | null;
}

export default function DireccionCarrera({ fechaId, mapHeight = 320, circuitoId }: DireccionCarreraProps = {}) {
  const [trazado,     setTrazado]     = useState<Coordenada[]>([]);
  const [pilotos,     setPilotos]     = useState<Map<string, PilotoEnPista>>(new Map());
  const [bandera,     setBandera]     = useState("verde");
  const [sectores,    setSectores]    = useState<SectorInfo[]>([]);
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

    // Solo revertir si está CONFIRMADO fuera (false). Si es null/desconocido,
    // no hacer nada — el jitter del GPS en el borde de la geocerca causaba
    // un bucle encender/apagar cada 3 segundos.
    if (dentroGeocerca === false) { await revertAutoYellow(pilotoId); return; }
    if (dentroGeocerca !== true) return;

    if (velocidad <= 5) {
      // Detenido en pista → amarilla en su sector
      const sector = detectSectorByPos(lat, lng);
      if (sector && sector.bandera === "verde" && !autoYellowRef.current.has(sector.id)) {
        autoYellowRef.current.set(sector.id, pilotoId);
        await supabase.from("sectores_pista").update({ bandera: "amarilla" }).eq("id", sector.id);
      }
    } else if (velocidad > 8) {
      // Histéresis: recién sobre 8 km/h se considera "en movimiento" y se
      // revierte. Entre 5 y 8 no se hace nada (banda muerta anti-parpadeo).
      await revertAutoYellow(pilotoId);
    }
  }

  // ── Cargar trazado ─────────────────────────────────────────────────────────
  // Si se provee circuitoId, leer directo de `circuitos` (fuente de verdad única).
  // Cuando circuitoId cambia React re-ejecuta este efecto → mapa actualiza sin Realtime.
  // Fallback: tabla global `trazado_pista` (para compatibilidad).
  useEffect(() => {
    if (circuitoId) {
      supabase
        .from("circuitos")
        .select("trazado_coords")
        .eq("id", circuitoId)
        .single()
        .then(({ data }) => { if (data?.trazado_coords?.length >= 2) setTrazado(data?.trazado_coords ?? []); });
    } else {
      getTrazadoActivo().then(c => { if (c) setTrazado(c); });
    }
  }, [circuitoId]);

  // ── Cargar sectores y suscribir cambios ────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("sectores_pista").select("*").order("orden");
      // Solo actualizar si cambió de verdad — evita redibujar el mapa en cada evento
      if (data) setSectores(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);
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
        payload => {
          const n = payload.new as any;
          // Solo eventos de la fila activa (evita cruces con otras tablas/filas)
          if (n?.activo === true && typeof n.bandera === "string") setBandera(n.bandera);
        })
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
              offline:             true,
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

  // ── Detección de pilotos offline ──────────────────────────────────────────
  useEffect(() => {
    const OFFLINE_MS = 20_000; // 20 s sin actualización = offline
    const id = setInterval(() => {
      const now = Date.now();
      setPilotos(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [pid, p] of next) {
          const shouldBeOffline =
            p.ultima_actualizacion === null ||
            now - p.ultima_actualizacion.getTime() > OFFLINE_MS;
          if (shouldBeOffline !== p.offline) {
            next.set(pid, { ...p, offline: shouldBeOffline });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  // ── Datos derivados ────────────────────────────────────────────────────────
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

    </div>
  );
}

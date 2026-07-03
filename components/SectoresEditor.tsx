"use client";

/**
 * SectoresEditor.tsx — components/SectoresEditor.tsx
 *
 * Editor de sectores de pista.
 * Usa un selector numérico (+/-) para elegir cuántos sectores,
 * divide el trazado en partes iguales y permite renombrar cada uno.
 * Muestra un mapa Leaflet real con marcadores arrastrables en los límites.
 */

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { getTrazadoActivo, sectorLargo, type Coordenada } from "@/lib/gps";

const LeafletSectoresMap = dynamic(
  () => import("@/components/LeafletSectoresMap"),
  { ssr: false }
);

const COLORS = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6",
  "#a78bfa", "#fb923c", "#22d3ee", "#4ade80",
];

interface Rango {
  nombre: string;
  inicio: number;
  fin:    number;
  color:  string;
}

interface SectoresEditorProps {
  circuitoId?: string | null;
}

export default function SectoresEditor({ circuitoId }: SectoresEditorProps = {}) {
  const [trazado,   setTrazado]   = useState<Coordenada[]>([]);
  const [cantidad,  setCantidad]  = useState(1);
  const [nombres,   setNombres]   = useState<string[]>(["Sector 1"]);
  const [rangos,    setRangos]    = useState<Rango[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje,   setMensaje]   = useState<{ texto: string; ok: boolean } | null>(null);
  const [cargando,  setCargando]  = useState(true);

  // ── Cargar trazado y sectores existentes ──────────────────
  // circuitoId como dep: cuando cambia el circuito activo, recarga el trazado
  useEffect(() => {
    const init = async () => {
      let coords: Coordenada[] | null = null;
      if (circuitoId) {
        const { data } = await supabase
          .from("circuitos")
          .select("trazado_coords")
          .eq("id", circuitoId)
          .single();
        coords = data?.trazado_coords ?? null;
      } else if (circuitoId === undefined) {
        // Sin prop: comportamiento legado (trazado global)
        coords = await getTrazadoActivo();
      }
      // circuitoId === null → evento sin circuito asignado: editor vacío,
      // sin caer al trazado global de la última fecha
      setTrazado(coords ?? []);

      try {
        const { data } = await supabase
          .from("sectores_pista")
          .select("*")
          .order("orden");
        if (data && data.length > 0) {
          setCantidad(data.length);
          setNombres(data.map((r: any) => r.nombre));
        }
      } catch (_) {
        // tabla puede no existir aún
      } finally {
        setCargando(false);
      }
    };
    init();
  }, [circuitoId]); // re-carga cuando cambia el circuito activo

  // ── Cuando cambia la cantidad, ajustar nombres y recalcular rangos ─
  const cambiarCantidad = (nueva: number) => {
    if (nueva < 1 || nueva > 8) return;
    const n = [...nombres];
    while (n.length < nueva) n.push(`Sector ${n.length + 1}`);
    const nextNombres = n.slice(0, nueva);
    setNombres(nextNombres);
    setCantidad(nueva);
    // Recalcular rangos con división uniforme al cambiar cantidad
    if (trazado.length) {
      const total = trazado.length;
      const tramo = Math.floor(total / nueva);
      setRangos(Array.from({ length: nueva }, (_, i) => ({
        nombre: nextNombres[i] || `Sector ${i + 1}`,
        inicio: i * tramo,
        fin:    i === nueva - 1 ? total - 1 : (i + 1) * tramo,
        color:  COLORS[i % COLORS.length],
      })));
    }
  };

  // ── Inicializar rangos cuando trazado o cantidad cambian ───
  useEffect(() => {
    if (!trazado.length || cantidad < 1) return;
    const total = trazado.length;
    const tramo = Math.floor(total / cantidad);
    setRangos(prev => {
      // Si ya hay rangos y coincide la cantidad, solo actualizar nombres
      if (prev.length === cantidad) {
        return prev.map((r, i) => ({ ...r, nombre: nombres[i] || r.nombre }));
      }
      // División uniforme
      return Array.from({ length: cantidad }, (_, i) => ({
        nombre: nombres[i] || `Sector ${i + 1}`,
        inicio: i * tramo,
        fin:    i === cantidad - 1 ? total - 1 : (i + 1) * tramo,
        color:  COLORS[i % COLORS.length],
      }));
    });
  }, [trazado, cantidad]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actualizar nombres en rangos cuando se editan ──────────
  useEffect(() => {
    setRangos(prev => prev.map((r, i) => ({ ...r, nombre: nombres[i] || r.nombre })));
  }, [nombres]);

  // ── Handler para drag de marcadores de límite ──────────────
  // Los límites son circulares: el límite N|1 (último→primer sector)
  // también se mueve; el sector que queda cruzando el punto de partida
  // del trazado se guarda con punto_inicio > punto_fin.
  const handleBoundaryChange = useCallback((boundaryIdx: number, newFin: number) => {
    setRangos(prev => {
      const next   = [...prev];
      const sigIdx = (boundaryIdx + 1) % prev.length;
      next[boundaryIdx] = { ...next[boundaryIdx], fin:    newFin };
      next[sigIdx]      = { ...next[sigIdx],      inicio: newFin };
      return next;
    });
  }, []);

  // ── Mover límite con botones (circular, incluye el límite N|1) ──
  const moverLimite = useCallback((boundaryIdx: number, delta: number) => {
    setRangos(prev => {
      const n     = prev.length;
      const total = trazado.length;
      if (!total || n < 2) return prev;
      const next   = [...prev];
      const sigIdx = (boundaryIdx + 1) % n;
      let cand = (((next[boundaryIdx].fin + delta) % total) + total) % total;
      // El candidato debe quedar dentro del arco entre el inicio del sector
      // izquierdo y el fin del derecho, con mínimo 2 puntos por lado
      const arco = sectorLargo(next[boundaryIdx].inicio, next[sigIdx].fin, total);
      const izq  = sectorLargo(next[boundaryIdx].inicio, cand, total);
      const der  = sectorLargo(cand, next[sigIdx].fin, total);
      if (izq + der !== arco || izq < 2 || der < 2) {
        cand = delta < 0
          ? (next[boundaryIdx].inicio + 2) % total
          : (next[sigIdx].fin - 2 + total) % total;
      }
      next[boundaryIdx] = { ...next[boundaryIdx], fin:    cand };
      next[sigIdx]      = { ...next[sigIdx],      inicio: cand };
      return next;
    });
  }, [trazado.length]);

  // ── Guardar en Supabase ─────────────────────────────────────
  const guardarSectores = async () => {
    if (!rangos.length || cantidad < 2) return;
    setGuardando(true);
    try {
      // Eliminar sectores anteriores
      await supabase.from("sectores_pista").delete().gte("orden", 1);

      // Insertar nuevos
      const rows = rangos.map((r, i) => ({
        nombre:       r.nombre,
        orden:        i + 1,
        punto_inicio: r.inicio,
        punto_fin:    r.fin,
        bandera:      "verde",
      }));

      const { error } = await supabase.from("sectores_pista").insert(rows);
      if (error) throw error;

      setMensaje({ texto: `✅ ${rows.length} sectores guardados`, ok: true });
    } catch (err: any) {
      console.error(err);
      setMensaje({ texto: `❌ Error: ${err?.message || "desconocido"}`, ok: false });
    } finally {
      setGuardando(false);
      setTimeout(() => setMensaje(null), 4000);
    }
  };

  const resetearSectores = async () => {
    setCantidad(1);
    setNombres(["Sector 1"]);
    await supabase.from("sectores_pista").delete().gte("orden", 1);
    setMensaje({ texto: "🗑 Sectores eliminados", ok: true });
    setTimeout(() => setMensaje(null), 3000);
  };

  if (cargando) {
    return (
      <div className="py-10 flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        <span className="text-sm text-gray-400">Cargando...</span>
      </div>
    );
  }

  // Barra visual proporcional de sectores
  const barraTotal = trazado.length || 1;

  return (
    <div className="space-y-5">

      {/* ── Selector de cantidad ── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Divisiones del circuito
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => cambiarCantidad(cantidad - 1)}
            disabled={cantidad <= 1}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-700 font-bold text-lg transition-colors flex items-center justify-center flex-shrink-0"
          >
            −
          </button>

          <div className="flex gap-1.5 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
              <button
                key={n}
                onClick={() => cambiarCantidad(n)}
                className={`w-9 h-9 rounded-lg text-sm font-black transition-all ${
                  cantidad === n
                    ? "bg-gray-900 text-white shadow-md"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            onClick={() => cambiarCantidad(cantidad + 1)}
            disabled={cantidad >= 8}
            className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-700 font-bold text-lg transition-colors flex items-center justify-center flex-shrink-0"
          >
            +
          </button>
        </div>
      </div>

      {/* ── Barra visual proporcional de sectores ── */}
      {rangos.length > 0 && trazado.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Distribución del trazado
          </p>
          <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-gray-200">
            {rangos.map((r, i) => {
              const pct = (sectorLargo(r.inicio, r.fin, barraTotal) / barraTotal) * 100;
              return (
                <div
                  key={i}
                  style={{ width: `${pct}%`, background: r.color }}
                  className="transition-all duration-300"
                  title={`${r.nombre}: ${pct.toFixed(0)}%`}
                />
              );
            })}
          </div>
          <div className="flex gap-px mt-1">
            {rangos.map((r, i) => {
              const pct = (sectorLargo(r.inicio, r.fin, barraTotal) / barraTotal) * 100;
              return (
                <div key={i} style={{ width: `${pct}%` }} className="transition-all duration-300">
                  <p className="text-center truncate px-1 text-gray-400" style={{ fontSize: "10px" }}>
                    {pct.toFixed(0)}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Mapa Leaflet con sectores coloreados y límites arrastrables ── */}
      <div>
        {!trazado.length ? (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl py-10 text-center text-gray-400 text-sm">
            <p className="text-2xl mb-2">🗺</p>
            {circuitoId === null ? (
              <>
                <p>Este evento aún no tiene circuito asignado</p>
                <p className="text-xs mt-1">Actívale un circuito desde la biblioteca de circuitos aquí en Config</p>
              </>
            ) : (
              <p>Sin trazado cargado en Supabase</p>
            )}
          </div>
        ) : (
          <>
            <LeafletSectoresMap
              trazado={trazado}
              rangos={rangos}
              onBoundaryChange={handleBoundaryChange}
            />
            {cantidad >= 2 && (
              <div className="flex items-center justify-center gap-2 mt-2.5">
                <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs px-3 py-1.5 rounded-full">
                  <span>✋</span>
                  Arrastrá los marcadores bicolor del mapa para mover los límites entre sectores
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Nombres + controles de límite intercalados ── */}
      {cantidad >= 2 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Sectores y límites
          </p>
          <div className="space-y-1">
            {Array.from({ length: cantidad }, (_, i) => {
              const pct = rangos[i]
                ? ((sectorLargo(rangos[i].inicio, rangos[i].fin, barraTotal) / barraTotal) * 100).toFixed(0)
                : null;
              return (
                <div key={i}>
                  {/* Fila del sector */}
                  <div
                    className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 border-l-4"
                    style={{ borderLeftColor: COLORS[i % COLORS.length] }}
                  >
                    <span className="text-xs font-black text-gray-400 w-4 text-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={nombres[i] ?? `Sector ${i + 1}`}
                      onChange={e => {
                        const n = [...nombres];
                        n[i]   = e.target.value;
                        setNombres(n);
                      }}
                      className="flex-1 bg-transparent text-gray-900 text-sm font-semibold focus:outline-none min-w-0 placeholder-gray-400"
                      placeholder={`Sector ${i + 1}`}
                    />
                    {pct && (
                      <span className="text-xs text-gray-400 flex-shrink-0 font-mono">{pct}%</span>
                    )}
                  </div>

                  {/* Control de límite entre sector i y el siguiente
                      (circular: el último sector limita con el primero) */}
                  {rangos[i] && rangos[(i + 1) % cantidad] && (() => {
                    const sig = (i + 1) % cantidad;
                    return (
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      {/* Línea divisoria izquierda */}
                      <div className="flex-1 h-px bg-gray-200" />

                      {/* Indicador de color combinado + qué límite mueve */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <div className="flex items-center gap-0">
                          <div className="w-2 h-4 rounded-l-sm" style={{ background: COLORS[i % COLORS.length] }} />
                          <div className="w-2 h-4 rounded-r-sm" style={{ background: COLORS[sig % COLORS.length] }} />
                        </div>
                        <span className="text-xs font-mono font-bold text-gray-400">{i + 1}|{sig + 1}</span>
                      </div>

                      {/* Botones de ajuste */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => moverLimite(i, -10)}
                          title="Retroceder 10 puntos"
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center transition-colors select-none"
                        >
                          «
                        </button>
                        <button
                          onClick={() => moverLimite(i, -1)}
                          title="Retroceder 1 punto"
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center transition-colors select-none"
                        >
                          ‹
                        </button>

                        {/* Posición actual */}
                        <span className="text-xs font-mono text-gray-500 w-20 text-center">
                          pt {rangos[i].fin} / {trazado.length}
                        </span>

                        <button
                          onClick={() => moverLimite(i, +1)}
                          title="Avanzar 1 punto"
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center transition-colors select-none"
                        >
                          ›
                        </button>
                        <button
                          onClick={() => moverLimite(i, +10)}
                          title="Avanzar 10 puntos"
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm flex items-center justify-center transition-colors select-none"
                        >
                          »
                        </button>
                      </div>

                      {/* Línea divisoria derecha */}
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="flex gap-3">
        <button
          onClick={guardarSectores}
          disabled={guardando || cantidad < 2 || !trazado.length}
          className="flex-1 py-3 bg-gray-900 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
        >
          {guardando ? "Guardando..." : `Guardar ${cantidad} sectores`}
        </button>
        <button
          onClick={resetearSectores}
          className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 rounded-xl text-sm transition-colors"
          title="Eliminar todos los sectores"
        >
          🗑
        </button>
      </div>

      {/* ── Feedback ── */}
      {mensaje && (
        <div className={`text-sm text-center font-semibold px-4 py-2.5 rounded-xl border ${
          mensaje.ok
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {mensaje.texto}
        </div>
      )}

      {cantidad === 1 && !cargando && (
        <p className="text-xs text-gray-400 text-center">
          Seleccioná 2 o más sectores para activar el control de banderas por zona
        </p>
      )}
    </div>
  );
}

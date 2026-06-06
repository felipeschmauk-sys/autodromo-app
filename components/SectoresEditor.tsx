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
import { getTrazadoActivo, type Coordenada } from "@/lib/gps";

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

export default function SectoresEditor() {
  const [trazado,   setTrazado]   = useState<Coordenada[]>([]);
  const [cantidad,  setCantidad]  = useState(1);
  const [nombres,   setNombres]   = useState<string[]>(["Sector 1"]);
  const [rangos,    setRangos]    = useState<Rango[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje,   setMensaje]   = useState<{ texto: string; ok: boolean } | null>(null);
  const [cargando,  setCargando]  = useState(true);

  // ── Cargar trazado y sectores existentes ──────────────────
  useEffect(() => {
    const init = async () => {
      const coords = await getTrazadoActivo();
      if (coords) setTrazado(coords);

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
  }, []);

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
  const handleBoundaryChange = useCallback((boundaryIdx: number, newFin: number) => {
    setRangos(prev => {
      const next = [...prev];
      next[boundaryIdx]     = { ...next[boundaryIdx],     fin:   newFin };
      next[boundaryIdx + 1] = { ...next[boundaryIdx + 1], inicio: newFin };
      return next;
    });
  }, []);

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
        <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-gray-500">Cargando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Selector de cantidad ── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Cantidad de sectores
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => cambiarCantidad(cantidad - 1)}
            disabled={cantidad <= 1}
            className="w-10 h-10 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white font-bold text-lg transition-colors flex items-center justify-center"
          >
            −
          </button>

          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
              <button
                key={n}
                onClick={() => cambiarCantidad(n)}
                className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                  cantidad === n
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            onClick={() => cambiarCantidad(cantidad + 1)}
            disabled={cantidad >= 8}
            className="w-10 h-10 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-white font-bold text-lg transition-colors flex items-center justify-center"
          >
            +
          </button>
        </div>
      </div>

      {/* ── Mapa Leaflet con sectores coloreados y límites arrastrables ── */}
      <div>
        {!trazado.length ? (
          <div className="bg-gray-950 border border-gray-800 rounded-2xl py-12 text-center text-gray-600 text-sm">
            <p className="text-2xl mb-2">🗺</p>
            <p>Sin trazado cargado en Supabase</p>
          </div>
        ) : (
          <>
            <LeafletSectoresMap
              trazado={trazado}
              rangos={rangos}
              onBoundaryChange={handleBoundaryChange}
            />
            {cantidad >= 2 && (
              <p className="text-xs text-gray-600 text-center mt-2">
                Arrastrá los marcadores de límite para ajustar los sectores
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Nombres de sectores ── */}
      {cantidad >= 2 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Nombres de sectores
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: cantidad }, (_, i) => (
              <div key={i} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-xl px-3 py-2">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <input
                  type="text"
                  value={nombres[i] ?? `Sector ${i + 1}`}
                  onChange={e => {
                    const n = [...nombres];
                    n[i]   = e.target.value;
                    setNombres(n);
                  }}
                  className="flex-1 bg-transparent text-white text-sm font-medium focus:outline-none min-w-0"
                  placeholder={`Sector ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="flex gap-3">
        <button
          onClick={guardarSectores}
          disabled={guardando || cantidad < 2 || !trazado.length}
          className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
        >
          {guardando ? "Guardando..." : `Guardar ${cantidad} sectores`}
        </button>
        <button
          onClick={resetearSectores}
          className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl text-sm transition-colors"
          title="Eliminar todos los sectores"
        >
          🗑
        </button>
      </div>

      {/* ── Feedback ── */}
      {mensaje && (
        <p className={`text-sm text-center font-semibold ${mensaje.ok ? "text-green-400" : "text-red-400"}`}>
          {mensaje.texto}
        </p>
      )}

      {cantidad === 1 && !cargando && (
        <p className="text-xs text-gray-600 text-center">
          Con 1 sector no hay división — seleccioná 2 o más para activar el control por sector
        </p>
      )}
    </div>
  );
}

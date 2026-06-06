"use client";

/**
 * SectoresEditor.tsx — COLOCAR en: components/SectoresEditor.tsx
 *
 * Editor visual de sectores de pista.
 * Se integra en la pestaña Config del admin panel.
 *
 * Funcionamiento:
 * - Muestra el trazado KML como SVG interactivo.
 * - Click sobre el trazado → agrega un divisor de sector.
 * - Click sobre un divisor (punto blanco) → lo elimina.
 * - Cada sector se muestra en un color diferente.
 * - Permite renombrar cada sector.
 * - Botón "Guardar" escribe los sectores en Supabase.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { getTrazadoActivo, type Coordenada } from "@/lib/gps";

interface SectorRange {
  nombre:  string;
  inicio:  number;
  fin:     number;
  color:   string;
}

const COLORS = [
  "#60a5fa", "#f59e0b", "#34d399", "#f472b6",
  "#a78bfa", "#fb923c", "#22d3ee", "#4ade80",
];

const W = 480, H = 260, PAD = 28;

export default function SectoresEditor() {
  const [trazado,     setTrazado]     = useState<Coordenada[]>([]);
  const [splits,      setSplits]      = useState<number[]>([]); // indices en trazado
  const [nombres,     setNombres]     = useState<string[]>(["Sector 1"]);
  const [guardando,   setGuardando]   = useState(false);
  const [mensaje,     setMensaje]     = useState<{ texto: string; ok: boolean } | null>(null);
  const [cargado,     setCargado]     = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // ── Cargar trazado y sectores existentes ──────────────────
  useEffect(() => {
    getTrazadoActivo().then(c => { if (c) setTrazado(c); });

    supabase
      .from("sectores_pista")
      .select("*")
      .order("orden")
      .then(({ data }) => {
        if (data && data.length > 0) {
          // Los splits son los punto_inicio de todos los sectores excepto el primero
          const s = data.slice(1).map(r => r.punto_inicio);
          setSplits(s);
          setNombres(data.map(r => r.nombre));
        }
        setCargado(true);
      });
  }, []);

  // ── Proyección SVG ──────────────────────────────────────────
  const lats = trazado.map(c => c.lat);
  const lngs = trazado.map(c => c.lng);
  const minLat = trazado.length ? Math.min(...lats) : 0;
  const maxLat = trazado.length ? Math.max(...lats) : 1;
  const minLng = trazado.length ? Math.min(...lngs) : 0;
  const maxLng = trazado.length ? Math.max(...lngs) : 1;
  const dLat   = maxLat - minLat || 0.0001;
  const dLng   = maxLng - minLng || 0.0001;
  const scaleX = (W - PAD * 2) / dLng;
  const scaleY = (H - PAD * 2) / dLat;
  const scale  = Math.min(scaleX, scaleY);
  const offX   = (W - dLng * scale) / 2;
  const offY   = (H - dLat * scale) / 2;

  const toX   = (lng: number) => offX + (lng - minLng) * scale;
  const toY   = (lat: number) => H - offY - (lat - minLat) * scale;
  const toLng = (x: number)   => (x - offX) / scale + minLng;
  const toLat = (y: number)   => (H - y - offY) / scale + minLat;

  // Encuentra el índice del punto del trazado más cercano a un lat/lng
  const nearestIdx = useCallback((lat: number, lng: number) => {
    let minD = Infinity, idx = 0;
    for (let i = 0; i < trazado.length; i++) {
      const d = Math.hypot(trazado[i].lat - lat, trazado[i].lng - lng);
      if (d < minD) { minD = d; idx = i; }
    }
    return idx;
  }, [trazado]);

  // ── Manejo de clicks en el SVG ──────────────────────────────
  const handleSVGClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!trazado.length || !svgRef.current) return;
    const rect  = svgRef.current.getBoundingClientRect();
    const svgX  = ((e.clientX - rect.left)  / rect.width)  * W;
    const svgY  = ((e.clientY - rect.top)   / rect.height) * H;
    const clickLat = toLat(svgY);
    const clickLng = toLng(svgX);
    const idx   = nearestIdx(clickLat, clickLng);

    // No agregar en el inicio ni el final
    if (idx <= 2 || idx >= trazado.length - 3) return;
    // No duplicar
    if (splits.includes(idx)) return;

    const newSplits = [...splits, idx].sort((a, b) => a - b);
    setSplits(newSplits);

    // Agregar nombre para el nuevo sector
    const pos = newSplits.indexOf(idx); // posición del nuevo split
    const newNombres = [...nombres];
    newNombres.splice(pos + 1, 0, `Sector ${newSplits.length + 1}`);
    // Renumerar si tienen nombres default
    setNombres(newNombres.map((n, i) =>
      n.match(/^Sector \d+$/) ? `Sector ${i + 1}` : n
    ));
  };

  const removeSplit = (splitIdx: number) => {
    const pos       = splits.indexOf(splitIdx);
    const newSplits = splits.filter(p => p !== splitIdx);
    const newNombres = [...nombres];
    newNombres.splice(pos + 1, 1);
    setSplits(newSplits);
    setNombres(newNombres.map((n, i) =>
      n.match(/^Sector \d+$/) ? `Sector ${i + 1}` : n
    ));
  };

  // ── Derivar rangos de sectores ──────────────────────────────
  const sectorRanges: SectorRange[] = (() => {
    if (!trazado.length) return [];
    const boundaries = [0, ...splits, trazado.length - 1];
    return boundaries.slice(0, -1).map((inicio, i) => ({
      nombre: nombres[i] || `Sector ${i + 1}`,
      inicio,
      fin:    boundaries[i + 1],
      color:  COLORS[i % COLORS.length],
    }));
  })();

  // ── Path SVG de un sector ───────────────────────────────────
  const sectorPath = (inicio: number, fin: number) =>
    trazado.slice(inicio, fin + 1)
      .map((c, i) => `${i === 0 ? "M" : "L"} ${toX(c.lng).toFixed(1)} ${toY(c.lat).toFixed(1)}`)
      .join(" ");

  // ── Guardar en Supabase ─────────────────────────────────────
  const guardarSectores = async () => {
    if (!sectorRanges.length) return;
    setGuardando(true);
    try {
      // Borrar todos los sectores anteriores
      await supabase.from("sectores_pista").delete().gte("orden", 1);

      // Insertar los nuevos
      const rows = sectorRanges.map((r, i) => ({
        nombre:       r.nombre,
        orden:        i + 1,
        punto_inicio: r.inicio,
        punto_fin:    r.fin,
        bandera:      "verde",
      }));
      const { error } = await supabase.from("sectores_pista").insert(rows);
      if (error) throw error;

      setMensaje({ texto: `✅ ${rows.length} sectores guardados`, ok: true });
    } catch (err) {
      console.error(err);
      setMensaje({ texto: "❌ Error al guardar los sectores", ok: false });
    } finally {
      setGuardando(false);
      setTimeout(() => setMensaje(null), 3500);
    }
  };

  const limpiarSectores = () => {
    setSplits([]);
    setNombres(["Sector 1"]);
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Editor de sectores
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {trazado.length
              ? `${trazado.length} puntos cargados · Tocá el circuito para agregar un divisor`
              : "Cargando circuito..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {sectorRanges.length} {sectorRanges.length === 1 ? "sector" : "sectores"}
          </span>
        </div>
      </div>

      {/* SVG interactivo */}
      <div className="bg-gray-950 border border-gray-700 rounded-2xl overflow-hidden">
        {!trazado.length ? (
          <div className="py-16 text-center text-gray-600 text-sm">
            <p className="text-2xl mb-2">🗺</p>
            <p>Primero cargá el trazado KML en el editor de circuito</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full cursor-crosshair select-none"
            onClick={handleSVGClick}
          >
            {/* Fondo del trazado (gris) */}
            <path
              d={trazado.map((c, i) => `${i === 0 ? "M" : "L"} ${toX(c.lng).toFixed(1)} ${toY(c.lat).toFixed(1)}`).join(" ")}
              fill="none" stroke="#1f2937" strokeWidth="8"
              strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d={trazado.map((c, i) => `${i === 0 ? "M" : "L"} ${toX(c.lng).toFixed(1)} ${toY(c.lat).toFixed(1)}`).join(" ")}
              fill="none" stroke="#374151" strokeWidth="4"
              strokeLinecap="round" strokeLinejoin="round"
            />

            {/* Sectores coloreados */}
            {sectorRanges.map((r, i) => (
              <g key={i}>
                {/* Glow */}
                <path
                  d={sectorPath(r.inicio, r.fin)}
                  fill="none" stroke={r.color} strokeWidth="10"
                  strokeLinecap="round" strokeLinejoin="round" opacity="0.12"
                />
                {/* Línea */}
                <path
                  d={sectorPath(r.inicio, r.fin)}
                  fill="none" stroke={r.color} strokeWidth="3.5"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </g>
            ))}

            {/* Punto de inicio (meta) */}
            <circle
              cx={toX(trazado[0].lng)} cy={toY(trazado[0].lat)}
              r="6" fill="#22c55e"
            />
            <circle
              cx={toX(trazado[0].lng)} cy={toY(trazado[0].lat)}
              r="10" fill="none" stroke="#22c55e" strokeWidth="1.5" opacity="0.4"
            />

            {/* Divisores (puntos blancos, click para eliminar) */}
            {splits.map(idx => {
              const c = trazado[idx];
              const x = parseFloat(toX(c.lng).toFixed(1));
              const y = parseFloat(toY(c.lat).toFixed(1));
              return (
                <g
                  key={idx}
                  onClick={e => { e.stopPropagation(); removeSplit(idx); }}
                  className="cursor-pointer"
                >
                  <circle cx={x} cy={y} r="12" fill="white" opacity="0.08" />
                  <circle cx={x} cy={y} r="6"  fill="white" />
                  <text x={x} y={y - 12} textAnchor="middle" fill="#9ca3af" fontSize="8" fontWeight="bold">✕</text>
                </g>
              );
            })}

            {/* Etiquetas de sectores */}
            {sectorRanges.map((r, i) => {
              const midIdx = Math.floor((r.inicio + r.fin) / 2);
              const mc     = trazado[midIdx];
              return (
                <text
                  key={i}
                  x={toX(mc.lng)} y={toY(mc.lat) - 14}
                  textAnchor="middle"
                  fill={r.color}
                  fontSize="9" fontWeight="bold"
                >
                  {r.nombre}
                </text>
              );
            })}
          </svg>
        )}

        {/* Footer del editor */}
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-600 flex items-center justify-between">
          <span>Tocá el trazado para agregar un divisor</span>
          <span>Tocá ✕ blanco para eliminar</span>
        </div>
      </div>

      {/* Lista editable de sectores */}
      {sectorRanges.length > 1 && (
        <div className="space-y-2">
          {sectorRanges.map((r, i) => (
            <div key={i} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-2.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: r.color }} />
              <input
                type="text"
                value={nombres[i] ?? `Sector ${i + 1}`}
                onChange={e => {
                  const n = [...nombres];
                  n[i]   = e.target.value;
                  setNombres(n);
                }}
                className="flex-1 bg-transparent text-white text-sm font-medium focus:outline-none border-b border-transparent focus:border-gray-600 transition-colors"
                placeholder={`Sector ${i + 1}`}
              />
              <span className="text-xs text-gray-700 tabular-nums">
                {r.fin - r.inicio} pts
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Botones de acción */}
      <div className="flex gap-3">
        <button
          onClick={guardarSectores}
          disabled={guardando || sectorRanges.length < 2}
          className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
        >
          {guardando ? "Guardando..." : `Guardar ${sectorRanges.length} sectores`}
        </button>
        {splits.length > 0 && (
          <button
            onClick={limpiarSectores}
            className="px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-xl text-sm transition-colors"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Feedback */}
      {mensaje && (
        <p className={`text-sm text-center font-medium ${mensaje.ok ? "text-green-400" : "text-red-400"}`}>
          {mensaje.texto}
        </p>
      )}

      {/* Instrucciones */}
      {cargado && trazado.length > 0 && splits.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 text-xs text-gray-500 space-y-1">
          <p className="font-semibold text-gray-400">¿Cómo usar?</p>
          <p>1. Tocá cualquier punto del trazado para agregar un divisor de sector.</p>
          <p>2. Cada divisor crea un nuevo sector entre colores.</p>
          <p>3. Renombrá los sectores haciendo click en su nombre.</p>
          <p>4. Tocá Guardar cuando estés conforme.</p>
        </div>
      )}
    </div>
  );
}

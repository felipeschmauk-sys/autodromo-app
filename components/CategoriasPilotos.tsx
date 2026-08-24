"use client";

/**
 * CategoriasPilotos.tsx — components/CategoriasPilotos.tsx
 *
 * Categorías de pilotos y su asignación. Vive dentro de la pestaña Pilotos.
 *
 * Un piloto compite contra los de SU categoría: uno de una categoría más rápida
 * no debe empujarlo hacia abajo en la tabla de tiempos. Donde SÍ se mezclan
 * todas es en la diferencia con el auto de adelante y de atrás, y en la bandera
 * azul.
 *
 * El piloto sin categoría queda en lista de espera. No tiene posición ni
 * diferencias, pero opera con normalidad en pista: banderas y seguridad siguen
 * funcionando para él.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Categoria { id: string; nombre: string; orden: number }
interface PilotoLite { id: string; nombre: string; numero: string | null; categoria_id: string | null }

export default function CategoriasPilotos() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [pilotos, setPilotos]       = useState<PilotoLite[]>([]);
  const [nueva, setNueva]           = useState("");
  const [cargando, setCargando]     = useState(true);
  const [guardando, setGuardando]   = useState<string | null>(null);
  const [abierto, setAbierto]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [filtro, setFiltro]         = useState("");

  const cargar = useCallback(async () => {
    const [cats, pils] = await Promise.all([
      supabase.from("categorias").select("id, nombre, orden").order("orden").order("nombre"),
      supabase.from("pilotos").select("id, nombre, numero, categoria_id").order("nombre"),
    ]);
    // Migración sin correr: la sección se anuncia y no rompe el resto del panel
    if (cats.error) { setError("migracion"); setCargando(false); return; }
    setCategorias((cats.data ?? []) as Categoria[]);
    setPilotos((pils.data ?? []) as PilotoLite[]);
    setError(null);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    const nombre = nueva.trim();
    if (!nombre) return;
    setGuardando("nueva");
    await supabase.from("categorias").insert({ nombre, orden: categorias.length });
    setNueva("");
    await cargar();
    setGuardando(null);
  };

  const renombrar = async (id: string, nombre: string) => {
    const limpio = nombre.trim();
    if (!limpio) return;
    await supabase.from("categorias").update({ nombre: limpio }).eq("id", id);
    setCategorias(prev => prev.map(c => (c.id === id ? { ...c, nombre: limpio } : c)));
  };

  const eliminar = async (id: string) => {
    // Los pilotos asignados vuelven a la lista de espera (ON DELETE SET NULL)
    setGuardando(id);
    await supabase.from("categorias").delete().eq("id", id);
    await cargar();
    setGuardando(null);
  };

  const asignar = async (pilotoId: string, categoriaId: string | null) => {
    setGuardando(pilotoId);
    await supabase.from("pilotos").update({ categoria_id: categoriaId }).eq("id", pilotoId);
    setPilotos(prev => prev.map(p => (p.id === pilotoId ? { ...p, categoria_id: categoriaId } : p)));
    setGuardando(null);
  };

  const sinCategoria = pilotos.filter(p => !p.categoria_id);
  const visibles = filtro.trim()
    ? pilotos.filter(p => p.nombre.toLowerCase().includes(filtro.trim().toLowerCase()))
    : pilotos;
  const cuenta = (id: string) => pilotos.filter(p => p.categoria_id === id).length;

  if (error === "migracion") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
        <p className="text-sm font-semibold text-amber-800">Categorías sin habilitar</p>
        <p className="text-xs text-amber-700 mt-1">
          Falta correr <code className="font-mono">docs/task-categorias-migration.sql</code> en Supabase.
          Mientras tanto todo lo demás funciona igual.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setAbierto(v => !v)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Categorías</p>
          {!cargando && (
            <span className="text-xs text-gray-400">
              {categorias.length} · {sinCategoria.length} sin asignar
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{abierto ? "▾" : "▸"}</span>
      </button>

      {abierto && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-gray-100">
          {/* ── Crear y administrar categorías ── */}
          <div>
            <div className="flex gap-2">
              <input
                value={nueva}
                onChange={e => setNueva(e.target.value)}
                onKeyDown={e => e.key === "Enter" && crear()}
                placeholder="Nombre de la categoría"
                className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={crear}
                disabled={!nueva.trim() || guardando === "nueva"}
                className="text-sm font-semibold bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                + Agregar
              </button>
            </div>

            {categorias.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {categorias.map(c => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      defaultValue={c.nombre}
                      onBlur={e => renombrar(c.id, e.target.value)}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">
                      {cuenta(c.id)} piloto{cuenta(c.id) === 1 ? "" : "s"}
                    </span>
                    <button
                      onClick={() => eliminar(c.id)}
                      disabled={guardando === c.id}
                      title="Eliminar. Los pilotos asignados vuelven a la lista de espera."
                      className="text-xs border border-red-100 text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition flex-shrink-0"
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Asignación ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Asignar pilotos
              </p>
              <input
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                placeholder="Buscar…"
                className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            {sinCategoria.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                {sinCategoria.length} piloto{sinCategoria.length === 1 ? "" : "s"} en lista de espera.
                Pueden salir a pista con normalidad, pero no tendrán posición ni diferencias con otros autos.
              </p>
            )}

            <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {visibles.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-xs font-bold text-gray-400 w-9 flex-shrink-0">{p.numero || "—"}</span>
                  <span className="flex-1 min-w-0 text-sm text-gray-900 truncate">{p.nombre}</span>
                  <select
                    value={p.categoria_id ?? ""}
                    disabled={guardando === p.id}
                    onChange={e => asignar(p.id, e.target.value || null)}
                    className={`border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 flex-shrink-0 ${
                      p.categoria_id ? "border-gray-200 text-gray-900" : "border-amber-300 text-amber-700 bg-amber-50"
                    }`}
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
              ))}
              {visibles.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-4 text-center">Sin pilotos que coincidan</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

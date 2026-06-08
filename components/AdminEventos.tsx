"use client";
/**
 * AdminEventos.tsx — components/AdminEventos.tsx
 *
 * Gestión de campeonatos, fechas e inscripciones.
 * Bloque 1 — sin funcionalidad de pago real aún.
 */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// ── Tipos ──────────────────────────────────────────────────────
interface Campeonato {
  id: string;
  nombre: string;
  temporada: number;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

interface FechaEvento {
  id: string;
  campeonato_id: string;
  nombre: string;
  numero_fecha: number | null;
  fecha_evento: string;
  autodromo: string | null;
  trazado: string | null;
  cupos_max: number;
  estado: "borrador" | "abierto" | "cerrado" | "finalizado";
  descripcion: string | null;
}

interface Inscripcion {
  id: string;
  piloto_id: string;
  fecha_id: string;
  estado: "solicitado" | "inscrito" | "confirmado" | "en_pista" | "rechazado" | "no_presentado";
  pago_estado: "pendiente" | "confirmado_admin" | "pagado_app" | "devuelto";
  pago_confirmado_at: string | null;
  notas_admin: string | null;
  created_at: string;
  pilotos?: { nombre: string; telefono: string } | null;
}

// ── Config visual ──────────────────────────────────────────────
const ESTADO_INSC: Record<string, { label: string; color: string; bg: string }> = {
  solicitado:     { label: "Solicitado",      color: "text-amber-600",  bg: "bg-amber-50 border-amber-200"  },
  inscrito:       { label: "Inscrito",        color: "text-blue-600",   bg: "bg-blue-50 border-blue-200"    },
  confirmado:     { label: "Confirmado",      color: "text-green-700",  bg: "bg-green-50 border-green-200"  },
  en_pista:       { label: "En pista",        color: "text-green-600",  bg: "bg-green-100 border-green-300" },
  rechazado:      { label: "Rechazado",       color: "text-red-600",    bg: "bg-red-50 border-red-200"      },
  no_presentado:  { label: "No se presentó", color: "text-gray-500",   bg: "bg-gray-50 border-gray-200"    },
};

const ESTADO_FECHA: Record<string, { label: string; dot: string }> = {
  borrador:   { label: "Borrador",    dot: "bg-gray-400"   },
  abierto:    { label: "Inscripciones abiertas", dot: "bg-green-500" },
  cerrado:    { label: "Cerrado",     dot: "bg-amber-500"  },
  finalizado: { label: "Finalizado",  dot: "bg-gray-600"   },
};

const PAGO_BADGE: Record<string, { label: string; color: string }> = {
  pendiente:        { label: "Pago pendiente",  color: "text-amber-600" },
  confirmado_admin: { label: "Pago confirmado", color: "text-green-600" },
  pagado_app:       { label: "Pagado (app)",    color: "text-green-600" },
  devuelto:         { label: "Devuelto",        color: "text-red-500"   },
};

// ── Componente principal ───────────────────────────────────────
export default function AdminEventos() {
  const [campeonatos, setCampeonatos]         = useState<Campeonato[]>([]);
  const [fechas, setFechas]                   = useState<FechaEvento[]>([]);
  const [inscripciones, setInscripciones]     = useState<Inscripcion[]>([]);
  const [selectedCamp, setSelectedCamp]       = useState<string | null>(null);
  const [selectedFecha, setSelectedFecha]     = useState<string | null>(null);
  const [view, setView]                       = useState<"campeonatos" | "fechas" | "inscripciones">("campeonatos");
  const [showFormCamp, setShowFormCamp]       = useState(false);
  const [showFormFecha, setShowFormFecha]     = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [notasModal, setNotasModal]           = useState<{ id: string; notas: string } | null>(null);

  // Formulario campeonato
  const [fNombre, setFNombre]         = useState("");
  const [fTemporada, setFTemporada]   = useState(2026);
  const [fDescCamp, setFDescCamp]     = useState("");

  // Formulario fecha
  const [ffNombre, setFfNombre]       = useState("");
  const [ffNumero, setFfNumero]       = useState("");
  const [ffFecha, setFfFecha]         = useState("");
  const [ffAutodromo, setFfAutodromo] = useState("");
  const [ffTrazado, setFfTrazado]     = useState("");
  const [ffCupos, setFfCupos]         = useState("30");
  const [ffEstado, setFfEstado]       = useState<"borrador" | "abierto">("borrador");
  const [ffDesc, setFfDesc]           = useState("");

  // ── Loaders ───────────────────────────────────────────────────
  const loadCampeonatos = useCallback(async () => {
    const { data } = await supabase
      .from("campeonatos").select("*").order("temporada", { ascending: false });
    setCampeonatos(data || []);
  }, []);

  const loadFechas = useCallback(async (campId: string) => {
    const { data } = await supabase
      .from("fechas_evento").select("*")
      .eq("campeonato_id", campId)
      .order("fecha_evento");
    setFechas(data || []);
  }, []);

  const loadInscripciones = useCallback(async (fechaId: string) => {
    const { data } = await supabase
      .from("inscripciones")
      .select("*, pilotos(nombre, telefono)")
      .eq("fecha_id", fechaId)
      .order("created_at");
    setInscripciones((data || []) as Inscripcion[]);
  }, []);

  useEffect(() => { loadCampeonatos(); }, [loadCampeonatos]);

  // ── Acciones campeonato ────────────────────────────────────────
  const crearCampeonato = async () => {
    if (!fNombre.trim()) return;
    setSaving(true);
    await supabase.from("campeonatos").insert({
      nombre: fNombre.trim(), temporada: fTemporada,
      descripcion: fDescCamp.trim() || null,
    });
    setShowFormCamp(false); setFNombre(""); setFDescCamp("");
    await loadCampeonatos();
    setSaving(false);
  };

  const toggleCampeonato = async (id: string, activo: boolean) => {
    await supabase.from("campeonatos").update({ activo: !activo }).eq("id", id);
    loadCampeonatos();
  };

  const abrirFechas = (campId: string) => {
    setSelectedCamp(campId);
    loadFechas(campId);
    setView("fechas");
  };

  // ── Acciones fecha ─────────────────────────────────────────────
  const crearFecha = async () => {
    if (!ffNombre.trim() || !ffFecha || !selectedCamp) return;
    setSaving(true);
    await supabase.from("fechas_evento").insert({
      campeonato_id: selectedCamp,
      nombre:        ffNombre.trim(),
      numero_fecha:  ffNumero ? parseInt(ffNumero) : null,
      fecha_evento:  ffFecha,
      autodromo:     ffAutodromo.trim() || null,
      trazado:       ffTrazado.trim() || null,
      cupos_max:     parseInt(ffCupos) || 30,
      estado:        ffEstado,
      descripcion:   ffDesc.trim() || null,
    });
    setShowFormFecha(false);
    setFfNombre(""); setFfNumero(""); setFfFecha("");
    setFfAutodromo(""); setFfTrazado(""); setFfCupos("30"); setFfDesc("");
    await loadFechas(selectedCamp);
    setSaving(false);
  };

  const cambiarEstadoFecha = async (id: string, estado: string) => {
    await supabase.from("fechas_evento").update({ estado }).eq("id", id);
    if (selectedCamp) loadFechas(selectedCamp);
  };

  const abrirInscripciones = (fechaId: string) => {
    setSelectedFecha(fechaId);
    loadInscripciones(fechaId);
    setView("inscripciones");
  };

  // ── Acciones inscripción ───────────────────────────────────────
  const cambiarEstadoInsc = async (id: string, estado: string) => {
    await supabase.from("inscripciones").update({ estado }).eq("id", id);
    if (selectedFecha) loadInscripciones(selectedFecha);
  };

  const confirmarPago = async (id: string) => {
    await supabase.from("inscripciones").update({
      pago_estado: "confirmado_admin",
      pago_confirmado_at: new Date().toISOString(),
    }).eq("id", id);
    if (selectedFecha) loadInscripciones(selectedFecha);
  };

  const guardarNotas = async () => {
    if (!notasModal) return;
    await supabase.from("inscripciones")
      .update({ notas_admin: notasModal.notas }).eq("id", notasModal.id);
    setNotasModal(null);
    if (selectedFecha) loadInscripciones(selectedFecha);
  };

  // ── Helpers ────────────────────────────────────────────────────
  const campActual   = campeonatos.find(c => c.id === selectedCamp);
  const fechaActual  = fechas.find(f => f.id === selectedFecha);
  const cuposUsados  = inscripciones.filter(i =>
    ["inscrito","confirmado","en_pista"].includes(i.estado)
  ).length;
  const solicitados  = inscripciones.filter(i => i.estado === "solicitado").length;

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white";
  const labelCls = "text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block";

  // ════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setView("campeonatos")}
          className={`font-medium transition ${view === "campeonatos" ? "text-indigo-700" : "text-gray-400 hover:text-gray-700"}`}
        >
          Campeonatos
        </button>
        {view !== "campeonatos" && campActual && (
          <>
            <span className="text-gray-300">›</span>
            <button
              onClick={() => setView("fechas")}
              className={`font-medium transition ${view === "fechas" ? "text-indigo-700" : "text-gray-400 hover:text-gray-700"}`}
            >
              {campActual.nombre}
            </button>
          </>
        )}
        {view === "inscripciones" && fechaActual && (
          <>
            <span className="text-gray-300">›</span>
            <span className="font-medium text-indigo-700">{fechaActual.nombre}</span>
          </>
        )}
      </div>

      {/* ════ VISTA: CAMPEONATOS ════ */}
      {view === "campeonatos" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {campeonatos.length} campeonato{campeonatos.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={() => setShowFormCamp(!showFormCamp)}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              + Nuevo campeonato
            </button>
          </div>

          {/* Formulario nuevo campeonato */}
          {showFormCamp && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-indigo-800">Nuevo campeonato</p>
              <div>
                <label className={labelCls}>Nombre *</label>
                <input value={fNombre} onChange={e => setFNombre(e.target.value)}
                  placeholder="ej. Turismo Carretera Chileno" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Temporada</label>
                  <input type="number" value={fTemporada} onChange={e => setFTemporada(parseInt(e.target.value))}
                    className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Descripción</label>
                <input value={fDescCamp} onChange={e => setFDescCamp(e.target.value)}
                  placeholder="Descripción opcional" className={inputCls} />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowFormCamp(false)}
                  className="text-sm border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={crearCampeonato} disabled={saving || !fNombre.trim()}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
                  {saving ? "Guardando…" : "Crear campeonato"}
                </button>
              </div>
            </div>
          )}

          {/* Lista campeonatos */}
          {campeonatos.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">🏆</div>
              <p className="text-sm">Aún no hay campeonatos creados</p>
            </div>
          ) : (
            <div className="space-y-2">
              {campeonatos.map(c => (
                <div key={c.id}
                  className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.nombre}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                        c.activo ? "bg-green-50 text-green-700 border-green-200"
                                 : "bg-gray-100 text-gray-400 border-gray-200"
                      }`}>
                        {c.activo ? "Activo" : "Inactivo"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">Temporada {c.temporada}{c.descripcion ? ` · ${c.descripcion}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => toggleCampeonato(c.id, c.activo)}
                      className="text-xs border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition text-gray-500">
                      {c.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button onClick={() => abrirFechas(c.id)}
                      className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition">
                      Ver fechas →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════ VISTA: FECHAS ════ */}
      {view === "fechas" && selectedCamp && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">
              {fechas.length} fecha{fechas.length !== 1 ? "s" : ""}
            </p>
            <button onClick={() => setShowFormFecha(!showFormFecha)}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition">
              + Nueva fecha
            </button>
          </div>

          {/* Formulario nueva fecha */}
          {showFormFecha && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-indigo-800">Nueva fecha / evento</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Nombre del evento *</label>
                  <input value={ffNombre} onChange={e => setFfNombre(e.target.value)}
                    placeholder="ej. Fecha 3 – Las Vizcachas" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>N° de fecha</label>
                  <input type="number" value={ffNumero} onChange={e => setFfNumero(e.target.value)}
                    placeholder="3" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Fecha del evento *</label>
                  <input type="date" value={ffFecha} onChange={e => setFfFecha(e.target.value)}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Autódromo</label>
                  <input value={ffAutodromo} onChange={e => setFfAutodromo(e.target.value)}
                    placeholder="ej. Las Vizcachas" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Trazado</label>
                  <input value={ffTrazado} onChange={e => setFfTrazado(e.target.value)}
                    placeholder="Pista larga / Pista corta" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Cupos máximos</label>
                  <input type="number" value={ffCupos} onChange={e => setFfCupos(e.target.value)}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Estado inicial</label>
                  <select value={ffEstado} onChange={e => setFfEstado(e.target.value as any)}
                    className={inputCls}>
                    <option value="borrador">Borrador</option>
                    <option value="abierto">Abrir inscripciones</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Descripción</label>
                  <input value={ffDesc} onChange={e => setFfDesc(e.target.value)}
                    placeholder="Información adicional del evento" className={inputCls} />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowFormFecha(false)}
                  className="text-sm border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button onClick={crearFecha} disabled={saving || !ffNombre.trim() || !ffFecha}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
                  {saving ? "Guardando…" : "Crear fecha"}
                </button>
              </div>
            </div>
          )}

          {/* Lista fechas */}
          {fechas.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📅</div>
              <p className="text-sm">Aún no hay fechas en este campeonato</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fechas.map(f => {
                const ef = ESTADO_FECHA[f.estado];
                return (
                  <div key={f.id} className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{f.nombre}</p>
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <span className={`w-1.5 h-1.5 rounded-full ${ef.dot}`} />
                            {ef.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(f.fecha_evento + "T12:00:00").toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
                          {f.autodromo ? ` · ${f.autodromo}` : ""}
                          {f.trazado ? ` · ${f.trazado}` : ""}
                          {` · ${f.cupos_max} cupos`}
                        </p>
                      </div>
                      <button onClick={() => abrirInscripciones(f.id)}
                        className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition flex-shrink-0">
                        Inscripciones →
                      </button>
                    </div>
                    {/* Cambio de estado rápido */}
                    <div className="flex gap-1.5 flex-wrap">
                      {(["borrador","abierto","cerrado","finalizado"] as const).map(est => (
                        <button key={est} onClick={() => cambiarEstadoFecha(f.id, est)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition font-medium ${
                            f.estado === est
                              ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                              : "border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600"
                          }`}>
                          {ESTADO_FECHA[est].label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════ VISTA: INSCRIPCIONES ════ */}
      {view === "inscripciones" && selectedFecha && fechaActual && (
        <div className="space-y-3">
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Solicitados", val: solicitados,   color: "text-amber-600" },
              { label: "Confirmados", val: inscripciones.filter(i => i.estado === "confirmado").length, color: "text-green-700" },
              { label: `Cupos ${cuposUsados}/${fechaActual.cupos_max}`, val: fechaActual.cupos_max - cuposUsados, color: cuposUsados >= fechaActual.cupos_max ? "text-red-600" : "text-gray-700" },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.val}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Lista inscripciones */}
          {inscripciones.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">Aún no hay solicitudes de inscripción</p>
            </div>
          ) : (
            <div className="space-y-2">
              {inscripciones.map(insc => {
                const ei  = ESTADO_INSC[insc.estado];
                const ep  = PAGO_BADGE[insc.pago_estado];
                const nombre   = (insc.pilotos as any)?.nombre    || "Piloto";
                const telefono = (insc.pilotos as any)?.telefono || "";
                return (
                  <div key={insc.id} className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 space-y-3">
                    {/* Header piloto */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{nombre}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ei.bg} ${ei.color}`}>
                            {ei.label}
                          </span>
                          {insc.estado !== "rechazado" && (
                            <span className={`text-xs font-medium ${ep.color}`}>
                              · {ep.label}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {telefono} · Solicitó el {new Date(insc.created_at).toLocaleDateString("es-CL")}
                        </p>
                        {insc.notas_admin && (
                          <p className="text-xs text-indigo-600 mt-1 italic">"{insc.notas_admin}"</p>
                        )}
                      </div>
                    </div>

                    {/* Acciones según estado */}
                    <div className="flex gap-2 flex-wrap">

                      {/* Solicitud pendiente → aprobar o rechazar */}
                      {insc.estado === "solicitado" && (
                        <>
                          <button onClick={() => cambiarEstadoInsc(insc.id, "inscrito")}
                            className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-green-700 transition">
                            ✓ Aprobar solicitud
                          </button>
                          <button onClick={() => cambiarEstadoInsc(insc.id, "rechazado")}
                            className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded-lg font-semibold hover:bg-red-50 transition">
                            ✕ Rechazar
                          </button>
                        </>
                      )}

                      {/* Inscrito → confirmar pago */}
                      {insc.estado === "inscrito" && insc.pago_estado === "pendiente" && (
                        <button onClick={() => confirmarPago(insc.id)}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-700 transition">
                          💳 Confirmar pago
                        </button>
                      )}

                      {/* Inscrito con pago confirmado → habilitar para competir */}
                      {insc.estado === "inscrito" && insc.pago_estado === "confirmado_admin" && (
                        <button onClick={() => cambiarEstadoInsc(insc.id, "confirmado")}
                          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-green-700 transition">
                          ✓ Habilitar para competir
                        </button>
                      )}

                      {/* Pago — placeholder visual (futura integración) */}
                      {insc.estado === "inscrito" && insc.pago_estado === "pendiente" && (
                        <button disabled
                          className="text-xs border border-gray-200 text-gray-400 px-3 py-1.5 rounded-lg cursor-not-allowed opacity-60">
                          💳 Pago en app (próximamente)
                        </button>
                      )}

                      {/* Notas internas */}
                      <button onClick={() => setNotasModal({ id: insc.id, notas: insc.notas_admin || "" })}
                        className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
                        📝 Notas
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modal notas ── */}
      {notasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setNotasModal(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl space-y-3"
            onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900">Notas internas del admin</p>
            <textarea
              value={notasModal.notas}
              onChange={e => setNotasModal({ ...notasModal, notas: e.target.value })}
              placeholder="Visible solo para el admin. Ej: pendiente transferencia, contactar por WhatsApp..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setNotasModal(null)}
                className="text-sm border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">
                Cancelar
              </button>
              <button onClick={guardarNotas}
                className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 transition">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

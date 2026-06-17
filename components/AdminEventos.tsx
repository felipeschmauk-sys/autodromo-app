"use client";
/**
 * AdminEventos.tsx — components/AdminEventos.tsx
 *
 * Gestión de campeonatos, fechas e inscripciones.
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
  estado: "borrador" | "abierto" | "finalizado";
  tipo: "racing" | "track_day" | "entrenamiento";
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
  borrador:   { label: "Borrador",              dot: "bg-gray-400"  },
  abierto:    { label: "Inscripciones abiertas", dot: "bg-green-500" },
  finalizado: { label: "Finalizado",            dot: "bg-gray-600"  },
};

const PAGO_BADGE: Record<string, { label: string; color: string }> = {
  pendiente:        { label: "Pago pendiente",  color: "text-amber-600" },
  confirmado_admin: { label: "Pago confirmado", color: "text-green-600" },
  pagado_app:       { label: "Pagado (app)",    color: "text-green-600" },
  devuelto:         { label: "Devuelto",        color: "text-red-500"   },
};

interface AdminEventosProps {
  contextoFechaId?: string | null;
  onContextoCambia?: () => void;
}

const TIPO_EVENTO_OPTS = [
  { value: "racing",        label: "Racing (carrera)" },
  { value: "track_day",     label: "Track Day" },
  { value: "entrenamiento", label: "Entrenamiento" },
];

// ── Componente principal ───────────────────────────────────────
export default function AdminEventos({ contextoFechaId, onContextoCambia }: AdminEventosProps) {
  const [campeonatos, setCampeonatos]     = useState<Campeonato[]>([]);
  const [fechas, setFechas]               = useState<FechaEvento[]>([]);
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [selectedCamp, setSelectedCamp]   = useState<string | null>(null);
  const [selectedFecha, setSelectedFecha] = useState<string | null>(null);
  const [view, setView]                   = useState<"campeonatos" | "fechas" | "inscripciones">("campeonatos");
  const [saving, setSaving]               = useState(false);
  const [notasModal, setNotasModal]       = useState<{ id: string; notas: string } | null>(null);

  // ── Formulario campeonato (nuevo + editar) ─────────────────
  const [showFormCamp, setShowFormCamp]   = useState(false);
  const [editingCampId, setEditingCampId] = useState<string | null>(null);
  const [fNombre, setFNombre]             = useState("");
  const [fTemporada, setFTemporada]       = useState(2026);
  const [fDescCamp, setFDescCamp]         = useState("");

  // ── Confirmación de borrado ────────────────────────────────
  const [confirmDeleteCampId,  setConfirmDeleteCampId]  = useState<string | null>(null);
  const [confirmDeleteFechaId, setConfirmDeleteFechaId] = useState<string | null>(null);

  // ── Formulario fecha (nuevo + editar) ──────────────────────
  const [showFormFecha, setShowFormFecha]   = useState(false);
  const [editingFechaId, setEditingFechaId] = useState<string | null>(null);
  const [ffNombre, setFfNombre]             = useState("");
  const [ffNumero, setFfNumero]             = useState("");
  const [ffFecha, setFfFecha]               = useState("");
  const [ffAutodromo, setFfAutodromo]       = useState("");
  const [ffTrazado, setFfTrazado]           = useState("");
  const [ffCupos, setFfCupos]               = useState("30");
  const [ffEstado, setFfEstado]             = useState<"borrador" | "abierto" | "finalizado">("borrador");
  const [ffTipo, setFfTipo]                 = useState<"racing" | "track_day" | "entrenamiento">("racing");
  const [ffDesc, setFfDesc]                 = useState("");

  // ── Loaders ────────────────────────────────────────────────
  const loadCampeonatos = useCallback(async () => {
    const { data } = await supabase
      .from("campeonatos").select("*").order("created_at", { ascending: false });
    setCampeonatos(data || []);
  }, []);

  const loadFechas = useCallback(async (campId: string) => {
    const { data } = await supabase
      .from("fechas_evento").select("*")
      .eq("campeonato_id", campId)
      .order("fecha_evento");

    const hoy = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

    // Auto-finalizar fechas cuyo día ya pasó y aún no están marcadas como finalizadas
    const vencidas = (data || []).filter(
      f => f.fecha_evento < hoy && f.estado !== "finalizado"
    );
    if (vencidas.length > 0) {
      await Promise.all(
        vencidas.map(f =>
          supabase.from("fechas_evento").update({ estado: "finalizado" }).eq("id", f.id)
        )
      );
      // Recargar con estados actualizados
      const { data: refresh } = await supabase
        .from("fechas_evento").select("*")
        .eq("campeonato_id", campId)
        .order("fecha_evento");
      setFechas(refresh || []);
    } else {
      setFechas(data || []);
    }
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

  // ── Helpers formulario ─────────────────────────────────────
  const resetFormCamp = () => {
    setFNombre(""); setFTemporada(2026); setFDescCamp("");
    setEditingCampId(null); setShowFormCamp(false);
  };

  const resetFormFecha = () => {
    setFfNombre(""); setFfNumero(""); setFfFecha("");
    setFfAutodromo(""); setFfTrazado(""); setFfCupos("30");
    setFfTipo("racing"); setFfEstado("borrador"); setFfDesc("");
    setEditingFechaId(null); setShowFormFecha(false);
  };

  // ── Acciones campeonato ────────────────────────────────────
  const abrirNuevoCamp = () => {
    resetFormCamp();
    setShowFormCamp(true);
  };

  const abrirEditarCamp = (c: Campeonato) => {
    setFNombre(c.nombre);
    setFTemporada(c.temporada);
    setFDescCamp(c.descripcion || "");
    setEditingCampId(c.id);
    setShowFormCamp(true);
  };

  const guardarCampeonato = async () => {
    if (!fNombre.trim()) return;
    setSaving(true);
    const payload = {
      nombre: fNombre.trim(),
      temporada: fTemporada,
      descripcion: fDescCamp.trim() || null,
    };
    if (editingCampId) {
      await supabase.from("campeonatos").update(payload).eq("id", editingCampId);
    } else {
      await supabase.from("campeonatos").insert(payload);
    }
    resetFormCamp();
    await loadCampeonatos();
    setSaving(false);
  };

  const toggleCampeonato = async (id: string, activo: boolean) => {
    await supabase.from("campeonatos").update({ activo: !activo }).eq("id", id);
    loadCampeonatos();
  };

  const eliminarCampeonato = async (id: string) => {
    await supabase.from("campeonatos").delete().eq("id", id);
    setConfirmDeleteCampId(null);
    if (selectedCamp === id) { setSelectedCamp(null); setView("campeonatos"); }
    await loadCampeonatos();
  };

  const abrirFechas = (campId: string) => {
    setSelectedCamp(campId);
    loadFechas(campId);
    setView("fechas");
  };

  // ── Acciones fecha ─────────────────────────────────────────
  const abrirNuevaFecha = () => {
    resetFormFecha();
    setShowFormFecha(true);
  };

  const abrirEditarFecha = (f: FechaEvento) => {
    setFfNombre(f.nombre);
    setFfNumero(f.numero_fecha?.toString() || "");
    setFfFecha(f.fecha_evento);
    setFfAutodromo(f.autodromo || "");
    setFfTrazado(f.trazado || "");
    setFfCupos(f.cupos_max.toString());
    setFfEstado(f.estado === "finalizado" ? "finalizado" : f.estado);
    setFfTipo(f.tipo);
    setFfDesc(f.descripcion || "");
    setEditingFechaId(f.id);
    setShowFormFecha(true);
  };

  const guardarFecha = async () => {
    if (!ffNombre.trim() || !ffFecha || !selectedCamp) return;
    setSaving(true);
    const payload = {
      campeonato_id: selectedCamp,
      nombre:        ffNombre.trim(),
      numero_fecha:  ffNumero ? parseInt(ffNumero) : null,
      fecha_evento:  ffFecha,
      autodromo:     ffAutodromo.trim() || null,
      trazado:       ffTrazado.trim() || null,
      cupos_max:     parseInt(ffCupos) || 30,
      estado:        ffEstado,
      tipo:          ffTipo,
      descripcion:   ffDesc.trim() || null,
    };
    if (editingFechaId) {
      await supabase.from("fechas_evento").update(payload).eq("id", editingFechaId);
    } else {
      await supabase.from("fechas_evento").insert(payload);
    }
    if (onContextoCambia) onContextoCambia();
    resetFormFecha();
    await loadFechas(selectedCamp);
    setSaving(false);
  };

  const eliminarFecha = async (id: string) => {
    await supabase.from("fechas_evento").delete().eq("id", id);
    setConfirmDeleteFechaId(null);
    if (selectedCamp) loadFechas(selectedCamp);
    if (onContextoCambia) onContextoCambia();
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

  // ── Acciones inscripción ───────────────────────────────────
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

  // ── Helpers UI ─────────────────────────────────────────────
  const campActual  = campeonatos.find(c => c.id === selectedCamp);
  const fechaActual = fechas.find(f => f.id === selectedFecha);
  const cuposUsados = inscripciones.filter(i =>
    ["inscrito","confirmado","en_pista"].includes(i.estado)
  ).length;
  const solicitados = inscripciones.filter(i => i.estado === "solicitado").length;

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white";
  const labelCls = "text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 block";

  const campsActivos   = campeonatos.filter(c =>  c.activo);
  const campsInactivos = campeonatos.filter(c => !c.activo);

  // ── Formulario campeonato (nuevo + editar) JSX ─────────────
  const formCampJSX = showFormCamp && (
    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-indigo-800">
        {editingCampId ? "Editar campeonato" : "Nuevo campeonato"}
      </p>
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
        <button onClick={resetFormCamp}
          className="text-sm border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">
          Cancelar
        </button>
        <button onClick={guardarCampeonato} disabled={saving || !fNombre.trim()}
          className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
          {saving ? "Guardando…" : editingCampId ? "Guardar cambios" : "Crear campeonato"}
        </button>
      </div>
    </div>
  );

  // ── Formulario fecha (nuevo + editar) JSX ─────────────────
  const formFechaJSX = showFormFecha && (
    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
      <p className="text-sm font-semibold text-indigo-800">
        {editingFechaId ? "Editar fecha / evento" : "Nueva fecha / evento"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelCls}>Nombre del evento *</label>
          <input value={ffNombre} onChange={e => setFfNombre(e.target.value)}
            placeholder="ej. Fecha 3 – Nombre del evento" className={inputCls} />
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
            placeholder="ej. Nombre del autódromo" className={inputCls} />
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
          <label className={labelCls}>Tipo de evento</label>
          <select value={ffTipo} onChange={e => setFfTipo(e.target.value as any)} className={inputCls}>
            {TIPO_EVENTO_OPTS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Estado</label>
          <select value={ffEstado} onChange={e => setFfEstado(e.target.value as any)} className={inputCls}>
            <option value="borrador">Borrador</option>
            <option value="abierto">Inscripciones abiertas</option>
            <option value="finalizado">Finalizado</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Descripción</label>
          <input value={ffDesc} onChange={e => setFfDesc(e.target.value)}
            placeholder="Información adicional del evento" className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={resetFormFecha}
          className="text-sm border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50 transition">
          Cancelar
        </button>
        <button onClick={guardarFecha} disabled={saving || !ffNombre.trim() || !ffFecha}
          className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
          {saving ? "Guardando…" : editingFechaId ? "Guardar cambios" : "Crear fecha"}
        </button>
      </div>
    </div>
  );

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
              onClick={abrirNuevoCamp}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition"
            >
              + Nuevo campeonato
            </button>
          </div>

          {formCampJSX}

          {campeonatos.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">🏆</div>
              <p className="text-sm">Aún no hay campeonatos creados</p>
            </div>
          ) : (
            <div className="space-y-4">

              {/* Campeonatos activos */}
              {campsActivos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1">Activos</p>
                  {campsActivos.map(c => (
                    <CampeonatoCard
                      key={c.id}
                      c={c}
                      confirmDeleteId={confirmDeleteCampId}
                      onEditar={abrirEditarCamp}
                      onToggle={toggleCampeonato}
                      onVerFechas={abrirFechas}
                      onConfirmDelete={setConfirmDeleteCampId}
                      onEliminar={eliminarCampeonato}
                    />
                  ))}
                </div>
              )}

              {/* Campeonatos inactivos */}
              {campsInactivos.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider px-1">Inactivos</p>
                  {campsInactivos.map(c => (
                    <CampeonatoCard
                      key={c.id}
                      c={c}
                      confirmDeleteId={confirmDeleteCampId}
                      onEditar={abrirEditarCamp}
                      onToggle={toggleCampeonato}
                      onVerFechas={abrirFechas}
                      onConfirmDelete={setConfirmDeleteCampId}
                      onEliminar={eliminarCampeonato}
                    />
                  ))}
                </div>
              )}
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
            <button onClick={abrirNuevaFecha}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition">
              + Nueva fecha
            </button>
          </div>

          {formFechaJSX}

          {fechas.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📅</div>
              <p className="text-sm">Aún no hay fechas en este campeonato</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fechas.map(f => {
                const ef = ESTADO_FECHA[f.estado];
                const confirmando = confirmDeleteFechaId === f.id;
                return (
                  <div key={f.id} className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{f.nombre}</p>
                          {f.tipo && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              f.tipo === "racing"    ? "bg-red-100 text-red-700" :
                              f.tipo === "track_day" ? "bg-blue-100 text-blue-700" :
                                                      "bg-emerald-100 text-emerald-700"
                            }`}>
                              {f.tipo === "racing" ? "Racing" : f.tipo === "track_day" ? "Track Day" : "Entreno"}
                            </span>
                          )}
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
                      {/* Acciones fecha */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => abrirEditarFecha(f)}
                          className="text-xs border border-gray-200 text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition">
                          ✏️
                        </button>
                        {confirmando ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-red-600 font-medium">¿Eliminar?</span>
                            <button onClick={() => eliminarFecha(f.id)}
                              className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-red-700 transition">
                              Sí
                            </button>
                            <button onClick={() => setConfirmDeleteFechaId(null)}
                              className="text-xs border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50 transition">
                              No
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDeleteFechaId(f.id)}
                            className="text-xs border border-red-100 text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition">
                            🗑
                          </button>
                        )}
                        <button onClick={() => abrirInscripciones(f.id)}
                          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition">
                          Inscripciones →
                        </button>
                      </div>
                    </div>
                    {/* Cambio de estado rápido */}
                    <div className="flex gap-1.5 flex-wrap">
                      {(["borrador","abierto","finalizado"] as const).map(est => (
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
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Solicitados", val: solicitados, color: "text-amber-600" },
              { label: "Confirmados", val: inscripciones.filter(i => i.estado === "confirmado").length, color: "text-green-700" },
              { label: `Cupos ${cuposUsados}/${fechaActual.cupos_max}`, val: fechaActual.cupos_max - cuposUsados, color: cuposUsados >= fechaActual.cupos_max ? "text-red-600" : "text-gray-700" },
            ].map(s => (
              <div key={s.label} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.val}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {inscripciones.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📋</div>
              <p className="text-sm">Aún no hay solicitudes de inscripción</p>
            </div>
          ) : (
            <div className="space-y-2">
              {inscripciones.map(insc => {
                const ei       = ESTADO_INSC[insc.estado];
                const ep       = PAGO_BADGE[insc.pago_estado];
                const nombre   = (insc.pilotos as any)?.nombre   || "Piloto";
                const telefono = (insc.pilotos as any)?.telefono || "";
                return (
                  <div key={insc.id} className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{nombre}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${ei.bg} ${ei.color}`}>
                            {ei.label}
                          </span>
                          {insc.estado !== "rechazado" && (
                            <span className={`text-xs font-medium ${ep.color}`}>· {ep.label}</span>
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
                    <div className="flex gap-2 flex-wrap">
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
                      {insc.estado === "inscrito" && insc.pago_estado === "pendiente" && (
                        <button onClick={() => confirmarPago(insc.id)}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-700 transition">
                          💳 Confirmar pago
                        </button>
                      )}
                      {insc.estado === "inscrito" && insc.pago_estado === "confirmado_admin" && (
                        <button onClick={() => cambiarEstadoInsc(insc.id, "confirmado")}
                          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-green-700 transition">
                          ✓ Habilitar para competir
                        </button>
                      )}
                      {insc.estado === "inscrito" && insc.pago_estado === "pendiente" && (
                        <button disabled
                          className="text-xs border border-gray-200 text-gray-400 px-3 py-1.5 rounded-lg cursor-not-allowed opacity-60">
                          💳 Pago en app (próximamente)
                        </button>
                      )}
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
              placeholder="Visible solo para el admin..."
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

// ── Subcomponente tarjeta campeonato ───────────────────────────
function CampeonatoCard({
  c, confirmDeleteId, onEditar, onToggle, onVerFechas, onConfirmDelete, onEliminar,
}: {
  c: Campeonato;
  confirmDeleteId: string | null;
  onEditar:       (c: Campeonato) => void;
  onToggle:       (id: string, activo: boolean) => void;
  onVerFechas:    (id: string) => void;
  onConfirmDelete:(id: string | null) => void;
  onEliminar:     (id: string) => void;
}) {
  const confirmando = confirmDeleteId === c.id;
  return (
    <div className={`border rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 transition ${
      c.activo ? "bg-white border-gray-200" : "bg-gray-50 border-gray-100 opacity-70"
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold truncate ${c.activo ? "text-gray-900" : "text-gray-500"}`}>
            {c.nombre}
          </p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
            c.activo ? "bg-green-50 text-green-700 border-green-200"
                     : "bg-gray-100 text-gray-400 border-gray-200"
          }`}>
            {c.activo ? "Activo" : "Inactivo"}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          Temporada {c.temporada}{c.descripcion ? ` · ${c.descripcion}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Editar */}
        <button onClick={() => onEditar(c)}
          className="text-xs border border-gray-200 text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition">
          ✏️
        </button>
        {/* Activar/Desactivar */}
        <button onClick={() => onToggle(c.id, c.activo)}
          className="text-xs border border-gray-200 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 transition text-gray-500">
          {c.activo ? "Desactivar" : "Activar"}
        </button>
        {/* Eliminar con confirm inline */}
        {confirmando ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-red-600 font-medium">¿Eliminar?</span>
            <button onClick={() => onEliminar(c.id)}
              className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg font-semibold hover:bg-red-700 transition">
              Sí
            </button>
            <button onClick={() => onConfirmDelete(null)}
              className="text-xs border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50 transition">
              No
            </button>
          </div>
        ) : (
          <button onClick={() => onConfirmDelete(c.id)}
            className="text-xs border border-red-100 text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition">
            🗑
          </button>
        )}
        {/* Ver fechas */}
        <button onClick={() => onVerFechas(c.id)}
          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-indigo-700 transition">
          Ver fechas →
        </button>
      </div>
    </div>
  );
}

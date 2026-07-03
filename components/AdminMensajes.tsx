"use client";

/**
 * AdminMensajes.tsx — components/AdminMensajes.tsx
 *
 * Panel de mensajería directa del director de carrera → pilotos.
 * Permite enviar mensajes individuales o broadcast a todos.
 * Se integra dentro de la pestaña "Dirección de Carrera".
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// ── Tipos ──────────────────────────────────────────────────────
interface PilotoActivo {
  piloto_id: string;
  nombre:    string;
}

interface Mensaje {
  id:        string;
  piloto_id: string | null;
  tipo:      "info" | "warning" | "danger";
  texto:     string;
  created_at: string;
}

// ── Configuración de tipos ─────────────────────────────────────
const TIPO_CONFIG = {
  info:    { label: "Info",    emoji: "💬", bg: "bg-blue-950",   border: "border-blue-700",   text: "text-blue-300",   btnActive: "bg-blue-600 border-blue-600 text-white",   btnIdle: "bg-gray-900 border-gray-700 text-blue-400 hover:border-blue-600" },
  warning: { label: "Aviso",   emoji: "⚠️",  bg: "bg-yellow-950", border: "border-yellow-700", text: "text-yellow-300", btnActive: "bg-yellow-600 border-yellow-600 text-white", btnIdle: "bg-gray-900 border-gray-700 text-yellow-400 hover:border-yellow-600" },
  danger:  { label: "Urgente", emoji: "🚨", bg: "bg-red-950",    border: "border-red-700",    text: "text-red-300",    btnActive: "bg-red-600 border-red-600 text-white",     btnIdle: "bg-gray-900 border-gray-700 text-red-400 hover:border-red-600" },
} as const;

// ── Mensajes rápidos predefinidos ──────────────────────────────
const RAPIDOS: { texto: string; tipo: "info" | "warning" | "danger" }[] = [
  { texto: "Ingrese a boxes",           tipo: "info"    },
  { texto: "Reduzca velocidad",         tipo: "warning" },
  { texto: "Bandera roja — deténgase",  tipo: "danger"  },
  { texto: "Revise su vehículo",        tipo: "warning" },
  { texto: "Sesión finalizada",         tipo: "info"    },
  { texto: "Cuidado: vehículo detenido en pista", tipo: "warning" },
];

// ── Componente ─────────────────────────────────────────────────
export default function AdminMensajes() {
  const [pilotosActivos, setPilotosActivos] = useState<PilotoActivo[]>([]);
  const [destinatario,   setDestinatario]   = useState<string>("todos"); // "todos" | piloto_id
  const [tipo,           setTipo]           = useState<"info" | "warning" | "danger">("info");
  const [texto,          setTexto]          = useState("");
  const [enviando,       setEnviando]       = useState(false);
  const [recientes,      setRecientes]      = useState<Mensaje[]>([]);
  const [feedback,       setFeedback]       = useState<{ ok: boolean; msg: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Cargar pilotos activos (sesión en curso) ───────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("sesiones")
        .select("piloto_id, pilotos(nombre)")
        .eq("estado", "activa");

      if (data) {
        setPilotosActivos(
          data.map((s: any) => ({
            piloto_id: s.piloto_id,
            nombre:    (s.pilotos as any)?.nombre || "Piloto",
          }))
        );
      }
    };

    load();

    // Actualizar lista si cambian sesiones
    const ch = supabase
      .channel("admin-mensajes-sesiones")
      .on("postgres_changes", { event: "*", schema: "public", table: "sesiones" }, load)
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Cargar mensajes recientes ──────────────────────────────
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("mensajes_piloto")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(8);
      if (data) setRecientes(data as Mensaje[]);
    };

    load();

    const ch = supabase
      .channel("admin-mensajes-recientes")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_piloto" },
        payload => {
          setRecientes(prev => [payload.new as Mensaje, ...prev].slice(0, 8));
        })
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, []);

  // ── Enviar mensaje ─────────────────────────────────────────
  const enviar = async (textoMsg = texto.trim()) => {
    if (!textoMsg) return;
    setEnviando(true);
    try {
      const row = {
        piloto_id: destinatario === "todos" ? null : destinatario,
        tipo,
        texto:     textoMsg,
      };
      const { error } = await supabase.from("mensajes_piloto").insert(row);
      if (error) throw error;

      setTexto("");
      setFeedback({ ok: true, msg: "Mensaje enviado ✓" });
      inputRef.current?.focus();
    } catch (err: any) {
      setFeedback({ ok: false, msg: `Error: ${err?.message || "desconocido"}` });
    } finally {
      setEnviando(false);
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const nombreDestinatario = destinatario === "todos"
    ? "Todos los pilotos"
    : pilotosActivos.find(p => p.piloto_id === destinatario)?.nombre || "Piloto";

  const cfg = TIPO_CONFIG[tipo];

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Mensajes a pilotos
          </span>
        </div>
        {pilotosActivos.length > 0 && (
          <span className="text-xs text-gray-600">
            {pilotosActivos.length} en pista
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">

        {/* ── Destinatario ── */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
            Destinatario
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Todos */}
            <button
              onClick={() => setDestinatario("todos")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                destinatario === "todos"
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "bg-gray-900 border-gray-700 text-gray-400 hover:border-indigo-600"
              }`}
            >
              📡 Todos
            </button>

            {/* Pilotos activos */}
            {pilotosActivos.map(p => (
              <button
                key={p.piloto_id}
                onClick={() => setDestinatario(p.piloto_id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                  destinatario === p.piloto_id
                    ? "bg-indigo-600 border-indigo-600 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-indigo-600"
                }`}
              >
                {p.nombre.split(" ")[0]}
              </button>
            ))}

            {pilotosActivos.length === 0 && (
              <span className="text-xs text-gray-700 py-1.5">Sin pilotos activos en pista</span>
            )}
          </div>
        </div>

        {/* ── Tipo ── */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
            Tipo de mensaje
          </p>
          <div className="flex gap-2">
            {(["info", "warning", "danger"] as const).map(t => {
              const c = TIPO_CONFIG[t];
              return (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    tipo === t ? c.btnActive : c.btnIdle
                  }`}
                >
                  {c.emoji} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Mensajes rápidos ── */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
            Envío rápido
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {RAPIDOS.map((r, i) => (
              <button
                key={i}
                onClick={() => {
                  setTipo(r.tipo);
                  enviar(r.texto);
                }}
                disabled={enviando}
                className="text-left px-3 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-600 text-xs text-gray-300 transition-colors disabled:opacity-50 truncate"
              >
                {TIPO_CONFIG[r.tipo].emoji} {r.texto}
              </button>
            ))}
          </div>
        </div>

        {/* ── Campo texto + envío ── */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
            Mensaje personalizado → <span className="text-indigo-400 normal-case">{nombreDestinatario}</span>
          </p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => e.key === "Enter" && enviar()}
              placeholder="Escribe el mensaje…"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={() => enviar()}
              disabled={enviando || !texto.trim()}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                cfg.btnActive
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {enviando ? "···" : "Enviar"}
            </button>
          </div>

          {/* Feedback */}
          {feedback && (
            <p className={`text-xs mt-2 font-semibold ${feedback.ok ? "text-green-400" : "text-red-400"}`}>
              {feedback.msg}
            </p>
          )}
        </div>

        {/* ── Historial reciente ── */}
        {recientes.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-semibold">
              Enviados recientemente
            </p>
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {recientes.map(m => {
                const c   = TIPO_CONFIG[m.tipo] || TIPO_CONFIG.info;
                const ts  = new Date(m.created_at);
                const hms = ts.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const dest = m.piloto_id
                  ? (pilotosActivos.find(p => p.piloto_id === m.piloto_id)?.nombre?.split(" ")[0] || "Piloto")
                  : "Todos";
                return (
                  <div
                    key={m.id}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${c.bg} ${c.border}`}
                  >
                    <span className="text-base leading-none mt-0.5 flex-shrink-0">{c.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${c.text} truncate`}>{m.texto}</p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        → {dest} · {hms}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

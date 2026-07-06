"use client";

/**
 * Cronometraje.tsx — components/Cronometraje.tsx
 *
 * Pestaña Crono del panel admin. Tabla de posiciones en vivo a partir de
 * la tabla `vueltas` (cruces detectados en el teléfono de cada piloto).
 *
 * - Entrenamiento/Clasificación: orden por mejor tiempo.
 * - Carrera: orden por vueltas completadas + progreso en la vuelta (GPS).
 * Cronometraje REFERENCIAL (GPS ±1 s aprox), no tiempos oficiales.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { sectorSlice, type Coordenada } from "@/lib/gps";

interface Props { fechaId: string; }

interface Tanda {
  id: string; tipo: string; nombre: string; inicio: string; fin: string | null;
  duracion_min?: number | null; vueltas_programadas?: number | null; meta_idx?: number | null;
}
interface VueltaRow {
  piloto_id: string; numero: number; cruce_at: string; tiempo_ms: number | null; valida: boolean;
}
interface PilotoInfo { nombre: string; numero: string | null; }
interface PosPiloto { lat: number; lng: number; ts: number; dentro: boolean | null; }

const TIPO_CFG: Record<string, { label: string; bg: string }> = {
  entrenamiento: { label: "ENTRENAMIENTO", bg: "#047857" },
  clasificacion: { label: "CLASIFICACIÓN", bg: "#1d4ed8" },
  carrera:       { label: "CARRERA",       bg: "#dc2626" },
};

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}
function fmtReloj(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = Math.floor(totalS % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function Cronometraje({ fechaId }: Props) {
  const [tandas, setTandas]         = useState<Tanda[]>([]);
  const [tandaSelId, setTandaSelId] = useState<string | null>(null);
  const [vueltas, setVueltas]       = useState<VueltaRow[]>([]);
  const [pilotosInfo, setPilotosInfo] = useState<Map<string, PilotoInfo>>(new Map());
  const [posiciones, setPosiciones] = useState<Map<string, PosPiloto>>(new Map());
  const [trazado, setTrazado]       = useState<Coordenada[]>([]);
  const [, setTick]                 = useState(0); // reloj de sesión (1 s)
  const [migracionOk, setMigracionOk] = useState(true);

  const tandaSel = tandas.find(t => t.id === tandaSelId) || null;
  const tandaSelRef = useRef<string | null>(null);
  useEffect(() => { tandaSelRef.current = tandaSelId; }, [tandaSelId]);

  // ── Tandas de la fecha (la activa o la última queda seleccionada) ──
  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      const { data, error } = await supabase
        .from("tandas").select("*").eq("fecha_id", fechaId).order("inicio");
      if (!vivo) return;
      if (error) { setMigracionOk(false); return; }
      const lista = (data || []) as Tanda[];
      setTandas(lista);
      if (!tandaSelRef.current || !lista.some(t => t.id === tandaSelRef.current)) {
        const activa = lista.find(t => !t.fin) || lista[lista.length - 1] || null;
        setTandaSelId(activa?.id ?? null);
      }
    };
    cargar();
    const poll = setInterval(cargar, 10_000);
    return () => { vivo = false; clearInterval(poll); };
  }, [fechaId]);

  // ── Nombres y números de los pilotos del evento ──
  useEffect(() => {
    const cargar = async () => {
      const res = await supabase
        .from("inscripciones")
        .select("piloto_id, pilotos(nombre, numero)")
        .eq("fecha_id", fechaId);
      let data: any[] | null = res.data as any;
      if (res.error) {
        const r2 = await supabase
          .from("inscripciones")
          .select("piloto_id, pilotos(nombre)")
          .eq("fecha_id", fechaId);
        data = r2.data as any;
      }
      const m = new Map<string, PilotoInfo>();
      (data || []).forEach((r: any) => {
        m.set(r.piloto_id, { nombre: r.pilotos?.nombre || "Piloto", numero: r.pilotos?.numero ?? null });
      });
      setPilotosInfo(m);
    };
    cargar();
  }, [fechaId]);

  // ── Trazado del circuito del evento (para el progreso en carrera) ──
  useEffect(() => {
    const cargar = async () => {
      try {
        const { data: f } = await supabase
          .from("fechas_evento").select("circuito_id").eq("id", fechaId).maybeSingle();
        if ((f as any)?.circuito_id) {
          const { data: c } = await supabase
            .from("circuitos").select("trazado_coords").eq("id", (f as any).circuito_id).maybeSingle();
          if ((c as any)?.trazado_coords?.length >= 2) setTrazado((c as any).trazado_coords);
        }
      } catch { /* sin circuito */ }
    };
    cargar();
  }, [fechaId]);

  // ── Vueltas de la tanda seleccionada (Realtime + polling) ──
  useEffect(() => {
    if (!tandaSelId) { setVueltas([]); return; }
    const tid = tandaSelId;
    const cargar = async () => {
      const { data, error } = await supabase
        .from("vueltas")
        .select("piloto_id, numero, cruce_at, tiempo_ms, valida")
        .eq("tanda_id", tid)
        .order("cruce_at");
      if (!error && data) setVueltas(data as VueltaRow[]);
    };
    cargar();
    const ch = supabase
      .channel("crono-vueltas")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "vueltas", filter: `tanda_id=eq.${tid}` },
        () => { cargar(); })
      .subscribe();
    const poll = setInterval(cargar, 7_000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [tandaSelId]);

  // ── Posiciones GPS en vivo (estado + progreso de carrera) ──
  useEffect(() => {
    const ch = supabase
      .channel("crono-ubicaciones")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "ubicaciones_piloto" },
        payload => {
          const u = payload.new as any;
          setPosiciones(prev => {
            const next = new Map(prev);
            next.set(u.piloto_id, { lat: u.lat, lng: u.lng, ts: Date.now(), dentro: u.dentro_geocerca });
            return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Reloj de sesión
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Estadísticas por piloto ──
  const filas = useMemo(() => {
    if (!tandaSel) return [];
    const metaIdx  = tandaSel.meta_idx ?? 0;
    const inicioMs = new Date(tandaSel.inicio).getTime();
    const deadline = tandaSel.duracion_min ? inicioMs + tandaSel.duracion_min * 60000 : null;

    interface Stat {
      pid: string; cruces: number; completadas: number;
      mejor: number | null; ultima: number | null; lastCruce: number;
      crucesPorNumero: Map<number, number>;
    }
    const por = new Map<string, Stat>();
    for (const v of vueltas) {
      let s = por.get(v.piloto_id);
      if (!s) {
        s = { pid: v.piloto_id, cruces: 0, completadas: 0, mejor: null, ultima: null, lastCruce: 0, crucesPorNumero: new Map() };
        por.set(v.piloto_id, s);
      }
      const cruceMs = new Date(v.cruce_at).getTime();
      s.crucesPorNumero.set(v.numero, cruceMs);
      if (v.numero > s.cruces) { s.cruces = v.numero; s.ultima = v.tiempo_ms; s.lastCruce = cruceMs; }
      if (v.valida && v.tiempo_ms != null && (s.mejor == null || v.tiempo_ms < s.mejor)) s.mejor = v.tiempo_ms;
    }
    for (const s of por.values()) s.completadas = Math.max(0, s.cruces - 1);

    // Pilotos con posición GPS pero sin vueltas aún también aparecen
    for (const pid of posiciones.keys()) {
      if (!por.has(pid) && pilotosInfo.has(pid)) {
        por.set(pid, { pid, cruces: 0, completadas: 0, mejor: null, ultima: null, lastCruce: 0, crucesPorNumero: new Map() });
      }
    }

    // Progreso 0..1 dentro de la vuelta actual (para el orden de carrera)
    const progreso = (pid: string): number => {
      const p = posiciones.get(pid);
      if (!p || trazado.length < 8) return 0;
      let idx = 0, min = Infinity;
      for (let i = 0; i < trazado.length; i++) {
        const d = (p.lat - trazado[i].lat) ** 2 + (p.lng - trazado[i].lng) ** 2;
        if (d < min) { min = d; idx = i; }
      }
      return ((idx - metaIdx + trazado.length) % trazado.length) / trazado.length;
    };

    const lista = Array.from(por.values());
    const esCarrera = tandaSel.tipo === "carrera";
    if (esCarrera) {
      lista.sort((a, b) =>
        b.completadas - a.completadas ||
        progreso(b.pid) - progreso(a.pid) ||
        (a.lastCruce || Infinity) - (b.lastCruce || Infinity)
      );
    } else {
      lista.sort((a, b) =>
        (a.mejor ?? Infinity) - (b.mejor ?? Infinity) ||
        b.completadas - a.completadas
      );
    }

    const lider    = lista[0];
    const mejorAbs = lista.reduce<number | null>((m, s) => (s.mejor != null && (m == null || s.mejor < m) ? s.mejor : m), null);

    return lista.map((s, i) => {
      const info = pilotosInfo.get(s.pid);
      const pos  = posiciones.get(s.pid);
      const offline = !pos || Date.now() - pos.ts > 20_000;

      let estado: { label: string; bg: string; color: string };
      if (deadline && s.lastCruce > deadline && s.cruces > 0) {
        estado = { label: "Finalizado", bg: "#27272a", color: "#d4d4d8" };
      } else if (s.cruces === 0 && (!pos || offline)) {
        estado = { label: "Sin vuelta", bg: "#27272a", color: "#71717a" };
      } else if (offline) {
        estado = { label: "Sin señal", bg: "#450a0a", color: "#f87171" };
      } else if (pos?.dentro === true) {
        estado = { label: "En pista", bg: "#14532d", color: "#4ade80" };
      } else {
        estado = { label: "Boxes", bg: "#312e81", color: "#a5b4fc" };
      }

      // Diferencia
      let gap = "—";
      if (esCarrera && lider && i > 0) {
        if (s.completadas < lider.completadas) {
          const d = lider.completadas - s.completadas;
          gap = `+${d} ${d === 1 ? "vuelta" : "vueltas"}`;
        } else {
          const cruceLider  = lider.crucesPorNumero.get(lider.cruces);
          const crucePiloto = s.crucesPorNumero.get(lider.cruces);
          if (cruceLider && crucePiloto) gap = `+${((crucePiloto - cruceLider) / 1000).toFixed(1)}s`;
        }
      } else if (!esCarrera && s.mejor != null && mejorAbs != null && s.mejor > mejorAbs) {
        gap = `+${((s.mejor - mejorAbs) / 1000).toFixed(3)}`;
      }

      return {
        pos: i + 1,
        pid: s.pid,
        numero: info?.numero ?? null,
        nombre: info?.nombre ?? s.pid.slice(0, 8),
        completadas: s.completadas,
        mejor: s.mejor,
        ultima: s.ultima,
        esMejorAbs: s.mejor != null && s.mejor === mejorAbs,
        gap,
        estado,
      };
    });
  }, [vueltas, pilotosInfo, posiciones, trazado, tandaSel]);

  // ── Datos de cabecera ──
  const mejorAbsFila  = filas.reduce<typeof filas[0] | null>((m, f) => (f.mejor != null && (m == null || f.mejor < (m.mejor as number)) ? f : m), null);
  const ultimaGlobal  = useMemo(() => {
    let ult: { t: number; ms: number; pid: string } | null = null;
    for (const v of vueltas) {
      if (v.tiempo_ms == null) continue;
      const t = new Date(v.cruce_at).getTime();
      if (!ult || t > ult.t) ult = { t, ms: v.tiempo_ms, pid: v.piloto_id };
    }
    return ult;
  }, [vueltas]);

  const cfg = tandaSel ? (TIPO_CFG[tandaSel.tipo] || TIPO_CFG.entrenamiento) : null;
  const esCarrera = tandaSel?.tipo === "carrera";
  const liderVueltas = filas[0]?.completadas ?? 0;
  const inicioMs = tandaSel ? new Date(tandaSel.inicio).getTime() : 0;
  const finMs    = tandaSel?.fin ? new Date(tandaSel.fin).getTime() : null;
  const transcurridoS = tandaSel ? Math.max(0, Math.floor(((finMs ?? Date.now()) - inicioMs) / 1000)) : 0;
  const restanteS = tandaSel?.duracion_min ? Math.max(0, tandaSel.duracion_min * 60 - transcurridoS) : null;

  if (!migracionOk) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-14 text-center">
        <p className="text-4xl mb-4">⏱</p>
        <p className="text-base font-bold text-gray-800">Cronometraje sin configurar</p>
        <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
          Falta correr la migración de cronometraje en Supabase
          (docs/task-cronometraje-migration.sql).
        </p>
      </div>
    );
  }

  if (!tandaSel) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-2xl px-6 py-14 text-center">
        <p className="text-4xl mb-4">⏱</p>
        <p className="text-base font-bold text-gray-800">Sin tandas todavía</p>
        <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
          Inicia una tanda desde el Log de acciones en Dirección
          (Entrenamiento, Clasificación o Carrera) y el cronometraje
          partirá solo.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0f1117" }}>

      {/* ── Cabecera: tanda + estado + contador ── */}
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-3 flex-wrap" style={{ borderBottom: "1px solid #23262f" }}>
        <span className="text-[11px] font-bold tracking-wider px-3 py-1 rounded-full" style={{ background: cfg!.bg, color: "#fff" }}>
          {tandaSel.nombre.toUpperCase()}
        </span>
        {tandaSel.fin ? (
          <span className="text-xs font-semibold" style={{ color: "#a1a1aa" }}>🏁 Finalizada</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#4ade80" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#4ade80" }} />
            En curso
          </span>
        )}
        <span className="ml-auto text-xl font-bold tabular-nums" style={{ color: "#f4f4f5" }}>
          {esCarrera ? (
            <>Vuelta {liderVueltas}{tandaSel.vueltas_programadas ? <span style={{ color: "#52525b", fontSize: 14 }}> / {tandaSel.vueltas_programadas}</span> : null}</>
          ) : restanteS != null && !tandaSel.fin ? (
            <><span style={{ color: "#52525b", fontSize: 14 }}>Restan </span>{fmtReloj(restanteS)}</>
          ) : (
            fmtReloj(transcurridoS)
          )}
        </span>
        <span className="text-xs tabular-nums" style={{ color: "#a1a1aa" }}>⏱ {fmtReloj(transcurridoS)}</span>
      </div>

      {/* ── Sub-cabecera: mejores tiempos + selector de tanda ── */}
      <div className="px-4 sm:px-5 py-2.5 flex items-center gap-5 flex-wrap" style={{ borderBottom: "1px solid #23262f" }}>
        <div>
          <p className="text-[10px] tracking-wider" style={{ color: "#52525b" }}>MEJOR VUELTA</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#c084fc" }}>
            {mejorAbsFila ? `${fmtMs(mejorAbsFila.mejor)} · ${mejorAbsFila.nombre}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] tracking-wider" style={{ color: "#52525b" }}>ÚLTIMA VUELTA</p>
          <p className="text-sm font-semibold tabular-nums" style={{ color: "#e4e4e7" }}>
            {ultimaGlobal ? `${fmtMs(ultimaGlobal.ms)} · ${pilotosInfo.get(ultimaGlobal.pid)?.nombre ?? ""}` : "—"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={tandaSelId ?? ""}
            onChange={e => setTandaSelId(e.target.value)}
            className="text-xs rounded-lg px-2 py-1 focus:outline-none"
            style={{ background: "#1c1f27", color: "#d4d4d8", border: "1px solid #3f3f46" }}
          >
            {tandas.map(t => (
              <option key={t.id} value={t.id}>{t.nombre}{!t.fin ? " · en curso" : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Tabla de posiciones ── */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="text-left text-[10px] tracking-wider" style={{ color: "#52525b" }}>
              <th className="py-2 pl-4 sm:pl-5 pr-2 w-9">POS</th>
              <th className="py-2 px-2">PILOTO</th>
              <th className="py-2 px-2 text-center">VUELTAS</th>
              <th className="py-2 px-2 text-right">{esCarrera ? "DIF. LÍDER" : "DIF. MEJOR"}</th>
              <th className="py-2 px-2 text-right">MEJOR</th>
              <th className="py-2 px-2 text-right">ÚLTIMA</th>
              <th className="py-2 pl-2 pr-4 sm:pr-5">ESTADO</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.pid} style={{ borderTop: "1px solid #1c1f27", color: "#d4d4d8" }}>
                <td className="py-2.5 pl-4 sm:pl-5 pr-2 font-bold" style={{ color: f.pos === 1 ? "#facc15" : "#71717a" }}>{f.pos}</td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] rounded-md text-[11px] font-bold mr-2 px-1" style={{ background: "#27272a", color: "#fbbf24" }}>
                    {f.numero || f.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  {f.nombre}
                </td>
                <td className="py-2.5 px-2 text-center tabular-nums">{f.completadas}</td>
                <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "#a1a1aa" }}>{f.gap}</td>
                <td className="py-2.5 px-2 text-right tabular-nums font-medium" style={{ color: f.esMejorAbs ? "#c084fc" : "#e4e4e7" }}>{fmtMs(f.mejor)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "#a1a1aa" }}>{fmtMs(f.ultima)}</td>
                <td className="py-2.5 pl-2 pr-4 sm:pr-5">
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: f.estado.bg, color: f.estado.color }}>
                    {f.estado.label}
                  </span>
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm" style={{ color: "#52525b" }}>
                  Esperando el primer cruce de meta…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-4 sm:px-5 py-2 text-[10px]" style={{ color: "#3f3f46", borderTop: "1px solid #1c1f27" }}>
        Cronometraje referencial por GPS (±1 s aprox) — no constituye tiempos oficiales
      </p>
    </div>
  );
}

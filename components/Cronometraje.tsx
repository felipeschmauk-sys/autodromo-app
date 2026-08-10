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

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { esVueltaDeCarrera } from "@/lib/carrera";
import { descargarXlsx, type Celda } from "@/lib/xlsx";
import { suscribirPosiciones, abrirEmisorEstado, type EstadoCarreraViva } from "@/lib/posiciones";
import { calcularGaps, sostenerAzul, recorridoTotal, type EstadoPiloto, type Muestra, type EstadoAzul } from "@/lib/gaps";
import { prepararTrazado } from "@/lib/trazado";
import { sectorSlice, type Coordenada } from "@/lib/gps";

interface Props {
  fechaId: string;
  // Selección sincronizada con el Log de acciones: el panel es el dueño
  // de la tanda seleccionada; Crono la sigue y reporta los cambios
  tandaSeleccionada?: string | null;
  onSeleccionarTanda?: (id: string) => void;
  // Control de tandas compartido con el Log (iniciar/finalizar desde Crono)
  tandaActivaId?: string | null;
  onIniciarTanda?: (tipo: string, duracionMin: number | null, vueltas: number | null) => void;
  onFinalizarTanda?: () => void;
}

const TIPO_LABEL: Record<string, string> = {
  libre: "Libre", entrenamiento: "Entrenamiento", clasificacion: "Clasificación", carrera: "Carrera",
};

interface Tanda {
  id: string; tipo: string; nombre: string; inicio: string; fin: string | null;
  duracion_min?: number | null; vueltas_programadas?: number | null; meta_idx?: number | null;
  largada_at?: string | null;
}
interface VueltaRow {
  piloto_id: string; numero: number; cruce_at: string; tiempo_ms: number | null; valida: boolean;
  offset_ms?: number | null; // desfase del reloj de ESE teléfono contra el servidor
}
interface PilotoInfo { nombre: string; numero: string | null; }
interface PosPiloto {
  lat: number; lng: number; ts: number; dentro: boolean | null;
  /** Metros recorridos sobre el trazado. Solo llega por broadcast. */
  d?: number | null;
  /** Progreso 0..1 ya calculado en el teléfono, con proyección sobre segmento */
  p?: number | null;
  /** Velocidad en m/s */
  v?: number | null;
  /** Vueltas de carrera completadas según el propio teléfono */
  vu?: number;
  /** Instante de la lectura en hora de servidor */
  t?: number;
  /** true si vino por broadcast (1 Hz) y no de la tabla (3 s) */
  vivo?: boolean;
}

const TIPO_CFG: Record<string, { label: string; bg: string }> = {
  libre:         { label: "LIBRE",         bg: "#52525b" },
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
/** Diferencia contra la mejor vuelta propia, estilo planilla de cronometraje. */
function fmtDif(ms: number | null): string {
  if (ms == null || ms === 0) return "";
  const s = ms / 1000;
  return s >= 60 ? `+${Math.floor(s / 60)}:${(s % 60) < 10 ? "0" : ""}${(s % 60).toFixed(3)}` : `+${s.toFixed(3)}`;
}
/** Hora del día del cruce, con milésimas (como en la planilla impresa). */
function fmtHora(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function fmtReloj(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = Math.floor(totalS % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function Cronometraje({ fechaId, tandaSeleccionada, onSeleccionarTanda, tandaActivaId, onIniciarTanda, onFinalizarTanda }: Props) {
  // Configuración local para iniciar una tanda desde Crono
  const [cfgTipo, setCfgTipo]       = useState<string | null>(null);
  const [cfgDur, setCfgDur]         = useState("15");
  const [cfgVueltas, setCfgVueltas] = useState("15");
  const [tandas, setTandas]         = useState<Tanda[]>([]);
  const [tandaSelId, setTandaSelId] = useState<string | null>(null);
  const [vueltas, setVueltas]       = useState<VueltaRow[]>([]);
  const [marcandoLargada, setMarcandoLargada] = useState(false);
  const [pilotoAbierto, setPilotoAbierto] = useState<string | null>(null);
  // Historial de recorrido por piloto: el gap se calcula sobre el recorrido del
  // OTRO, no sobre su posición actual, así que hay que guardarlo
  const historiaRef = useRef<Map<string, Muestra[]>>(new Map());
  const azulRef     = useRef<Map<string, EstadoAzul>>(new Map());
  // Espejo de las posiciones para que el intervalo de cálculo vea siempre lo
  // último sin tener que reiniciarse en cada mensaje
  const posicionesRef = useRef<Map<string, PosPiloto>>(new Map());
  const [pilotosInfo, setPilotosInfo] = useState<Map<string, PilotoInfo>>(new Map());
  const [posiciones, setPosiciones] = useState<Map<string, PosPiloto>>(new Map());
  const [trazado, setTrazado]       = useState<Coordenada[]>([]);
  const largoCircuito = useMemo(() => prepararTrazado(trazado)?.largo ?? 0, [trazado]);
  const [, setTick]                 = useState(0); // reloj de sesión (1 s)
  const [migracionOk, setMigracionOk] = useState(true);

  const tandaSel = tandas.find(t => t.id === tandaSelId) || null;
  const tandaSelRef = useRef<string | null>(null);
  useEffect(() => { tandaSelRef.current = tandaSelId; }, [tandaSelId]);

  // Seguir la selección compartida con el Log (cuando apunta a una tanda válida)
  useEffect(() => {
    if (tandaSeleccionada && tandaSeleccionada !== tandaSelId && tandas.some(t => t.id === tandaSeleccionada)) {
      setTandaSelId(tandaSeleccionada);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tandaSeleccionada, tandas]);

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
        // Sincronizar el log con la tanda que Crono elige automáticamente
        if (activa?.id) onSeleccionarTanda?.(activa.id);
      }
    };
    cargar();
    const poll = setInterval(cargar, 10_000);
    return () => { vivo = false; clearInterval(poll); };
  // tandaActivaId como dep: al iniciar/finalizar desde Crono o el Log,
  // la lista se refresca al instante sin esperar el polling
  }, [fechaId, tandaActivaId]);

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
        .select("piloto_id, numero, cruce_at, tiempo_ms, valida, offset_ms")
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

  // ── Posiciones GPS en vivo ─────────────────────────────────
  // Dos fuentes, a propósito:
  //  · broadcast (1 Hz)  → efímero, es el que sirve para diferencias de tiempo
  //  · ubicaciones_piloto (3 s) → registro histórico, y respaldo si el canal de
  //    broadcast no llegó a abrir en ese teléfono
  // El broadcast pisa a la tabla mientras esté fresco; si se corta, la tabla
  // vuelve a hacerse cargo sola a los 4 segundos.
  useEffect(() => {
    if (!fechaId) return;
    return suscribirPosiciones(fechaId, (b) => {
      setPosiciones(prev => {
        const next = new Map(prev);
        next.set(b.pid, {
          lat: b.lat, lng: b.lng, ts: Date.now(), dentro: b.pista,
          d: b.d, p: b.p, v: b.v, vu: b.vu, t: b.t, vivo: true,
        });
        return next;
      });
      // Historial para los gaps (se guarda ~5 min y se descarta lo viejo)
      // Sin el largo del circuito el recorrido saldría en unidades falsas y
      // envenenaría el historial: mejor no guardar nada hasta tenerlo
      if (b.p != null && largoCircuito > 0) {
        const h = historiaRef.current.get(b.pid) ?? [];
        const rec = (b.vu + b.p) * largoCircuito;
        if (!h.length || h[h.length - 1].t < b.t) h.push({ t: b.t, recorrido: rec });
        if (h.length > 300) h.shift();
        historiaRef.current.set(b.pid, h);
      }
    });
  }, [fechaId, largoCircuito]);

  useEffect(() => { posicionesRef.current = posiciones; }, [posiciones]);

  // ── Cálculo de gaps y reparto a los pilotos (1 Hz) ────────────
  // El panel es el único que conoce la clasificación completa, así que es quien
  // resuelve quién va adelante y quién atrás. Estos números NO se muestran acá:
  // el admin no los necesita, van directo a la pantalla de cada piloto.
  useEffect(() => {
    if (!fechaId || !largoCircuito || !tandaActivaId) return;
    const emisor = abrirEmisorEstado(fechaId);

    // Congelado al cruzar la meta final. La carrera termina cuando cruza el
    // primero, pero los demás siguen girando hasta pasar por meta: a cada uno
    // se le congela su dato en SU cruce, con la diferencia con la que terminó.
    const congelados = new Map<string, EstadoCarreraViva["pilotos"][string]>();
    const vueltasAlTerminarElLider = new Map<string, number>();
    let liderTermino = false;

    const id = setInterval(() => {
      const ahora = Date.now();
      const estados: EstadoPiloto[] = [];
      posicionesRef.current.forEach((p, pid) => {
        if (p.p == null || p.vu == null) return;
        const h = historiaRef.current.get(pid);
        if (!h || h.length < 2) return;
        estados.push({ pid, vueltas: p.vu, progreso: p.p, t: p.t ?? p.ts, enPista: p.dentro, historia: h });
      });
      // Con un solo auto en pista igual se emite: la posición y la vuelta son
      // información válida aunque no haya con quién compararse. Antes se exigían
      // dos pilotos y el resultado era que probando solo no aparecía NADA en la
      // pantalla, ni siquiera el número de vuelta.
      if (estados.length < 1) return;

      const gaps = calcularGaps(estados, { largo: largoCircuito, ahora });
      const orden = [...estados].sort(
        (a, b) => recorridoTotal(b, largoCircuito) - recorridoTotal(a, largoCircuito));

      const pilotos: EstadoCarreraViva["pilotos"] = {};
      orden.forEach((e, i) => {
        const g = gaps.get(e.pid);
        if (!g) return;
        // La bandera azul se enciende y se apaga sola. La histéresis evita que
        // titile, y el adelantamiento consumado la baja de inmediato.
        const est = sostenerAzul(azulRef.current.get(e.pid), g.azul, ahora, { pasaronPor: g.pasaronPor });
        azulRef.current.set(e.pid, est);
        pilotos[e.pid] = { pos: i + 1, vu: e.vueltas, ad: g.adelante, at: g.atras, azul: est.activa };
      });

      // ── Meta final: congelar a cada uno en su propio cruce ──
      const programadas = tandaSel?.vueltas_programadas ?? null;
      if (programadas && orden.length) {
        if (!liderTermino && orden[0].vueltas >= programadas) {
          liderTermino = true;
          // Se anota en qué vuelta venía cada uno cuando cayó la bandera: su
          // meta es el cruce SIGUIENTE
          orden.forEach(e => vueltasAlTerminarElLider.set(e.pid, e.vueltas));
        }
        for (const e of orden) {
          if (congelados.has(e.pid)) continue;
          const suyo = pilotos[e.pid];
          if (!suyo) continue;
          const yaCruzoSuMeta =
            e.vueltas >= programadas ||
            (liderTermino && e.vueltas > (vueltasAlTerminarElLider.get(e.pid) ?? Infinity));
          if (yaCruzoSuMeta) congelados.set(e.pid, { ...suyo, azul: false, fin: true });
        }
      }
      // El dato congelado pisa al vivo: el piloto ya terminó y no debe ver
      // números que sigan moviéndose
      congelados.forEach((v, pid) => { pilotos[pid] = v; });

      emisor.enviar({ t: ahora, pilotos });
    }, 1000);

    return () => { clearInterval(id); emisor.cerrar(); };
  }, [fechaId, largoCircuito, tandaActivaId]);

  useEffect(() => {
    const ch = supabase
      .channel("crono-ubicaciones")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "ubicaciones_piloto" },
        payload => {
          const u = payload.new as any;
          setPosiciones(prev => {
            const anterior = prev.get(u.piloto_id);
            // Si el broadcast de ese piloto sigue vivo, no lo pisamos con el
            // dato de la tabla, que llega más viejo
            if (anterior?.vivo && Date.now() - anterior.ts < 4000) return prev;
            const next = new Map(prev);
            next.set(u.piloto_id, { lat: u.lat, lng: u.lng, ts: Date.now(), dentro: u.dentro_geocerca, vivo: false });
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

  // Instante del cruce en hora de SERVIDOR. Cada cruce se marca con el reloj
  // del teléfono de su piloto, y esos relojes no coinciden: en la Carrera 1 del
  // 9 ago había 4 segundos entre el más adelantado y el más atrasado. Sin
  // corregir, la diferencia contra el líder arrastra ese desfase entero.
  const horaServidor = (v: VueltaRow) => new Date(v.cruce_at).getTime() + (v.offset_ms ?? 0);

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
      sospechosas: number; // vueltas demasiado largas → cruce probablemente perdido
      detalle: VueltaRow[]; // vueltas de carrera en orden, para el desplegable
    }
    // ── Vuelta de formación fuera de la tabla ──────────────────
    // Con la largada marcada, las pasadas por meta detrás del pace car no son
    // vueltas de carrera: se descartan y las que quedan se renumeran desde 1.
    // Sin largada marcada se descarta solo la de salida, como siempre.
    const largadaMs = tandaSel.largada_at ? new Date(tandaSel.largada_at).getTime() : null;

    const por = new Map<string, Stat>();
    const porPiloto = new Map<string, VueltaRow[]>();
    for (const v of vueltas) {
      if (!porPiloto.has(v.piloto_id)) porPiloto.set(v.piloto_id, []);
      porPiloto.get(v.piloto_id)!.push(v);
    }

    for (const [pid, todas] of porPiloto) {
      const ordenadas = [...todas].sort((a, b) => a.numero - b.numero);
      const deCarrera = largadaMs == null
        ? ordenadas.slice(1) // sin marca: fuera la vuelta de salida
        : ordenadas.filter(v => esVueltaDeCarrera(horaServidor(v), largadaMs));

      const s: Stat = {
        pid, cruces: ordenadas.length, completadas: deCarrera.length,
        mejor: null, ultima: null, lastCruce: 0,
        crucesPorNumero: new Map(), sospechosas: 0, detalle: deCarrera,
      };
      deCarrera.forEach((v, i) => {
        const cruceMs = horaServidor(v);
        s.crucesPorNumero.set(i + 1, cruceMs); // renumeradas desde 1
        s.lastCruce = cruceMs;
        s.ultima = v.tiempo_ms;
        if (v.valida && v.tiempo_ms != null && (s.mejor == null || v.tiempo_ms < s.mejor)) s.mejor = v.tiempo_ms;
      });
      por.set(pid, s);
    }

    // ── Vueltas sospechosas: cruces que probablemente se perdieron ──
    // Si el teléfono pierde señal en pista, el cruce que ocurre en ese hueco no
    // queda registrado y las dos vueltas se fusionan en una anormalmente larga.
    // El dato no se puede recuperar (no existe), pero sí avisar de que ese
    // conteo quedó corto, en vez de descubrirlo al terminar.
    //
    // Criterio, calibrado contra la carrera del 9 ago 2026:
    //  - 2,2× la mejor vuelta DEL PROPIO PILOTO (así no castiga al que gira lento)
    //  - sin contar su primera vuelta cronometrada: la de largada es lenta de
    //    verdad —parada, embudo en la primera curva— y daba falso positivo
    // Detecta el caso de pérdida de señal en pista. No detecta pérdidas ANTES
    // de la primera vuelta registrada; ese otro origen (geocerca) se corrigió
    // en la raíz quitándole la geocerca al detector de cruces.
    for (const s of por.values()) {
      if (s.mejor == null) continue;
      const ordenadas = [...(porPiloto.get(s.pid) ?? [])].sort((a, b) => a.numero - b.numero);
      const deCarrera = largadaMs == null
        ? ordenadas.slice(1)
        : ordenadas.filter(v => esVueltaDeCarrera(horaServidor(v), largadaMs));
      const suyas = deCarrera.filter(v => v.tiempo_ms != null).slice(1); // saltar la de largada
      s.sospechosas = suyas.filter(v => (v.tiempo_ms as number) > (s.mejor as number) * 2.2).length;
    }

    // Pilotos con posición GPS pero sin vueltas aún también aparecen
    for (const pid of posiciones.keys()) {
      if (!por.has(pid) && pilotosInfo.has(pid)) {
        por.set(pid, { pid, cruces: 0, completadas: 0, mejor: null, ultima: null, lastCruce: 0, crucesPorNumero: new Map(), sospechosas: 0, detalle: [] });
      }
    }

    // Progreso 0..1 dentro de la vuelta actual (para el orden de carrera)
    const progreso = (pid: string): number => {
      const p = posiciones.get(pid);
      // El teléfono ya lo calculó proyectando sobre el segmento del trazado,
      // que es bastante más preciso que redondear al punto más cercano acá
      if (p?.p != null) return p.p;
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
        sospechosas: s.sospechosas,
        mejor: s.mejor,
        ultima: s.ultima,
        esMejorAbs: s.mejor != null && s.mejor === mejorAbs,
        gap,
        estado,
        // Vuelta a vuelta del piloto, ya renumerado desde 1 y sin la formación
        detalle: s.detalle.map((v, i) => ({
          n: i + 1,
          tiempoMs: v.tiempo_ms,
          cruceAt: v.cruce_at,
          difMejor: v.tiempo_ms != null && s.mejor != null ? v.tiempo_ms - s.mejor : null,
          esMejor: v.tiempo_ms != null && v.tiempo_ms === s.mejor,
        })),
      };
    });
  }, [vueltas, pilotosInfo, posiciones, trazado, tandaSel]);

  // ── Datos de cabecera ──
  const mejorAbsFila  = filas.reduce<typeof filas[0] | null>((m, f) => (f.mejor != null && (m == null || f.mejor < (m.mejor as number)) ? f : m), null);
  const ultimaGlobal  = useMemo(() => {
    let ult: { t: number; ms: number; pid: string } | null = null;
    for (const v of vueltas) {
      if (v.tiempo_ms == null) continue;
      const t = horaServidor(v);
      if (!ult || t > ult.t) ult = { t, ms: v.tiempo_ms, pid: v.piloto_id };
    }
    return ult;
  }, [vueltas]);

  // Descargar la tanda visible como .xlsx con DOS hojas:
  //  1. "Resultado"       → la tabla oficial, tal cual se ve en pantalla
  //  2. "Vuelta a vuelta" → un bloque por piloto con todas sus vueltas, con el
  //     formato de las planillas de cronometraje (vuelta, tiempo, diferencia
  //     contra su mejor, hora del día)
  const descargarResultados = () => {
    if (!tandaSel || filas.length === 0) return;
    const fecha = new Date(tandaSel.inicio);
    const cab = `${tandaSel.nombre} · ${fecha.toLocaleDateString("es-CL")} ${fecha.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} · ${tandaSel.fin ? "Finalizada" : "En curso"}`;

    const hojaResultado: Celda[][] = [
      [cab],
      [],
      ["Pos", "Número", "Piloto", "Vueltas", "Diferencia", "Mejor", "Última", "Estado"],
      ...filas.map(f => [f.pos, f.numero || "", f.nombre, f.completadas, f.gap, fmtMs(f.mejor), fmtMs(f.ultima), f.estado.label] as Celda[]),
    ];

    const hojaVueltas: Celda[][] = [[cab], []];
    for (const f of filas) {
      hojaVueltas.push([`${f.numero ? `(${f.numero}) ` : ""}${f.nombre}`]);
      hojaVueltas.push(["Vuelta", "Tiempo de vuelta", "Dif. resp. mejor", "Hora del día"]);
      if (f.detalle.length === 0) {
        hojaVueltas.push(["", "sin vueltas completadas"]);
      } else {
        for (const v of f.detalle) {
          hojaVueltas.push([v.n, fmtMs(v.tiempoMs), v.esMejor ? "" : fmtDif(v.difMejor), fmtHora(v.cruceAt)]);
        }
      }
      hojaVueltas.push([]);
    }

    descargarXlsx(
      [{ nombre: "Resultado", filas: hojaResultado }, { nombre: "Vuelta a vuelta", filas: hojaVueltas }],
      `resultados-${tandaSel.nombre.replace(/\s+/g, "-")}-${fecha.toISOString().slice(0, 10)}.xlsx`,
    );
  };

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

  // ── Control de tanda (compartido con el Log de acciones) ──
  const tandaActiva = tandas.find(t => t.id === tandaActivaId);
  const nombreTandaActiva = tandaActiva?.nombre || "tanda";

  const marcarLargada = async () => {
    if (!tandaActivaId || marcandoLargada) return;
    setMarcandoLargada(true);
    const ahora = new Date().toISOString();
    const { error } = await supabase.from("tandas").update({ largada_at: ahora }).eq("id", tandaActivaId);
    if (!error) {
      setTandas(prev => prev.map(t => (t.id === tandaActivaId ? { ...t, largada_at: ahora } : t)));
    }
    setMarcandoLargada(false);
  };
  const controlTanda = onIniciarTanda ? (
    <div className="flex items-center gap-2 flex-wrap">
      {tandaActivaId ? (
        <>
          {/* Largada: se marca cuando se retira el pace car. Los cruces
              anteriores son vuelta de formación y dejan de contar. */}
          {tandaActiva?.tipo === "carrera" && !tandaActiva?.largada_at && (
            <button
              onClick={marcarLargada}
              disabled={marcandoLargada}
              title="Marcar el momento de la largada: las pasadas detrás del pace car dejan de contar como vueltas de carrera"
              className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-60"
              style={{ background: "#16a34a", color: "#fff" }}
            >
              {marcandoLargada ? "Marcando…" : "🟢 Largada"}
            </button>
          )}
          {tandaActiva?.tipo === "carrera" && tandaActiva?.largada_at && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: "#14532d", color: "#4ade80" }}>
              🟢 Largada {new Date(tandaActiva.largada_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <button
            onClick={onFinalizarTanda}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85"
            style={{ background: "#dc2626", color: "#fff" }}
          >
            ⏹ Finalizar {nombreTandaActiva}
          </button>
        </>
      ) : cfgTipo ? (
        <>
          <span className="text-xs font-bold" style={{ color: "#e4e4e7" }}>▶ {TIPO_LABEL[cfgTipo]}</span>
          <label className="text-xs flex items-center gap-1" style={{ color: "#71717a" }}>
            Duración
            <input
              type="number" min={1} value={cfgDur} onChange={e => setCfgDur(e.target.value)}
              className="w-14 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none"
              style={{ background: "#1c1f27", color: "#e4e4e7", border: "1px solid #3f3f46" }}
            />
            min
          </label>
          {cfgTipo === "carrera" && (
            <label className="text-xs flex items-center gap-1" style={{ color: "#71717a" }}>
              Vueltas
              <input
                type="number" min={1} value={cfgVueltas} onChange={e => setCfgVueltas(e.target.value)}
                className="w-14 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none"
                style={{ background: "#1c1f27", color: "#e4e4e7", border: "1px solid #3f3f46" }}
              />
            </label>
          )}
          <button
            onClick={() => {
              onIniciarTanda(cfgTipo, Math.max(0, parseInt(cfgDur) || 0) || null, Math.max(0, parseInt(cfgVueltas) || 0) || null);
              setCfgTipo(null);
            }}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85"
            style={{ background: "#16a34a", color: "#fff" }}
          >
            Iniciar
          </button>
          <button onClick={() => setCfgTipo(null)} className="text-xs px-1" style={{ color: "#71717a" }} aria-label="Cancelar">✕</button>
        </>
      ) : (
        <>
          <span className="text-xs" style={{ color: "#71717a" }}>Iniciar tanda:</span>
          {(["libre", "entrenamiento", "clasificacion", "carrera"] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                // Libre: sin duración ni reglas de término — parte al tiro
                if (t === "libre") onIniciarTanda("libre", null, null);
                else setCfgTipo(t);
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors hover:text-white"
              style={{ background: "transparent", color: "#a1a1aa", border: "1px solid #3f3f46" }}
            >
              ▶ {TIPO_LABEL[t]}
            </button>
          ))}
        </>
      )}
    </div>
  ) : null;

  if (!tandaSel) {
    return (
      <div className="rounded-2xl px-6 py-12 text-center" style={{ background: "#0f1117" }}>
        <p className="text-4xl mb-3">⏱</p>
        <p className="text-base font-bold" style={{ color: "#e4e4e7" }}>Sin tandas todavía</p>
        <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: "#71717a" }}>
          Inicia la primera tanda y el cronometraje parte solo.
        </p>
        <div className="mt-5 flex justify-center">{controlTanda}</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#0f1117" }}>

      {/* ── Control de tanda (se refleja también en el Log) ── */}
      {controlTanda && (
        <div className="px-4 sm:px-5 py-2.5" style={{ borderBottom: "1px solid #23262f", background: "#13161d" }}>
          {controlTanda}
        </div>
      )}

      {/* ── Cabecera: tanda + estado + contador ── */}
      <div className="px-4 sm:px-5 py-3.5 flex items-center gap-3 flex-wrap" style={{ borderBottom: "1px solid #23262f" }}>
        <span className="text-[11px] font-bold tracking-wider px-3 py-1 rounded-full" style={{ background: cfg!.bg, color: "#fff" }}>
          {tandaSel.nombre.toUpperCase()}
        </span>
        {tandaSel.fin ? (
          <span className="text-xs font-semibold" style={{ color: "#a1a1aa" }}>🏁 Finalizada</span>
        ) : esCarrera && ((tandaSel.vueltas_programadas && liderVueltas >= tandaSel.vueltas_programadas) || restanteS === 0) ? (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "#78350f", color: "#fcd34d" }}>
            🏁 Carrera completada — finaliza la tanda
          </span>
        ) : !esCarrera && restanteS === 0 ? (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: "#78350f", color: "#fcd34d" }}>
            ⏱ Tiempo cumplido — últimas vueltas en curso
          </span>
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
          <button
            onClick={descargarResultados}
            disabled={filas.length === 0}
            title="Descargar los resultados de esta tanda (CSV, se abre en Excel)"
            className="text-xs font-medium px-2.5 py-1 rounded-lg transition-colors hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "transparent", color: "#a1a1aa", border: "1px solid #3f3f46" }}
          >
            ⬇ Resultados
          </button>
          <select
            value={tandaSelId ?? ""}
            onChange={e => { setTandaSelId(e.target.value); onSeleccionarTanda?.(e.target.value); }}
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
              <Fragment key={f.pid}>
              <tr
                onClick={() => setPilotoAbierto(p => (p === f.pid ? null : f.pid))}
                title="Ver el vuelta a vuelta de este piloto"
                className="cursor-pointer"
                style={{ borderTop: "1px solid #1c1f27", color: "#d4d4d8",
                         background: pilotoAbierto === f.pid ? "#15181f" : undefined }}>
                <td className="py-2.5 pl-4 sm:pl-5 pr-2 font-bold" style={{ color: f.pos === 1 ? "#facc15" : "#71717a" }}>
                  <span style={{ color: "#52525b", fontSize: 10, marginRight: 4 }}>{pilotoAbierto === f.pid ? "▾" : "▸"}</span>
                  {f.pos}
                </td>
                <td className="py-2.5 px-2 whitespace-nowrap">
                  <span className="inline-flex items-center justify-center min-w-[26px] h-[22px] rounded-md text-[11px] font-bold mr-2 px-1" style={{ background: "#27272a", color: "#fbbf24" }}>
                    {f.numero || f.nombre.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  {f.nombre}
                </td>
                <td className="py-2.5 px-2 text-center tabular-nums">
                  {f.completadas}
                  {f.sospechosas > 0 && (
                    <span
                      title={`${f.sospechosas} vuelta${f.sospechosas > 1 ? "s" : ""} anormalmente larga${f.sospechosas > 1 ? "s" : ""}: probable pérdida de señal, el conteo puede estar corto`}
                      className="ml-1.5 text-[11px] font-bold"
                      style={{ color: "#fbbf24" }}
                    >⚠</span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "#a1a1aa" }}>{f.gap}</td>
                <td className="py-2.5 px-2 text-right tabular-nums font-medium" style={{ color: f.esMejorAbs ? "#c084fc" : "#e4e4e7" }}>{fmtMs(f.mejor)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums" style={{ color: "#a1a1aa" }}>{fmtMs(f.ultima)}</td>
                <td className="py-2.5 pl-2 pr-4 sm:pr-5">
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: f.estado.bg, color: f.estado.color }}>
                    {f.estado.label}
                  </span>
                </td>
              </tr>

              {/* Vuelta a vuelta del piloto */}
              {pilotoAbierto === f.pid && (
                <tr style={{ background: "#0d0f14" }}>
                  <td colSpan={7} className="px-4 sm:px-5 py-3">
                    {f.detalle.length === 0 ? (
                      <p className="text-xs" style={{ color: "#71717a" }}>Todavía no completó vueltas.</p>
                    ) : (
                      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ color: "#71717a" }}>
                            <th className="text-left font-semibold py-1 pr-3">Vuelta</th>
                            <th className="text-right font-semibold py-1 px-3">Tiempo</th>
                            <th className="text-right font-semibold py-1 px-3">Dif. a su mejor</th>
                            <th className="text-right font-semibold py-1 pl-3">Hora del día</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.detalle.map(v => (
                            <tr key={v.n} style={{ borderTop: "1px solid #16181e" }}>
                              <td className="py-1 pr-3 tabular-nums" style={{ color: "#a1a1aa" }}>{v.n}</td>
                              <td className="py-1 px-3 text-right tabular-nums font-medium"
                                  style={v.esMejor
                                    ? { background: "#2e1065", color: "#c084fc", borderRadius: 4 }
                                    : { color: "#e4e4e7" }}>
                                {fmtMs(v.tiempoMs)}
                              </td>
                              <td className="py-1 px-3 text-right tabular-nums" style={{ color: "#71717a" }}>
                                {v.esMejor ? "—" : fmtDif(v.difMejor)}
                              </td>
                              <td className="py-1 pl-3 text-right tabular-nums" style={{ color: "#52525b" }}>
                                {fmtHora(v.cruceAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
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

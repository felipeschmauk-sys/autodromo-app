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
import { esVueltaDeCarrera, deadlineTanda, transcurridoTandaS, tandaEnPausa } from "@/lib/carrera";
import { DETENIDO_KMH, REANUDA_KMH, DETENIDO_MS } from "@/lib/gps";
import { registrarLog } from "@/lib/log";
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
  /** Reporta el estado que se reparte a los pilotos, para que el panel muestre el MISMO dato */
  onEstado?: (pilotos: EstadoCarreraViva["pilotos"]) => void;
  onIniciarTanda?: (tipo: string, duracionMin: number | null, vueltas: number | null) => void;
  onFinalizarTanda?: () => void;
}

const TIPO_LABEL: Record<string, string> = {
  libre: "Libre", entrenamiento: "Entrenamiento", clasificacion: "Clasificación", carrera: "Carrera",
};

interface Tanda {
  id: string; tipo: string; nombre: string; inicio: string; fin: string | null;
  duracion_min?: number | null; vueltas_programadas?: number | null; meta_idx?: number | null;
  pausado_ms?: number | null; pausa_desde?: string | null;
  largada_at?: string | null;
}
interface VueltaRow {
  piloto_id: string; numero: number; cruce_at: string; tiempo_ms: number | null; valida: boolean;
  offset_ms?: number | null; // desfase del reloj de ESE teléfono contra el servidor
}
interface PilotoInfo { nombre: string; numero: string | null; categoria: string | null; }

// Cuánto puede tener de viejo el dato de un piloto para seguir clasificándolo.
// Las posiciones llegan a 1 Hz, así que 10 s son diez mensajes perdidos: eso ya
// no es un hipo de la red, es que dejamos de ver ese auto.
const FRESCURA_POS_MS = 10_000;

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

export default function Cronometraje({ fechaId, tandaSeleccionada, onSeleccionarTanda, tandaActivaId, onIniciarTanda, onFinalizarTanda, onEstado }: Props) {
  // Configuración local para iniciar una tanda desde Crono
  const [cfgTipo, setCfgTipo]       = useState<string | null>(null);
  const [cfgDur, setCfgDur]         = useState("15");
  const [cfgVueltas, setCfgVueltas] = useState("15");
  const [tandas, setTandas]         = useState<Tanda[]>([]);
  const [tandaSelId, setTandaSelId] = useState<string | null>(null);
  const [vueltas, setVueltas]       = useState<VueltaRow[]>([]);
  const [marcandoLargada, setMarcandoLargada] = useState(false);
  const [errorLargada, setErrorLargada] = useState<string | null>(null);
  const [pilotoAbierto, setPilotoAbierto] = useState<string | null>(null);
  // Filtro solo para la descarga: la tabla en pantalla muestra todo junto
  const [catDescarga, setCatDescarga] = useState<string>("");
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

  // ── La tanda que están CORRIENDO los pilotos ──────────────────
  // Ojo con la diferencia: `tandaSel` es la que el admin está mirando en el
  // desplegable, y cambiarla no debe alterar lo que ven los pilotos en pista.
  //
  // Va por ref y no por estado porque el emisor de más abajo vive dentro de un
  // setInterval de larga vida: si leyera la variable directamente se quedaría
  // con la que existía cuando el intervalo arrancó. Eso fue justamente lo que
  // pasó en la prueba del 27 sep 2026 — el emisor quedó congelado en la
  // clasificación anterior, así que durante toda la carrera los pilotos vieron
  // su posición por mejor vuelta en vez del orden de carrera, y la bandera azul
  // no llegó a evaluarse nunca. La tabla del panel sí se actualizaba, porque su
  // useMemo sí declara la tanda como dependencia.
  const tandaVivaRef = useRef<Tanda | null>(null);
  useEffect(() => {
    tandaVivaRef.current = tandas.find(t => t.id === tandaActivaId) ?? null;
  }, [tandas, tandaActivaId]);

  // ── Verificación de la relargada ────────────────────────────
  // Tras una roja, el verde significa que la carrera se relanza en el siguiente
  // paso por meta: es la línea la que marca el momento, no la bandera. Así que
  // el orden real de relargada son los PRIMEROS CRUCES posteriores al verde.
  //
  // Medirlo en la meta y no por GPS es lo que hace esto confiable: el detector
  // de cruces tiene error de centésimas, mientras que comparar posiciones GPS
  // de autos en fila india sería adivinar.
  //
  // El sistema no bloquea nada. Solo deja constancia en el log para que los
  // comisarios evalúen, con la diferencia de tiempo medida para que puedan
  // distinguir un roce de una ventaja real.
  const relargadaRevisadaRef = useRef<string | null>(null);
  useEffect(() => {
    const t = tandaVivaRef.current;
    const desde = (t as any)?.relargada_desde as string | undefined;
    const fila = (t as any)?.orden_relargada as
      { pid: string; pos: number }[] | undefined;
    if (!t || !desde || !fila?.length) return;
    if (relargadaRevisadaRef.current === `${t.id}:${desde}`) return;

    const desdeMs = new Date(desde).getTime();
    // Primer cruce de cada piloto después del verde
    const primeros = new Map<string, number>();
    for (const v of vueltas) {
      const ms = new Date(v.cruce_at).getTime();
      if (ms <= desdeMs || primeros.has(v.piloto_id)) continue;
      primeros.set(v.piloto_id, ms);
    }
    // Se espera a que crucen todos los que estaban en la fila
    if (fila.some(p => !primeros.has(p.pid))) return;
    relargadaRevisadaRef.current = `${t.id}:${desde}`;

    const real = [...primeros.entries()].sort((a, b) => a[1] - b[1]);
    const posReal = new Map(real.map(([pid], i) => [pid, i + 1]));
    const nombreDe = (pid: string) =>
      pilotosInfo.get(pid)?.numero || pilotosInfo.get(pid)?.nombre || pid.slice(0, 6);

    for (const p of fila) {
      const obtenida = posReal.get(p.pid)!;
      if (obtenida >= p.pos) continue;   // largó donde le tocaba, o más atrás
      // A quién le pasó por delante, y por cuánto
      const debioIrDetras = fila
        .filter(q => q.pos < p.pos && posReal.get(q.pid)! > obtenida)
        .map(q => nombreDe(q.pid));
      const miTiempo = primeros.get(p.pid)!;
      const peor = fila
        .filter(q => q.pos < p.pos && posReal.get(q.pid)! > obtenida)
        .reduce((m, q) => Math.max(m, primeros.get(q.pid)! - miTiempo), 0);
      registrarLog({
        fecha_id: fechaId,
        piloto_id: p.pid,
        tanda_id: t.id,
        tipo: "relargada",
        descripcion:
          `⚖️ ${nombreDe(p.pid)} relargó ${p.pos - obtenida}° adelante de lo que correspondía ` +
          `(le tocaba ${p.pos}°, cruzó ${obtenida}°). Pasó a ${debioIrDetras.join(", ")} ` +
          `por ${(peor / 1000).toFixed(2)} s. Para evaluación de los comisarios.`,
      });
    }
  }, [vueltas, pilotosInfo, fechaId]);

  // ── Llegada: estado que NO puede perderse a mitad de carrera ──
  // Quién ya terminó, en qué posición llegó, y con cuántas vueltas venía cada
  // uno cuando cruzó el líder. Se limpia solo al cambiar de tanda.
  const congeladosRef  = useRef<Map<string, EstadoCarreraViva["pilotos"][string]>>(new Map());
  const alTerminarRef  = useRef<Map<string, number>>(new Map());
  const liderTerminoRef = useRef(false);
  // Cómo llegó cada piloto que ya terminó: con cuántas vueltas y en qué
  // instante cruzó. El resultado oficial sale de acá —vueltas primero, y entre
  // iguales quién cruzó antes— y no de la distancia recorrida, porque justo al
  // cruzar la meta el progreso de vuelta vuelve a cero y ese es el peor
  // instante para medir.
  const llegadasRef = useRef<Map<string, { vueltas: number; t: number }>>(new Map());
  // Desde cuándo viene lento cada auto, para no marcar como detenido al que
  // solo está pasando despacio por una curva
  const lentoDesdeRef = useRef<Map<string, number>>(new Map());
  // Por ref: el emisor vive en un setInterval de larga vida y no debe
  // reiniciarse porque el padre pase una función nueva en cada render
  const onEstadoRef = useRef(onEstado);
  useEffect(() => { onEstadoRef.current = onEstado; }, [onEstado]);
  useEffect(() => {
    congeladosRef.current = new Map();
    alTerminarRef.current = new Map();
    llegadasRef.current   = new Map();
    liderTerminoRef.current = false;
  }, [tandaActivaId]);

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
      if (error) {
        // Solo el error "la tabla no existe" (42P01) significa de verdad que
        // falta correr la migración. Cualquier otro —timeout, red, la base
        // ocupada un segundo— es un tropiezo pasajero y no se toca nada.
        //
        // Antes acá cualquier error levantaba el cartel "Cronometraje sin
        // configurar", y como nunca volvía a bajar, una sola consulta lenta
        // dejaba al director sin cronómetro hasta recargar la página. Pasó el
        // 4-10-2026 en plena jornada, con la migración corrida hacía meses.
        if (error.code === "42P01") setMigracionOk(false);
        return;
      }
      setMigracionOk(true);   // una consulta buena repone el estado
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
      // Se pide la categoría junto con el nombre. Si la migración de categorías
      // aún no se corrió, se cae al pedido de siempre y todo sigue funcionando.
      const res = await supabase
        .from("inscripciones")
        .select("piloto_id, pilotos(nombre, numero, categorias(nombre))")
        .eq("fecha_id", fechaId);
      let data: any[] | null = res.data as any;
      if (res.error) {
        const r2 = await supabase
          .from("inscripciones")
          .select("piloto_id, pilotos(nombre, numero)")
          .eq("fecha_id", fechaId);
        data = r2.data as any;
        if (r2.error) {
          const r3 = await supabase
            .from("inscripciones")
            .select("piloto_id, pilotos(nombre)")
            .eq("fecha_id", fechaId);
          data = r3.data as any;
        }
      }
      const m = new Map<string, PilotoInfo>();
      (data || []).forEach((r: any) => {
        m.set(r.piloto_id, {
          nombre:    r.pilotos?.nombre || "Piloto",
          numero:    r.pilotos?.numero ?? null,
          categoria: r.pilotos?.categorias?.nombre ?? null,
        });
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
    //
    // Vive en refs y no en variables de este efecto porque el efecto se puede
    // volver a montar en medio de la carrera —basta con que el panel se recargue
    // o que cambie una de sus dependencias— y entonces todo esto se perdía: el
    // líder "volvía a terminar", los que ya habían llegado se recongelaban con
    // otra posición y el resultado quedaba revuelto.
    const congelados = congeladosRef.current;
    const vueltasAlTerminarElLider = alTerminarRef.current;

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

      // En carrera manda la distancia recorrida; en entrenamiento y
      // clasificación, la posición en pista (cada uno lleva vueltas distintas).
      // Se lee del ref en cada tick: lo que ven los pilotos depende de la tanda
      // que están corriendo, no de la que el admin tenga abierta en pantalla.
      const tandaViva = tandaVivaRef.current;
      const esCarreraTanda = tandaViva?.tipo === "carrera";
      const gaps = calcularGaps(estados, {
        largo: largoCircuito, ahora, modo: esCarreraTanda ? "carrera" : "libre",
      });
      const orden = [...estados].sort(
        (a, b) => recorridoTotal(b, largoCircuito) - recorridoTotal(a, largoCircuito));

      // ── Posición DENTRO de la categoría ───────────────────────
      // Un piloto compite contra los de su categoría: uno de una categoría más
      // rápida no debe empujarlo hacia abajo. Sin categoría no hay posición —
      // queda en lista de espera, pero sigue operando en pista.
      const info = new Map(filasRef.current.map(f => [f.pid, f]));
      const catDe = (pid: string) => info.get(pid)?.categoria ?? null;
      const posDe = new Map<string, number | null>();

      if (esCarreraTanda) {
        // ── Sin datos recientes no hay posición ─────────────────
        // La posición de carrera se ordena por lo que cada auto está haciendo
        // AHORA. Un piloto del que no se sabe hace rato no se puede clasificar,
        // y tampoco se puede clasificar al resto contra él: si no sé dónde
        // está, no sé si voy tercero o cuarto.
        //
        // En la prueba del 27 sep el notebook del panel viajaba dentro de un
        // auto colgado de un teléfono. Al cortarse la señal el panel siguió
        // ordenando con posiciones de minutos atrás, y entregó números que
        // parecían normales y estaban equivocados —un piloto se vio primero
        // cuando iba cuarto—. Mejor un guion que un número falso.
        //
        // No aplica a entrenamiento ni clasificación: ese orden sale de los
        // tiempos guardados en la base, que no se degradan si se corta el
        // broadcast.
        const catSinDatos = new Set<string>();
        for (const e of estados) {
          if (ahora - e.t <= FRESCURA_POS_MS) continue;
          if (congelados.has(e.pid)) continue; // ya llegó: su resultado ya está fijo
          const cat = catDe(e.pid);
          if (cat) catSinDatos.add(cat);
        }
        // Por orden de carrera, contando solo a los de la misma categoría
        const vistos = new Map<string, number>();
        for (const e of orden) {
          const cat = catDe(e.pid);
          if (!cat || catSinDatos.has(cat)) { posDe.set(e.pid, null); continue; }
          const n = (vistos.get(cat) ?? 0) + 1;
          vistos.set(cat, n);
          posDe.set(e.pid, n);
        }
      } else {
        // Por tabla de tiempos: manda la mejor vuelta. Sin tiempo marcado no
        // hay posición todavía, y en pantalla se muestra "--"
        const porCat = new Map<string, { pid: string; mejor: number }[]>();
        for (const e of estados) {
          const cat = catDe(e.pid);
          const mejor = info.get(e.pid)?.mejor ?? null;
          if (!cat || mejor == null) { posDe.set(e.pid, null); continue; }
          if (!porCat.has(cat)) porCat.set(cat, []);
          porCat.get(cat)!.push({ pid: e.pid, mejor });
        }
        porCat.forEach(lista => {
          lista.sort((a, b) => a.mejor - b.mejor);
          lista.forEach((x, i) => posDe.set(x.pid, i + 1));
        });
      }

      const pilotos: EstadoCarreraViva["pilotos"] = {};
      orden.forEach((e) => {
        const g = gaps.get(e.pid);
        if (!g) return;
        // La bandera azul se enciende y se apaga sola. La histéresis evita que
        // titile, y el adelantamiento consumado la baja de inmediato. Solo
        // existe en carrera: en entrenamiento nadie está doblando a nadie.
        const est = esCarreraTanda
          ? sostenerAzul(azulRef.current.get(e.pid), g.azul, ahora, { pasaronPor: g.pasaronPor })
          : { activa: false, pid: null, desde: 0, ultimoOk: 0 };
        azulRef.current.set(e.pid, est);
        // Sin categoría: no hay posición ni diferencias, pero sí bandera azul.
        // Es seguridad, no clasificación. Y sigue contando como referencia para
        // los demás: si no, el gap de quien lo tiene delante saltaría al auto
        // siguiente y no coincidiría con lo que ve por el parabrisas.
        const sinCat = catDe(e.pid) == null;
        pilotos[e.pid] = {
          pos:  posDe.get(e.pid) ?? null,
          vu:   e.vueltas,
          ad:   sinCat ? null : g.adelante,
          at:   sinCat ? null : g.atras,
          azul: est.activa,
        };
      });

      // ── Meta final: congelar a cada uno en su propio cruce ──
      const programadas = tandaViva?.vueltas_programadas ?? null;
      if (programadas && orden.length) {
        if (!liderTerminoRef.current && orden[0].vueltas >= programadas) {
          liderTerminoRef.current = true;
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
            (liderTerminoRef.current && e.vueltas > (vueltasAlTerminarElLider.get(e.pid) ?? Infinity));
          if (!yaCruzoSuMeta) continue;
          // Se anota CÓMO llegó: con cuántas vueltas y en qué instante. La
          // posición sale de ahí y no de la distancia recorrida, porque al
          // cruzar la meta el progreso de vuelta vuelve a cero y ese es el peor
          // momento para medir: el que acaba de llegar aparecería detrás de
          // cualquiera que venga a mitad de su vuelta.
          llegadasRef.current.set(e.pid, { vueltas: e.vueltas, t: ahora });
          congelados.set(e.pid, { ...suyo, azul: false, fin: true });
        }

        // Posición final de los que ya llegaron: mandan las vueltas, y entre
        // los que tienen las mismas, quién cruzó primero. Un doblado termina
        // detrás de los de la vuelta del líder aunque haya cruzado antes que
        // alguno de ellos. Se recalcula en cada tick porque un piloto puede
        // llegar después y con MÁS vueltas que otro que ya había terminado.
        const porCategoria = new Map<string, { pid: string; vueltas: number; t: number }[]>();
        llegadasRef.current.forEach((ll, pid) => {
          const cat = catDe(pid);
          if (!cat) return;
          if (!porCategoria.has(cat)) porCategoria.set(cat, []);
          porCategoria.get(cat)!.push({ pid, ...ll });
        });
        porCategoria.forEach(lista => {
          lista.sort((a, b) => b.vueltas - a.vueltas || a.t - b.t);
          lista.forEach((l, i) => {
            const cong = congelados.get(l.pid);
            if (cong) congelados.set(l.pid, { ...cong, pos: i + 1 });
          });
        });
      }
      // El dato congelado pisa al vivo: el piloto ya terminó y no debe ver
      // números que sigan moviéndose
      congelados.forEach((v, pid) => { pilotos[pid] = v; });

      // ── Autos detenidos en pista ──────────────────────────────
      // Se reparte la posición, no el sector: con bandera roja la advertencia
      // de sector queda tapada y el auto detenido se vuelve invisible para el
      // resto justo cuando más importa saber por dónde pasar con cuidado.
      const detenidos: EstadoCarreraViva["det"] = [];
      posicionesRef.current.forEach((p, pid) => {
        const kmh = p.v != null ? p.v * 3.6 : null;
        const visto = p.t ?? p.ts;
        if (p.dentro !== true || kmh == null || ahora - visto > FRESCURA_POS_MS) {
          lentoDesdeRef.current.delete(pid);
          return;
        }
        const yaMarcado = lentoDesdeRef.current.has(pid);
        // Para dejar de marcarlo hay que superar el umbral alto; para empezar,
        // basta con bajar del bajo
        if (kmh > (yaMarcado ? REANUDA_KMH : DETENIDO_KMH)) {
          lentoDesdeRef.current.delete(pid);
          return;
        }
        const desde = lentoDesdeRef.current.get(pid) ?? ahora;
        lentoDesdeRef.current.set(pid, desde);
        if (ahora - desde >= DETENIDO_MS) detenidos.push({ pid, lat: p.lat, lng: p.lng });
      });

      emisor.enviar({ t: ahora, pilotos, det: detenidos.length ? detenidos : undefined });
      // El mapa del panel muestra la MISMA diferencia que ve el piloto: si
      // saliera de otro cálculo dejaría de servir como verificación
      onEstadoRef.current?.(pilotos);
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
    const deadline = deadlineTanda(tandaSel);

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
    // Desde que cruza el primero, la carrera se resuelve por orden de llegada:
    // el resultado de quien ya terminó lo fija SU cruce y no se mueve más.
    // Antes el desempate entre dos con las mismas vueltas usaba la posición en
    // pista, así que el que seguía girando después de la bandera le pasaba por
    // delante al que se había detenido — el que había llegado primero.
    const programadas = tandaSel.vueltas_programadas ?? null;
    const termino = (s: { completadas: number }) =>
      programadas != null && s.completadas >= programadas;
    if (esCarrera) {
      lista.sort((a, b) =>
        b.completadas - a.completadas ||
        (termino(a) && termino(b)
          ? (a.lastCruce || Infinity) - (b.lastCruce || Infinity)  // ya llegaron
          : progreso(b.pid) - progreso(a.pid)) ||                  // aún girando
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
        categoria: info?.categoria ?? null,
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

  // Espejo de las filas: el intervalo necesita la categoría y la mejor vuelta
  // de cada piloto para armar la posición dentro de su propia categoría
  const filasRef = useRef<typeof filas>([]);
  useEffect(() => { filasRef.current = filas; }, [filas]);

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
    // La descarga puede acotarse a una categoría; la tabla en pantalla no se
    // separa, solo aclara a cuál pertenece cada piloto
    const filasDesc = catDescarga
      ? filas.filter(f => (f.categoria ?? "") === catDescarga)
      : filas;
    if (filasDesc.length === 0) return;
    const fecha = new Date(tandaSel.inicio);
    const cab = `${tandaSel.nombre} · ${fecha.toLocaleDateString("es-CL")} ${fecha.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} · ${tandaSel.fin ? "Finalizada" : "En curso"}`;

    const hojaResultado: Celda[][] = [
      [cab + (catDescarga ? ` · ${catDescarga}` : "")],
      [],
      ["Pos", "Número", "Piloto", "Categoría", "Vueltas", "Diferencia", "Mejor", "Última", "Estado"],
      ...filasDesc.map(f => [f.pos, f.numero || "", f.nombre, f.categoria ?? "", f.completadas, f.gap, fmtMs(f.mejor), fmtMs(f.ultima), f.estado.label] as Celda[]),
    ];

    const hojaVueltas: Celda[][] = [[cab], []];
    for (const f of filasDesc) {
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
      `resultados-${tandaSel.nombre.replace(/\s+/g, "-")}${catDescarga ? "-" + catDescarga.replace(/\s+/g, "-") : ""}-${fecha.toISOString().slice(0, 10)}.xlsx`,
    );
  };

  // Categorías presentes en esta tanda, para ofrecerlas en el filtro
  const categoriasEnTanda = Array.from(
    new Set(filas.map(f => f.categoria).filter((c): c is string => !!c))
  ).sort();

  const cfg = tandaSel ? (TIPO_CFG[tandaSel.tipo] || TIPO_CFG.entrenamiento) : null;
  const esCarrera = tandaSel?.tipo === "carrera";
  const liderVueltas = filas[0]?.completadas ?? 0;
  const inicioMs = tandaSel ? new Date(tandaSel.inicio).getTime() : 0;
  const finMs    = tandaSel?.fin ? new Date(tandaSel.fin).getTime() : null;
  // El tiempo de la tanda no corre mientras hay bandera roja
  const transcurridoS = tandaSel ? transcurridoTandaS(tandaSel, finMs ?? Date.now()) : 0;
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

  // Antes, si el update fallaba, el botón volvía a su estado normal y no decía
  // nada: en la prueba del 27 sep 2026 la columna `largada_at` no existía en la
  // base y la largada se marcó creyendo que había quedado registrada. Un botón
  // que no puede cumplir tiene que decirlo.
  const marcarLargada = async () => {
    if (!tandaActivaId || marcandoLargada) return;
    setMarcandoLargada(true);
    setErrorLargada(null);
    const ahora = new Date().toISOString();
    const { error } = await supabase.from("tandas").update({ largada_at: ahora }).eq("id", tandaActivaId);
    if (error) {
      setErrorLargada(
        /largada_at|column|schema cache/i.test(error.message)
          ? "Falta correr docs/task-largada-migration.sql en Supabase"
          : `No se pudo marcar: ${error.message}`
      );
    } else {
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
          {errorLargada && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg"
              style={{ background: "#450a0a", color: "#fca5a5" }}>
              ⚠ {errorLargada}
            </span>
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
          {/* Filtro solo de la descarga: la tabla en pantalla siempre muestra
              todas las categorías juntas, con la columna CAT. para distinguir */}
          {categoriasEnTanda.length > 0 && (
            <select
              value={catDescarga}
              onChange={e => setCatDescarga(e.target.value)}
              title="Categoría a incluir en la descarga"
              className="text-xs font-medium px-2 py-1 rounded-lg"
              style={{ background: "transparent", color: "#a1a1aa", border: "1px solid #3f3f46" }}
            >
              <option value="">Todas las categorías</option>
              {categoriasEnTanda.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button
            onClick={descargarResultados}
            disabled={filas.length === 0}
            title="Descargar los resultados de esta tanda en Excel, con una hoja por vuelta a vuelta"
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
              <th className="py-2 px-2">CAT.</th>
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
                <td className="py-2.5 px-2 whitespace-nowrap" style={{ color: f.categoria ? "#a1a1aa" : "#52525b" }}>
                  {f.categoria ?? "—"}
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
                  <td colSpan={8} className="px-4 sm:px-5 py-3">
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
                <td colSpan={8} className="py-10 text-center text-sm" style={{ color: "#52525b" }}>
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

"use client";

/**
 * CircuitoManager.tsx — components/CircuitoManager.tsx
 *
 * Biblioteca de circuitos guardados en Supabase.
 * Permite crear, editar y activar circuitos con trazado KML + dos geocercas.
 * Al "Activar", copia las coords a trazado_pista + geocerca (tablas activas usadas por
 * todos los demás componentes: DireccionCarrera, SpeedCard, etc.) sin cambiar nada más.
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { guardarTrazado, guardarGeocerca, type Coordenada } from "@/lib/gps";

// ── Helpers ─────────────────────────────────────────────────────

/** Distancia total del trazado en km usando la fórmula de Haversine */
function calcularKm(coords: Coordenada[]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const R  = 6371;
    const d1 = (coords[i].lat - coords[i - 1].lat) * Math.PI / 180;
    const d2 = (coords[i].lng - coords[i - 1].lng) * Math.PI / 180;
    const a  = Math.sin(d1 / 2) ** 2
             + Math.cos(coords[i - 1].lat * Math.PI / 180)
             * Math.cos(coords[i].lat     * Math.PI / 180)
             * Math.sin(d2 / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return Math.round(total * 1000) / 1000; // 3 decimales
}

/** Formatea km: "1.642 km" o "843 m" si < 1 km */
function fmtKm(coords: Coordenada[]): string {
  const km = calcularKm(coords);
  if (km === 0) return "—";
  return km >= 1 ? `${km.toFixed(3)} km` : `${Math.round(km * 1000)} m`;
}

function parsearKML(texto: string): Coordenada[] | null {
  try {
    const doc = new DOMParser().parseFromString(texto, "text/xml");
    const nodes = doc.getElementsByTagName("coordinates");
    if (!nodes.length) return null;
    let mejor = "";
    for (let i = 0; i < nodes.length; i++) {
      const t = nodes[i].textContent || "";
      if (t.length > mejor.length) mejor = t;
    }
    const coords: Coordenada[] = [];
    for (const p of mejor.trim().split(/\s+/)) {
      const [lngS, latS] = p.split(",");
      const lat = parseFloat(latS), lng = parseFloat(lngS);
      if (!isNaN(lat) && !isNaN(lng)) coords.push({ lat, lng });
    }
    return coords.length >= 3 ? coords : null;
  } catch { return null; }
}

function cargarLeaflet(): Promise<any> {
  return new Promise(resolve => {
    if ((window as any).L) { resolve((window as any).L); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (document.getElementById("leaflet-js")) {
      const iv = setInterval(() => { if ((window as any).L) { clearInterval(iv); resolve((window as any).L); } }, 50);
      return;
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve((window as any).L);
    document.head.appendChild(script);
  });
}

// ── Types ────────────────────────────────────────────────────────

interface Circuito {
  id: string;
  nombre: string;
  descripcion: string;
  ciudad: string;
  trazado_coords: Coordenada[];
  geocerca_pista: Coordenada[];
  geocerca_recinto: Coordenada[];
  max_pilotos: number;
  created_at: string;
}

type ModoMapa = null | "pista" | "recinto";
type Vista = "lista" | "nuevo" | "editar";

// ── Mapa editor (sub-componente) ─────────────────────────────────

function MapaCircuito({
  mapKey, trazado, geocercaPista, geocercaRecinto,
  onTrazadoChange, onPistaChange, onRecintoChange,
}: {
  mapKey: string;
  trazado: Coordenada[];
  geocercaPista: Coordenada[];
  geocercaRecinto: Coordenada[];
  onTrazadoChange: (c: Coordenada[]) => void;
  onPistaChange:   (c: Coordenada[]) => void;
  onRecintoChange: (c: Coordenada[]) => void;
}) {
  const mapRef         = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const pistaLayerRef  = useRef<any>(null);
  const recintoLayerRef = useRef<any>(null);
  const trazadoLayerRef = useRef<any>(null);
  const vxRef          = useRef<any[]>([]);
  const kmlInputRef    = useRef<HTMLInputElement>(null);

  const [modo, setModo] = useState<ModoMapa>(null);
  const [pts,  setPts]  = useState<Coordenada[]>([]);
  const [kmlMsg, setKmlMsg] = useState<string | null>(null);

  // Refs para closures
  const geocercaPistaRef   = useRef(geocercaPista);
  const geocercaRecintoRef = useRef(geocercaRecinto);
  useEffect(() => { geocercaPistaRef.current   = geocercaPista;   }, [geocercaPista]);
  useEffect(() => { geocercaRecintoRef.current = geocercaRecinto; }, [geocercaRecinto]);

  useEffect(() => {
    if (!mapRef.current) return;
    cargarLeaflet().then(L => {
      if (!mapRef.current || mapInstanceRef.current) return;
      const map = L.map(mapRef.current, { center: [-33.58, -70.58], zoom: 15 });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20 }
      ).addTo(map);
      mapInstanceRef.current = map;

      if (trazado.length >= 2)         drawTrazado(L, map, trazado);
      if (geocercaPista.length >= 3)   drawPista(L, map, geocercaPista);
      if (geocercaRecinto.length >= 3) drawRecinto(L, map, geocercaRecinto);

      const allCoords = [...trazado, ...geocercaPista, ...geocercaRecinto];
      if (allCoords.length) {
        map.fitBounds(L.latLngBounds(allCoords.map(c => [c.lat, c.lng])), { padding: [30, 30] });
      }
    });
    return () => {
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;
    const onClick = (e: any) => {
      if (!modo) return;
      const nueva: Coordenada = { lat: e.latlng.lat, lng: e.latlng.lng };
      setPts(prev => {
        const next = [...prev, nueva];
        if (modo === "pista")   drawPistaTemp(L, map, next);
        else                    drawRecintoTemp(L, map, next);
        return next;
      });
    };
    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [modo]);

  // ── Dibujo helpers ─────────────────────────────────────────────

  const drawTrazado = (L: any, map: any, c: Coordenada[]) => {
    trazadoLayerRef.current?.remove();
    trazadoLayerRef.current = L.polyline(c.map(p => [p.lat, p.lng]),
      { color: "#f59e0b", weight: 3, opacity: 0.9 }).addTo(map);
  };
  const drawPista = (L: any, map: any, c: Coordenada[]) => {
    pistaLayerRef.current?.remove(); pistaLayerRef.current = null;
    if (c.length < 3) return;
    pistaLayerRef.current = L.polygon(c.map(p => [p.lat, p.lng]),
      { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.12, weight: 2 })
      .bindTooltip("Geocerca pista").addTo(map);
  };
  const drawPistaTemp = (L: any, map: any, c: Coordenada[]) => {
    vxRef.current.forEach(m => m.remove()); vxRef.current = [];
    pistaLayerRef.current?.remove(); pistaLayerRef.current = null;
    if (c.length < 2) return;
    pistaLayerRef.current = L.polygon(c.map(p => [p.lat, p.lng]),
      { color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.12, weight: 2 }).addTo(map);
    c.forEach(p => {
      vxRef.current.push(L.circleMarker([p.lat, p.lng],
        { radius: 4, color: "#22c55e", fillColor: "#000", fillOpacity: 1, weight: 2 }).addTo(map));
    });
  };
  const drawRecinto = (L: any, map: any, c: Coordenada[]) => {
    recintoLayerRef.current?.remove(); recintoLayerRef.current = null;
    if (c.length < 3) return;
    recintoLayerRef.current = L.polygon(c.map(p => [p.lat, p.lng]),
      { color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.07, weight: 2, dashArray: "6 4" })
      .bindTooltip("Geocerca recinto").addTo(map);
  };
  const drawRecintoTemp = (L: any, map: any, c: Coordenada[]) => {
    vxRef.current.forEach(m => m.remove()); vxRef.current = [];
    recintoLayerRef.current?.remove(); recintoLayerRef.current = null;
    if (c.length < 2) return;
    recintoLayerRef.current = L.polygon(c.map(p => [p.lat, p.lng]),
      { color: "#6366f1", fillColor: "#6366f1", fillOpacity: 0.07, weight: 2, dashArray: "6 4" }).addTo(map);
    c.forEach(p => {
      vxRef.current.push(L.circleMarker([p.lat, p.lng],
        { radius: 4, color: "#6366f1", fillColor: "#000", fillOpacity: 1, weight: 2 }).addTo(map));
    });
  };

  const confirmar = () => {
    if (pts.length < 3) return;
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    if (modo === "pista")   { onPistaChange(pts);   if (L && map) drawPista(L, map, pts); }
    else                    { onRecintoChange(pts);  if (L && map) drawRecinto(L, map, pts); }
    vxRef.current.forEach(m => m.remove()); vxRef.current = [];
    setPts([]); setModo(null);
  };

  const cancelar = () => {
    vxRef.current.forEach(m => m.remove()); vxRef.current = [];
    setPts([]); setModo(null);
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    if (L && map) {
      if (geocercaPistaRef.current.length >= 3)   drawPista(L, map, geocercaPistaRef.current);
      if (geocercaRecintoRef.current.length >= 3) drawRecinto(L, map, geocercaRecintoRef.current);
    }
  };

  const handleKML = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const coords = parsearKML(ev.target?.result as string);
      if (!coords) { setKmlMsg("⚠ No se encontraron coordenadas en el KML."); return; }
      onTrazadoChange(coords);
      const L = (window as any).L;
      const map = mapInstanceRef.current;
      if (L && map) {
        drawTrazado(L, map, coords);
        map.fitBounds(L.latLngBounds(coords.map((c: Coordenada) => [c.lat, c.lng])), { padding: [40, 40] });
      }
      setKmlMsg(`✓ Trazado importado: ${fmtKm(coords)}`);
      setTimeout(() => setKmlMsg(null), 3000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      <style>{`.leaflet-container{background:#0a0a0a!important}.leaflet-popup-content-wrapper{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}.leaflet-popup-tip-container{display:none}.leaflet-control-attribution{display:none!important}.leaflet-bar a{background:#1a1a1a!important;color:#fff!important;border-color:#333!important}`}</style>
      <input ref={kmlInputRef} type="file" accept=".kml" className="hidden" onChange={handleKML} />

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2">
        {!modo ? (
          <>
            <button onClick={() => kmlInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-900/40 text-amber-300 hover:bg-amber-900/60 border border-amber-800 transition">
              📂 Importar KML
            </button>
            <button onClick={() => { setPts([]); setModo("pista"); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800 transition">
              ✏️ Geocerca pista
            </button>
            <button onClick={() => { setPts([]); setModo("recinto"); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-900/40 text-indigo-300 hover:bg-indigo-900/60 border border-indigo-800 transition">
              ✏️ Geocerca recinto
            </button>
          </>
        ) : (
          <>
            <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${modo === "pista" ? "bg-green-600" : "bg-indigo-600"}`}>
              ✏️ {modo === "pista" ? "Geocerca pista" : "Geocerca recinto"} — clic en el mapa
            </span>
            <span className="text-xs text-gray-500 self-center">{pts.length} puntos{pts.length >= 3 ? " ✓" : " (mín. 3)"}</span>
            {pts.length >= 3 && (
              <button onClick={confirmar}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-gray-900 hover:bg-gray-200 transition">
                ✓ Confirmar
              </button>
            )}
            <button onClick={cancelar}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 transition">
              Cancelar
            </button>
          </>
        )}
      </div>

      {kmlMsg && (
        <p className={`text-xs ${kmlMsg.startsWith("⚠") ? "text-red-400" : "text-amber-400"}`}>{kmlMsg}</p>
      )}

      {/* Leyenda */}
      <div className="flex gap-4 text-xs text-gray-600 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400 inline-block rounded" />Trazado</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-green-500 inline-block rounded" />Geocerca pista</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-indigo-500 inline-block rounded" style={{ borderTop: "2px dashed #6366f1", background: "transparent" }} />Geocerca recinto</span>
      </div>

      {/* Mapa */}
      <div className="relative rounded-xl overflow-hidden border border-gray-800" style={{ height: 380 }}>
        <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

// ── CircuitoManager principal ────────────────────────────────────

interface CircuitoManagerProps {
  onMaxPilotosChange?: (max: number) => void;
}

export default function CircuitoManager({ onMaxPilotosChange }: CircuitoManagerProps) {
  const [circuitos,    setCircuitos]    = useState<Circuito[]>([]);
  const [busqueda,     setBusqueda]     = useState("");
  const [cargando,     setCargando]     = useState(true);
  const [vista,        setVista]        = useState<Vista>("lista");
  const [seleccionado, setSeleccionado] = useState<Circuito | null>(null);
  const [activoId,     setActivoId]     = useState<string | null>(null);

  // Form state
  const [nombre,           setNombre]           = useState("");
  const [descripcion,      setDescripcion]      = useState("");
  const [ciudad,           setCiudad]           = useState("");
  const [maxPilotos,       setMaxPilotos]       = useState(10);
  const [trazado,          setTrazado]          = useState<Coordenada[]>([]);
  const [geocercaPista,    setGeocercaPista]    = useState<Coordenada[]>([]);
  const [geocercaRecinto,  setGeocercaRecinto]  = useState<Coordenada[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [activando, setActivando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  const showMsg = (tipo: "ok" | "error", texto: string) => {
    setMsg({ tipo, texto });
    setTimeout(() => setMsg(null), 5000);
  };

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setCargando(true);
    const { data } = await supabase
      .from("circuitos")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setCircuitos(data);
    setCargando(false);
  };

  const filtrados = circuitos.filter(c =>
    c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (c.ciudad || "").toLowerCase().includes(busqueda.toLowerCase())
  );

  const iniciarNuevo = () => {
    setNombre(""); setDescripcion(""); setCiudad(""); setMaxPilotos(10);
    setTrazado([]); setGeocercaPista([]); setGeocercaRecinto([]);
    setSeleccionado(null);
    setVista("nuevo");
  };

  const iniciarEdicion = (c: Circuito) => {
    setNombre(c.nombre); setDescripcion(c.descripcion || "");
    setCiudad(c.ciudad || ""); setMaxPilotos(c.max_pilotos);
    setTrazado(c.trazado_coords || []);
    setGeocercaPista(c.geocerca_pista || []);
    setGeocercaRecinto(c.geocerca_recinto || []);
    setSeleccionado(c);
    setVista("editar");
  };

  const guardar = async () => {
    if (!nombre.trim()) { showMsg("error", "El nombre del circuito es obligatorio."); return; }
    setGuardando(true);
    const payload = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      ciudad: ciudad.trim(),
      max_pilotos: maxPilotos,
      trazado_coords: trazado,
      geocerca_pista: geocercaPista,
      geocerca_recinto: geocercaRecinto,
      updated_at: new Date().toISOString(),
    };

    const { error } = vista === "editar" && seleccionado
      ? await supabase.from("circuitos").update(payload).eq("id", seleccionado.id)
      : await supabase.from("circuitos").insert(payload);

    setGuardando(false);
    if (error) { showMsg("error", error.message); return; }

    // Si el circuito que se guardó es el activo, propagar max_pilotos al sistema en vivo
    const esActivo = vista === "editar" && seleccionado?.id === activoId;
    if (esActivo) {
      await supabase
        .from("estado_pista")
        .update({ max_pilotos: maxPilotos })
        .eq("activo", true);
      onMaxPilotosChange?.(maxPilotos);
    }

    showMsg("ok", vista === "editar" ? "Circuito actualizado." : "Circuito guardado correctamente.");
    await cargar();
    setVista("lista");
    setSeleccionado(null);
  };

  const activar = async (c: Circuito) => {
    const tieneCoords = c.trazado_coords?.length >= 2 || c.geocerca_pista?.length >= 3;
    if (!tieneCoords) {
      showMsg("error", "El circuito no tiene trazado ni geocercas configuradas.");
      return;
    }
    setActivando(true);
    try {
      if (c.trazado_coords?.length >= 2) {
        const res = await guardarTrazado(c.trazado_coords, c.nombre);
        if (res.error) throw new Error(res.error);
      }
      if (c.geocerca_pista?.length >= 3) {
        const res = await guardarGeocerca(c.geocerca_pista, "pista", c.nombre);
        if (res.error) throw new Error(res.error);
      }
      if (c.geocerca_recinto?.length >= 3) {
        const res = await guardarGeocerca(c.geocerca_recinto, "recinto", c.nombre);
        if (res.error) throw new Error(res.error);
      }
      // Persistir max_pilotos en estado_pista para que el panel lo lea siempre
      await supabase
        .from("estado_pista")
        .update({ max_pilotos: c.max_pilotos })
        .eq("activo", true);

      setActivoId(c.id);
      onMaxPilotosChange?.(c.max_pilotos);
      showMsg("ok", `✅ "${c.nombre}" activado. Trazado y geocercas aplicados al sistema.`);
    } catch (err: any) {
      showMsg("error", err.message || "Error al activar el circuito.");
    } finally {
      setActivando(false);
    }
  };

  const eliminar = async (id: string) => {
    if (!confirm("¿Eliminar este circuito? Esta acción no se puede deshacer.")) return;
    await supabase.from("circuitos").delete().eq("id", id);
    await cargar();
    if (seleccionado?.id === id) { setSeleccionado(null); setVista("lista"); }
  };

  const volverALista = () => { setVista("lista"); setSeleccionado(null); };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🏟</span>
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Circuitos</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {vista === "lista"
                ? `${circuitos.length} circuito${circuitos.length !== 1 ? "s" : ""} guardado${circuitos.length !== 1 ? "s" : ""}`
                : vista === "nuevo" ? "Nuevo circuito" : `Editando: ${seleccionado?.nombre}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vista === "lista" ? (
            <button onClick={iniciarNuevo}
              className="px-3 py-1.5 bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold rounded-xl transition-colors">
              + Nuevo
            </button>
          ) : (
            <button onClick={volverALista}
              className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-semibold rounded-xl hover:bg-gray-50 transition-colors">
              ← Volver
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {msg && (
        <div className={`mx-5 mt-4 px-4 py-2.5 rounded-xl text-sm font-medium border ${
          msg.tipo === "ok"
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {msg.texto}
        </div>
      )}

      <div className="p-5">

        {/* ── LISTA ── */}
        {vista === "lista" && (
          <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-5 space-y-4 lg:space-y-0">

            {/* Sidebar: lista de circuitos */}
            <div className="space-y-3">
              <input
                type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar circuito o ciudad..."
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />

              {cargando ? (
                <div className="py-10 text-center">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-400">Cargando...</p>
                </div>
              ) : filtrados.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-2xl mb-2">🏁</p>
                  <p className="text-xs text-gray-400">
                    {busqueda ? "Sin resultados para esa búsqueda" : "Aún no hay circuitos guardados"}
                  </p>
                  {!busqueda && (
                    <button onClick={iniciarNuevo}
                      className="mt-3 text-xs text-gray-900 font-semibold underline underline-offset-2">
                      Crear el primero
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                  {filtrados.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSeleccionado(seleccionado?.id === c.id ? null : c)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                        seleccionado?.id === c.id
                          ? "bg-gray-900 border-gray-900 text-white"
                          : "bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate">{c.nombre}</p>
                        {c.id === activoId && (
                          <span className="flex-shrink-0 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                            Activo
                          </span>
                        )}
                      </div>
                      {c.ciudad && (
                        <p className={`text-xs mt-0.5 ${seleccionado?.id === c.id ? "text-gray-400" : "text-gray-400"}`}>
                          {c.ciudad}
                        </p>
                      )}
                      <div className={`flex gap-2.5 mt-1.5 text-xs ${seleccionado?.id === c.id ? "text-gray-500" : "text-gray-400"}`}>
                        {(c.trazado_coords?.length || 0) > 0 && <span>🛣 {fmtKm(c.trazado_coords)}</span>}
                        {!(c.trazado_coords?.length) && !(c.geocerca_pista?.length) && (
                          <span className="text-amber-500">Sin coordenadas</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Panel de detalle */}
            <div>
              {!seleccionado ? (
                <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center py-14 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-3xl mb-3">🏁</p>
                  <p className="text-sm font-semibold text-gray-500">Seleccioná un circuito</p>
                  <p className="text-xs text-gray-400 mt-1.5">o creá uno nuevo para configurarlo</p>
                </div>
              ) : (
                <div className="space-y-4">

                  {/* Nombre + acciones */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-gray-900 text-xl leading-tight">{seleccionado.nombre}</h3>
                      {seleccionado.ciudad && <p className="text-sm text-gray-400 mt-0.5">{seleccionado.ciudad}</p>}
                      {seleccionado.descripcion && <p className="text-sm text-gray-500 mt-2">{seleccionado.descripcion}</p>}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => iniciarEdicion(seleccionado)}
                        className="px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-semibold rounded-xl hover:bg-gray-50 transition">
                        ✏️ Editar
                      </button>
                      <button onClick={() => eliminar(seleccionado.id)}
                        className="px-3 py-1.5 border border-red-100 text-red-400 text-xs font-semibold rounded-xl hover:bg-red-50 transition">
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Stats del circuito */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-amber-50 border-amber-200 text-amber-700 px-4 py-3">
                      <p className="text-xs font-semibold opacity-60">Longitud</p>
                      <p className="text-2xl font-black mt-0.5 leading-none">
                        {(seleccionado.trazado_coords?.length || 0) >= 2
                          ? fmtKm(seleccionado.trazado_coords)
                          : "—"}
                      </p>
                      <p className="text-xs opacity-50 mt-0.5">trazado</p>
                    </div>
                    <div className="rounded-xl border bg-gray-50 border-gray-200 text-gray-700 px-4 py-3">
                      <p className="text-xs font-semibold opacity-60">Capacidad</p>
                      <p className="text-2xl font-black mt-0.5 leading-none">{seleccionado.max_pilotos}</p>
                      <p className="text-xs opacity-50 mt-0.5">vehículos máx.</p>
                    </div>
                  </div>

                  {/* Botón activar */}
                  <button
                    onClick={() => activar(seleccionado)}
                    disabled={activando}
                    className={`w-full py-4 font-bold rounded-xl text-sm transition-colors ${
                      seleccionado.id === activoId
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : "bg-gray-900 hover:bg-gray-700 text-white"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {activando ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Activando...
                      </span>
                    ) : seleccionado.id === activoId ? (
                      "✓ Circuito activo — Volver a activar"
                    ) : (
                      "⚡ Activar en el sistema"
                    )}
                  </button>
                  <p className="text-xs text-gray-400 text-center -mt-2">
                    Aplica trazado y geocercas de este circuito al sistema en tiempo real
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── FORMULARIO (nuevo / editar) ── */}
        {(vista === "nuevo" || vista === "editar") && (
          <div className="space-y-5">

            {/* Datos básicos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Nombre del circuito *
                </label>
                <input
                  type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                  className="mt-1.5 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="Autódromo Las Vizcachas"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Ciudad / Ubicación
                </label>
                <input
                  type="text" value={ciudad} onChange={e => setCiudad(e.target.value)}
                  className="mt-1.5 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="Puente Alto, Chile"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Descripción (opcional)
                </label>
                <input
                  type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)}
                  className="mt-1.5 w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="Características, notas de configuración..."
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Capacidad máxima
                </label>
                <div className="mt-1.5 flex items-center gap-3">
                  <input
                    type="number" value={maxPilotos} onChange={e => setMaxPilotos(Number(e.target.value))}
                    min={1} max={30}
                    className="w-24 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                  <span className="text-sm text-gray-400">vehículos en pista</span>
                </div>
              </div>
            </div>

            {/* Mapa editor */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Configuración del mapa
              </p>
              <div className="bg-gray-950 rounded-2xl border border-gray-800 p-4">
                <MapaCircuito
                  mapKey={seleccionado?.id || "nuevo"}
                  trazado={trazado}
                  geocercaPista={geocercaPista}
                  geocercaRecinto={geocercaRecinto}
                  onTrazadoChange={setTrazado}
                  onPistaChange={setGeocercaPista}
                  onRecintoChange={setGeocercaRecinto}
                />
              </div>
              {/* Resumen de coords */}
              <div className="flex gap-5 mt-3 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                  Trazado: {trazado.length} pts
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  Pista: {geocercaPista.length} pts {geocercaPista.length >= 3 ? "✓" : "(mín. 3)"}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                  Recinto: {geocercaRecinto.length} pts {geocercaRecinto.length >= 3 ? "✓" : "(mín. 3)"}
                </span>
              </div>
            </div>

            {/* Acciones */}
            <div className="flex gap-3">
              <button
                onClick={guardar}
                disabled={guardando || !nombre.trim()}
                className="flex-1 py-3 bg-gray-900 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
              >
                {guardando
                  ? "Guardando..."
                  : vista === "editar" ? "Guardar cambios" : "Guardar circuito"}
              </button>
              <button
                onClick={volverALista}
                className="px-5 py-3 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-xl text-sm transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

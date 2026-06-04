"use client";

import { useEffect, useRef, useState } from "react";
import {
  guardarGeocerca, getGeocercaActiva,
  guardarTrazado, getTrazadoActivo,
  getUltimasUbicaciones, type Coordenada
} from "@/lib/gps";
import { supabase } from "@/lib/supabase";

interface Props {
  pilotosEnPista?: { id: string; nombre: string }[];
}

function cargarLeaflet(): Promise<any> {
  return new Promise((resolve) => {
    if ((window as any).L) { resolve((window as any).L); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css"; link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if (!document.getElementById("leaflet-js")) {
      const script = document.createElement("script");
      script.id = "leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve((window as any).L);
      document.head.appendChild(script);
    } else {
      const iv = setInterval(() => { if ((window as any).L) { clearInterval(iv); resolve((window as any).L); } }, 50);
    }
  });
}

function parsearKML(contenido: string): Coordenada[] | null {
  try {
    const doc = new DOMParser().parseFromString(contenido, "text/xml");
    const coordNodes = doc.getElementsByTagName("coordinates");
    if (!coordNodes.length) return null;
    let mejor = "";
    for (let i = 0; i < coordNodes.length; i++) {
      const t = coordNodes[i].textContent || "";
      if (t.length > mejor.length) mejor = t;
    }
    const coords: Coordenada[] = [];
    for (const p of mejor.trim().split(/\s+/)) {
      const [lngS, latS] = p.split(",");
      const lng = parseFloat(lngS), lat = parseFloat(latS);
      if (!isNaN(lat) && !isNaN(lng)) coords.push({ lat, lng });
    }
    return coords.length >= 3 ? coords : null;
  } catch { return null; }
}

type Modo = "ninguno" | "geocerca" | "trazado";

export default function GeofenceMap({ pilotosEnPista = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const geocercaLayerRef = useRef<any>(null);
  const trazadoLayerRef = useRef<any>(null);
  const vertexMarkersRef = useRef<any[]>([]);
  const pilotoMarkersRef = useRef<globalThis.Map<string, any>>(new globalThis.Map());
  const ubicacionActualRef = useRef<any>(null);
  const kmlInputRef = useRef<HTMLInputElement>(null);

  const [geocercaCoords, setGeocercaCoords] = useState<Coordenada[]>([]);
  const [trazadoCoords, setTrazadoCoords] = useState<Coordenada[]>([]);
  const [modoEdicion, setModoEdicion] = useState<Modo>("ninguno");
  const [puntosActuales, setPuntosActuales] = useState<Coordenada[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [ubicacionActiva, setUbicacionActiva] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    cargarLeaflet().then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;
      setCargando(false);

      const map = L.map(mapRef.current, { center: [-33.58, -70.58], zoom: 15 });
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20 }
      ).addTo(map);
      mapInstanceRef.current = map;

      // Cargar geocerca
      getGeocercaActiva().then((coords) => {
        if (coords?.length) {
          setGeocercaCoords(coords);
          dibujarGeocerca(L, map, coords);
        }
      });

      // Cargar trazado
      getTrazadoActivo().then((coords) => {
        if (coords?.length) {
          setTrazadoCoords(coords);
          dibujarTrazado(L, map, coords);
        }
      });

      mostrarUbicacionActual(L, map, true);
      getUltimasUbicaciones().then((data: any[]) => actualizarMarcadores(L, map, data));
    });

    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, []);

  // Click en mapa para editar
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const L = (window as any).L;

    const handleClick = (e: any) => {
      if (modoEdicion === "ninguno") return;
      const nueva: Coordenada = { lat: e.latlng.lat, lng: e.latlng.lng };
      setPuntosActuales((prev) => {
        const nuevos = [...prev, nueva];
        if (L) {
          if (modoEdicion === "geocerca") dibujarGeocercaTemp(L, map, nuevos);
          else dibujarTrazadoTemp(L, map, nuevos);
        }
        return nuevos;
      });
    };

    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [modoEdicion]);

  // Realtime pilotos
  useEffect(() => {
    const channel = supabase.channel("gps-map")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ubicaciones_piloto" }, () => {
        const map = mapInstanceRef.current;
        const L = (window as any).L;
        if (map && L) getUltimasUbicaciones().then((d: any[]) => actualizarMarcadores(L, map, d));
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  function dibujarGeocerca(L: any, map: any, coords: Coordenada[]) {
    if (geocercaLayerRef.current) { geocercaLayerRef.current.remove(); geocercaLayerRef.current = null; }
    if (coords.length < 3) return;
    geocercaLayerRef.current = L.polygon(coords.map((c) => [c.lat, c.lng]), {
      color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.12, weight: 2,
      dashArray: undefined,
    }).bindTooltip("Geocerca de cobro", { permanent: false }).addTo(map);
  }

  function dibujarGeocercaTemp(L: any, map: any, coords: Coordenada[]) {
    // Limpiar vértices temporales
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    if (geocercaLayerRef.current) { geocercaLayerRef.current.remove(); geocercaLayerRef.current = null; }
    if (coords.length < 2) return;
    geocercaLayerRef.current = L.polygon(coords.map((c) => [c.lat, c.lng]), {
      color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.12, weight: 2,
    }).addTo(map);
    coords.forEach((c, i) => {
      const m = L.circleMarker([c.lat, c.lng], { radius: 4, color: "#22c55e", fillColor: "#000", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${i + 1}`).addTo(map);
      vertexMarkersRef.current.push(m);
    });
  }

  function dibujarTrazado(L: any, map: any, coords: Coordenada[]) {
    if (trazadoLayerRef.current) { trazadoLayerRef.current.remove(); trazadoLayerRef.current = null; }
    if (coords.length < 2) return;
    trazadoLayerRef.current = L.polyline(coords.map((c) => [c.lat, c.lng]), {
      color: "#f59e0b", weight: 3, opacity: 0.9,
    }).bindTooltip("Trazado del circuito", { permanent: false }).addTo(map);
  }

  function dibujarTrazadoTemp(L: any, map: any, coords: Coordenada[]) {
    if (trazadoLayerRef.current) { trazadoLayerRef.current.remove(); trazadoLayerRef.current = null; }
    if (coords.length < 2) return;
    trazadoLayerRef.current = L.polyline(coords.map((c) => [c.lat, c.lng]), {
      color: "#f59e0b", weight: 3, opacity: 0.9,
    }).addTo(map);
  }

  function actualizarMarcadores(L: any, map: any, data: any[]) {
    pilotoMarkersRef.current.forEach((m) => m.remove());
    pilotoMarkersRef.current.clear();
    data.forEach((u: any) => {
      if (!u.lat || !u.lng) return;
      const nombre = u.pilotos?.nombre || "Piloto";
      const vel = u.velocidad || 0;
      const dentro = u.dentro_geocerca !== false;
      const color = dentro ? "#22c55e" : "#ef4444";
      const icon = L.divIcon({
        html: `<div style="background:#111;border:2px solid ${color};border-radius:50%;width:14px;height:14px;box-shadow:0 0 8px ${color}88"></div>`,
        className: "", iconSize: [14, 14], iconAnchor: [7, 7],
      });
      pilotoMarkersRef.current.set(u.piloto_id,
        L.marker([u.lat, u.lng], { icon })
          .bindPopup(`<div style="background:#111;color:#fff;padding:8px;border-radius:8px;font-size:12px;border:1px solid #222">
            <b>${nombre}</b><br/><span style="color:#22c55e">${vel} km/h</span>
          </div>`).addTo(map)
      );
    });
  }

  function mostrarUbicacionActual(L: any, map: any, centrar = false) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      setUbicacionActiva(true);
      const icon = L.divIcon({
        html: `<div style="position:relative;width:20px;height:20px">
          <div style="position:absolute;inset:0;background:#3b82f6;border-radius:50%;opacity:0.25;animation:pu 2s infinite"></div>
          <div style="position:absolute;inset:5px;background:#3b82f6;border-radius:50%;border:2px solid white;box-shadow:0 0 6px #3b82f688"></div>
        </div>
        <style>@keyframes pu{0%,100%{transform:scale(1)}50%{transform:scale(2);opacity:0}}</style>`,
        className: "", iconSize: [20, 20], iconAnchor: [10, 10],
      });
      if (ubicacionActualRef.current) ubicacionActualRef.current.remove();
      ubicacionActualRef.current = L.marker([lat, lng], { icon })
        .bindPopup(`<div style="background:#111;color:#fff;padding:6px 10px;border-radius:8px;font-size:11px;border:1px solid #333">📍 Tu ubicación</div>`)
        .addTo(map);
      if (centrar && !geocercaLayerRef.current) map.setView([lat, lng], 16);
    }, () => {}, { enableHighAccuracy: true, timeout: 10000 });
  }

  const irAUbicacion = () => {
    const map = mapInstanceRef.current;
    const L = (window as any).L;
    if (!map || !L) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { map.setView([pos.coords.latitude, pos.coords.longitude], 17); mostrarUbicacionActual(L, map); },
      () => setMensaje({ tipo: "error", texto: "GPS no disponible." })
    );
  };

  const handleKML = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const coords = parsearKML(ev.target?.result as string);
      if (!coords) { setMensaje({ tipo: "error", texto: "No se encontraron coordenadas en el KML." }); return; }
      const map = mapInstanceRef.current;
      const L = (window as any).L;
      if (!map || !L) return;

      setGuardando(true);
      const { error } = await guardarTrazado(coords);
      setGuardando(false);

      if (error) { setMensaje({ tipo: "error", texto: error }); return; }

      setTrazadoCoords(coords);
      dibujarTrazado(L, map, coords);
      const bounds = L.latLngBounds(coords.map((c: Coordenada) => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
      setMensaje({ tipo: "ok", texto: `Trazado importado y guardado: ${coords.length} puntos.` });
      setTimeout(() => setMensaje(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const iniciarEdicion = (modo: Modo) => {
    setPuntosActuales([]);
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    setModoEdicion(modo);
  };

  const cancelarEdicion = () => {
    setPuntosActuales([]);
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    setModoEdicion("ninguno");
    // Restaurar capas originales
    const L = (window as any).L;
    const map = mapInstanceRef.current;
    if (L && map) {
      if (geocercaCoords.length) dibujarGeocerca(L, map, geocercaCoords);
      if (trazadoCoords.length) dibujarTrazado(L, map, trazadoCoords);
    }
  };

  const handleGuardar = async () => {
    if (puntosActuales.length < 3) {
      setMensaje({ tipo: "error", texto: "Se necesitan al menos 3 puntos." });
      return;
    }
    setGuardando(true);
    let error: string | undefined;

    if (modoEdicion === "geocerca") {
      const res = await guardarGeocerca(puntosActuales);
      error = res.error;
      if (!error) setGeocercaCoords(puntosActuales);
    } else {
      const res = await guardarTrazado(puntosActuales);
      error = res.error;
      if (!error) setTrazadoCoords(puntosActuales);
    }

    setGuardando(false);
    if (error) { setMensaje({ tipo: "error", texto: error }); return; }
    setMensaje({ tipo: "ok", texto: `${modoEdicion === "geocerca" ? "Geocerca" : "Trazado"} guardado.` });
    setModoEdicion("ninguno");
    setPuntosActuales([]);
    vertexMarkersRef.current.forEach((m) => m.remove());
    vertexMarkersRef.current = [];
    setTimeout(() => setMensaje(null), 3000);
  };

  const editando = modoEdicion !== "ninguno";

  return (
    <>
      <style>{`
        .leaflet-container { background: #0a0a0a !important; }
        .leaflet-popup-content-wrapper { background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important; }
        .leaflet-popup-tip-container { display:none; }
        .leaflet-control-attribution { display:none!important; }
        .leaflet-bar a { background:#1a1a1a!important;color:#fff!important;border-color:#333!important; }
      `}</style>

      <input ref={kmlInputRef} type="file" accept=".kml" className="hidden" onChange={handleKML} />

      <div className="flex flex-col gap-3">
        {/* Leyenda */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-green-500 inline-block rounded" />
            Geocerca (cobro)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-400 inline-block rounded" />
            Trazado del circuito
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
            Tu ubicación
          </span>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {!editando ? (
            <>
              <button onClick={() => iniciarEdicion("geocerca")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-900 text-green-300 hover:bg-green-800 border border-green-800 transition">
                ✏️ Dibujar geocerca
              </button>
              <button onClick={() => kmlInputRef.current?.click()} disabled={guardando}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-900 text-amber-300 hover:bg-amber-800 border border-amber-800 transition disabled:opacity-60">
                📂 {guardando ? "Importando..." : "Importar trazado KML"}
              </button>
              <button onClick={irAUbicacion}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${ubicacionActiva ? "bg-blue-950 text-blue-400 border-blue-800" : "bg-gray-800 text-gray-400 border-gray-700"}`}>
                📍 {ubicacionActiva ? "Mi ubicación" : "Buscar ubicación"}
              </button>
            </>
          ) : (
            <>
              <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${modoEdicion === "geocerca" ? "bg-green-500 text-white" : "bg-amber-500 text-black"}`}>
                {modoEdicion === "geocerca" ? "✏️ Dibujando geocerca" : "✏️ Dibujando trazado"} — clic en el mapa
              </span>
              <span className="text-xs text-gray-500">{puntosActuales.length} puntos{puntosActuales.length >= 3 ? " ✓" : " (mín. 3)"}</span>
              {puntosActuales.length >= 3 && (
                <button onClick={handleGuardar} disabled={guardando}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-500 transition disabled:opacity-60">
                  {guardando ? "Guardando..." : "✓ Guardar"}
                </button>
              )}
              <button onClick={cancelarEdicion}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 transition">
                Cancelar
              </button>
            </>
          )}
        </div>

        {mensaje && (
          <div className={`text-xs px-3 py-2 rounded-lg ${mensaje.tipo === "ok" ? "bg-green-950 border border-green-800 text-green-400" : "bg-red-950 border border-red-800 text-red-400"}`}>
            {mensaje.texto}
          </div>
        )}

        {/* Mapa */}
        <div className="relative w-full rounded-xl overflow-hidden border border-gray-800" style={{ height: "460px" }}>
          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950 z-10">
              <span className="text-xs text-gray-500 animate-pulse">Cargando mapa...</span>
            </div>
          )}
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </>
  );
}
